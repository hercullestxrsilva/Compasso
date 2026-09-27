import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

export function pdfResources(version: string, origin: string) {
  const base = new URL(`/pdfjs/${version}/`, origin);
  return {
    wasmUrl: new URL('wasm/', base).href,
    cMapUrl: new URL('cmaps/', base).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', base).href,
    iccUrl: new URL('iccs/', base).href,
    stopAtErrors: true,
  };
}

export interface RenderedPage {
  pages: number;
  /** Page height divided by page width. */
  ratio: number;
}
interface Bitmap extends RenderedPage {
  buffer: HTMLCanvasElement;
}
interface RenderRequest {
  page: number;
  /** CSS width of the page at zoom 1. */
  width: number;
  zoom: number;
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export interface PdfHandle {
  readonly promise: Promise<PDFDocumentProxy>;
  close(): void;
}

/** Reads and parses a PDF once. close() destroys the document (and cancels a load in progress). */
export function openPdf(blob: Blob): PdfHandle {
  let task: PDFDocumentLoadingTask | undefined;
  let closed = false;
  const promise = (async () => {
    const pdfjs = await loadPdfjs();
    const data = await blob.arrayBuffer();
    if (closed) throw new DOMException('O documento foi fechado.', 'AbortError');
    task = pdfjs.getDocument({ data, ...pdfResources(pdfjs.version, location.href) });
    return task.promise;
  })();
  // Callers that stop waiting (page changes, unmount) must not produce unhandled rejections.
  promise.catch(() => {});
  return {
    promise,
    close() {
      if (closed) return;
      closed = true;
      void task?.destroy().catch(() => {});
    },
  };
}

function release(buffer: HTMLCanvasElement) {
  buffer.width = buffer.height = 0;
}

async function renderToBuffer(
  document: PDFDocumentProxy,
  { page, width, zoom }: RenderRequest,
  signal: AbortSignal,
): Promise<Bitmap> {
  const pdfPage = await document.getPage(Math.min(page, document.numPages));
  signal.throwIfAborted();
  const base = pdfPage.getViewport({ scale: 1 });
  const cssScale = (width * zoom) / base.width;
  // Bound backing-store memory on tablets without changing annotation coordinates.
  const density = Math.min(
    globalThis.devicePixelRatio || 1,
    1.6,
    Math.sqrt(8_000_000 / (base.width * base.height * cssScale ** 2)),
    8192 / (Math.max(base.width, base.height) * cssScale),
  );
  const viewport = pdfPage.getViewport({ scale: cssScale * density });
  // Rendering happens off screen: a canceled render must never clear the canvas of a newer one.
  const buffer = window.document.createElement('canvas');
  buffer.width = Math.max(1, Math.floor(viewport.width));
  buffer.height = Math.max(1, Math.floor(viewport.height));
  let renderTask: RenderTask | undefined;
  const cancel = () => renderTask?.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    renderTask = pdfPage.render({ canvas: buffer, viewport });
    await renderTask.promise;
    signal.throwIfAborted();
    return { buffer, pages: document.numPages, ratio: base.height / base.width };
  } catch (error) {
    release(buffer);
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function publish(canvas: HTMLCanvasElement, bitmap: Bitmap) {
  canvas.width = bitmap.buffer.width;
  canvas.height = bitmap.buffer.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('O navegador não disponibilizou a área de desenho.');
  context.drawImage(bitmap.buffer, 0, 0);
}

const sizeKey = ({ width, zoom }: RenderRequest) => `${Math.round(width * zoom * 100)}`;

/**
 * Renders the pages of one PDF, reusing the parsed document across pages, zoom levels and resizes.
 * It can also render the next page ahead of time so a page turn shows it at once.
 */
export class PdfRenderer {
  private readonly handle: PdfHandle;
  private ahead?: { page: number; size: string; controller: AbortController; promise: Promise<Bitmap> };
  private destroyed = false;

  constructor(blob: Blob) {
    this.handle = openPdf(blob);
  }

  async render({
    canvas,
    signal,
    ...request
  }: RenderRequest & { canvas: HTMLCanvasElement; signal: AbortSignal }): Promise<RenderedPage> {
    try {
      return await this.renderNow(canvas, request, signal);
    } catch (error) {
      // After a cancel, report the abort rather than whatever PDF.js raised while stopping.
      signal.throwIfAborted();
      throw error;
    }
  }

  private async renderNow(canvas: HTMLCanvasElement, request: RenderRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    const size = sizeKey(request);
    let bitmap: Bitmap | undefined;
    const ahead = this.ahead;
    if (ahead && ahead.size !== size) this.dropAhead();
    else if (ahead?.page === request.page) {
      this.ahead = undefined;
      bitmap = await ahead.promise.catch(() => undefined);
    }
    if (bitmap && signal.aborted) release(bitmap.buffer);
    signal.throwIfAborted();
    if (!bitmap) {
      const document = await this.handle.promise;
      signal.throwIfAborted();
      bitmap = await renderToBuffer(document, request, signal);
    }
    try {
      signal.throwIfAborted();
      publish(canvas, bitmap);
      return { pages: bitmap.pages, ratio: bitmap.ratio } satisfies RenderedPage;
    } finally {
      release(bitmap.buffer);
    }
  }

  /** Starts rendering a page off screen; a later render() of the same page and size uses it. */
  prefetch(request: RenderRequest) {
    const size = sizeKey(request);
    if (this.destroyed || (this.ahead?.page === request.page && this.ahead.size === size)) return;
    this.dropAhead();
    const controller = new AbortController();
    const promise = this.handle.promise.then(document => {
      if (request.page > document.numPages) throw new RangeError('Página inexistente.');
      return renderToBuffer(document, request, controller.signal);
    });
    promise.catch(() => {});
    this.ahead = { page: request.page, size, controller, promise };
  }

  destroy() {
    this.destroyed = true;
    this.dropAhead();
    this.handle.close();
  }

  private dropAhead() {
    const ahead = this.ahead;
    if (!ahead) return;
    this.ahead = undefined;
    ahead.controller.abort();
    void ahead.promise.then(
      bitmap => release(bitmap.buffer),
      () => {},
    );
  }
}

/** Renders one page from a PDF blob, parsing it just for this call. */
export async function renderPdfPage({
  blob,
  ...options
}: RenderRequest & { blob: Blob; canvas: HTMLCanvasElement; signal: AbortSignal }) {
  const renderer = new PdfRenderer(blob);
  const stop = () => renderer.destroy();
  options.signal.addEventListener('abort', stop, { once: true });
  try {
    return await renderer.render(options);
  } finally {
    options.signal.removeEventListener('abort', stop);
    renderer.destroy();
  }
}

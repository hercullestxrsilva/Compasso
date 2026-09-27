import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

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

export async function renderPdfPage({ blob, canvas, page, width, zoom, signal }: {
  blob: Blob;
  canvas: HTMLCanvasElement;
  page: number;
  width: number;
  zoom: number;
  signal: AbortSignal;
}) {
  let documentTask: PDFDocumentLoadingTask | undefined;
  let renderTask: RenderTask | undefined;
  let destroyed = false;
  const dispose = () => {
    renderTask?.cancel();
    if (documentTask && !destroyed) {
      destroyed = true;
      void documentTask.destroy().catch(() => {});
    }
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    signal.throwIfAborted();
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const data = await blob.arrayBuffer();
    signal.throwIfAborted();
    documentTask = pdfjs.getDocument({ data, ...pdfResources(pdfjs.version, location.href) });
    const document = await documentTask.promise;
    signal.throwIfAborted();
    const pdfPage = await document.getPage(Math.min(page, document.numPages));
    signal.throwIfAborted();
    const base = pdfPage.getViewport({ scale: 1 });
    const cssScale = width * zoom / base.width;
    // Bound backing-store memory on tablets without changing annotation coordinates.
    const density = Math.min(globalThis.devicePixelRatio || 1, 1.6,
      Math.sqrt(8_000_000 / (base.width * base.height * cssScale ** 2)),
      8192 / (Math.max(base.width, base.height) * cssScale));
    const viewport = pdfPage.getViewport({ scale: cssScale * density });
    // A canceled render must never clear or overwrite the canvas of a newer render.
    const buffer = window.document.createElement('canvas');
    buffer.width = Math.max(1, Math.floor(viewport.width));
    buffer.height = Math.max(1, Math.floor(viewport.height));
    try {
      renderTask = pdfPage.render({ canvas: buffer, viewport });
      await renderTask.promise;
      signal.throwIfAborted();
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('O navegador não disponibilizou a área de desenho.');
      context.drawImage(buffer, 0, 0);
      return { pages: document.numPages, ratio: base.height / base.width };
    } finally {
      buffer.width = buffer.height = 0;
    }
  } finally {
    signal.removeEventListener('abort', dispose);
    dispose();
  }
}

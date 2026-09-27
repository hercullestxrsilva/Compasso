import { afterEach, describe, expect, it, vi } from 'vitest';
import { pdfResources, renderPdfPage } from '../src/pdf/render';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  getDocument: mocks.getDocument,
  version: 'test-version',
  GlobalWorkerOptions: {},
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.mjs' }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  const drawImage = vi.fn();
  const canvas = { width: 11, height: 12, getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement;
  const buffer = { width: 0, height: 0 };
  vi.stubGlobal('window', { document: { createElement: () => buffer } });
  vi.stubGlobal('location', { href: 'http://localhost:4188/' });
  vi.stubGlobal('devicePixelRatio', 2);
  const rendering = deferred<void>();
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 500 * scale, height: 650 * scale }),
    render: vi.fn(() => ({ promise: rendering.promise, cancel: vi.fn() })),
  };
  const getPage = vi.fn(async () => page);
  const destroy = vi.fn(async () => {});
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy });
  const controller = new AbortController();
  const run = () =>
    renderPdfPage({
      blob: new Blob(['pdf']),
      canvas,
      page: 1,
      width: 600,
      zoom: 1,
      signal: controller.signal,
    });
  return { canvas, drawImage, page, getPage, destroy, controller, rendering, run };
}

describe('PDF rendering', () => {
  it('uses matching, same-origin decoder/font resources and reports malformed images', () => {
    const resources = pdfResources('5.4.624', 'https://compasso.example/');
    expect(resources.wasmUrl).toBe('https://compasso.example/pdfjs/5.4.624/wasm/');
    expect(resources.cMapUrl).toContain('/5.4.624/cmaps/');
    expect(resources.standardFontDataUrl).toContain('/5.4.624/standard_fonts/');
    expect(resources.iccUrl).toContain('/5.4.624/iccs/');
    expect(resources.stopAtErrors).toBe(true);
  });
  it('does not erase the visible page until the replacement has finished', async () => {
    const s = setup();
    const result = s.run();
    await vi.waitFor(() => expect(s.page.render).toHaveBeenCalled());
    expect(s.canvas.width).toBe(11);
    expect(s.drawImage).not.toHaveBeenCalled();
    s.rendering.resolve();
    expect(await result).toEqual({ pages: 2, ratio: 1.3 });
    expect(s.drawImage).toHaveBeenCalledOnce();
    expect(s.canvas.width).toBe(960);
    expect(s.destroy).toHaveBeenCalledOnce();
  });
  it('never publishes an obsolete render after zoom or page navigation', async () => {
    const s = setup();
    const result = s.run();
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(s.page.render).toHaveBeenCalled());
    s.controller.abort();
    s.rendering.resolve();
    await rejected;
    expect(s.drawImage).not.toHaveBeenCalled();
    expect(s.canvas.width).toBe(11);
    expect(s.destroy).toHaveBeenCalledOnce();
  });
  it('does not start rendering when canceled while a page is loading', async () => {
    const s = setup();
    const pending = deferred<typeof s.page>();
    s.getPage.mockReturnValue(pending.promise);
    const result = s.run();
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(s.getPage).toHaveBeenCalled());
    s.controller.abort();
    pending.resolve(s.page);
    await rejected;
    expect(s.page.render).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
  });
});

import { useEffect, useRef } from 'react';

/** Photos, screenshots and scans: anything the browser may be able to draw. */
type Named = { type: string; name: string };
export const isImageFile = (file: Named) =>
  file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(file.name);
export const isPdfFile = (file: Named) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
/** A stored file (asset) seen as an image, e.g. to show a thumbnail. */
export const isImageAsset = (asset: { mime: string; name: string }) =>
  isImageFile({ type: asset.mime, name: asset.name });
const WEB_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** For file inputs: PDFs and any image (on iPad this also offers the camera and the photo library). */
export const DOCUMENT_ACCEPT = 'application/pdf,image/*';

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);
const isPngBytes = (bytes: Uint8Array) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
const isJpegBytes = (bytes: Uint8Array) => startsWith(bytes, [0xff, 0xd8, 0xff]);
/** Photos stay JPEG (a 12 MP photo as PNG would weigh tens of MB); screenshots and drawings stay PNG. */
const isPhoto = (file: File) => /jpe?g|heic|heif/i.test(file.type) || /.(jpe?g|heic|heif)$/i.test(file.name);

/**
 * Draws an image the browser can decode and returns it as JPEG (photos) or PNG bytes. Photos are drawn upright
 * (their EXIF orientation applied), which a PDF would otherwise ignore.
 */
async function drawImage(file: File): Promise<Uint8Array> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new Error(`Não foi possível ler a imagem “${file.name}”. Use PNG, JPEG ou WebP.`, { cause: error });
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Não foi possível converter a imagem.'))),
        isPhoto(file) ? 'image/jpeg' : 'image/png',
        0.9,
      ),
    );
    canvas.width = canvas.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/**
 * One PDF with one page per image, in the given order — e.g. three screenshots of a score become one
 * three-page score. `encode` turns a file into PNG or JPEG bytes (injectable for tests).
 */
export async function imagesToPdf(
  images: File[],
  name: string,
  encode: (file: File) => Promise<Uint8Array> = drawImage,
): Promise<File> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const file of images) {
    const bytes = await encode(file);
    const image = isPngBytes(bytes)
      ? await pdf.embedPng(bytes)
      : isJpegBytes(bytes)
        ? await pdf.embedJpg(bytes)
        : null;
    if (!image) throw new Error(`Não foi possível converter a imagem “${file.name}”.`);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  const base = name.replace(/\.[^.]+$/, '').trim() || 'Imagens';
  return new File([new Uint8Array(await pdf.save())], `${base}.pdf`, { type: 'application/pdf' });
}

/**
 * The files to store as score versions or warm-up books: PDFs as they are; one image as it is; several images
 * chosen together, joined into one PDF (a page each, in the order chosen).
 */
export async function prepareDocuments(
  files: File[],
  name: string,
  encode?: (file: File) => Promise<Uint8Array>,
): Promise<File[]> {
  const unknown = files.find(f => !isPdfFile(f) && !isImageFile(f));
  if (unknown) throw new Error(`“${unknown.name}” não é um PDF nem uma imagem.`);
  const pdfs = files.filter(isPdfFile),
    images = files.filter(f => !isPdfFile(f));
  if (!images.length) return pdfs;
  // One image in a format every browser shows stays as it is; the rest become a PDF (HEIC photos, BMP…),
  // so the score still opens on another device.
  if (images.length === 1 && WEB_IMAGES.includes(images[0].type)) return [...pdfs, images[0]];
  return [...pdfs, await imagesToPdf(images, images.length === 1 ? images[0].name : name, encode)];
}

/** "Print 27-09 14h05.png": pasted screenshots all arrive named "image.png". */
function namePasted(file: File, index: number) {
  if (file.name && file.name !== 'image.png') return file;
  const d = new Date(),
    two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${two(d.getDate())}-${two(d.getMonth() + 1)} ${two(d.getHours())}h${two(d.getMinutes())}`;
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  return new File([file], `Print ${stamp}${index ? ` (${index + 1})` : ''}.${ext}`, { type: file.type });
}

/**
 * Ctrl+V / ⌘V of screenshots and copied images. `scope: 'page'` ignores pastes while a dialog is open (the
 * dialog handles its own); `scope: 'dialog'` always handles them. Text pastes are left alone.
 */
export function usePasteFiles(
  onFiles: (files: File[]) => void,
  { scope, enabled = true, pdf = true }: { scope: 'page' | 'dialog'; enabled?: boolean; pdf?: boolean },
) {
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  });
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      if (scope === 'page' && document.querySelector('dialog[open]')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(f => isImageFile(f) || (pdf && isPdfFile(f)));
      if (!files.length) return;
      e.preventDefault();
      latest.current(files.map(namePasted));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [scope, enabled, pdf]);
}

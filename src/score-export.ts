import {
  PDFDocument,
  rgb,
  StandardFonts,
  degrees,
  LineCapStyle,
  LineJoinStyle,
  pushGraphicsState,
  popGraphicsState,
  setLineJoin,
  type PDFPage,
} from 'pdf-lib';
import type { Asset, Annotation, Point } from './domain';

type Mapper = (p: { x: number; y: number }) => { x: number; y: number };

/**
 * One SVG path for a whole stroke, in PDF user space with y negated (drawSvgPath flips y back).
 * Drawing a stroke as a single path keeps translucent highlighter joints from darkening where
 * separate segments would overlap.
 */
export function strokePath(points: Point[], map: Mapper) {
  return points
    .map((p, i) => {
      const at = map(p);
      return `${i ? 'L' : 'M'}${at.x.toFixed(3)},${(-at.y).toFixed(3)}`;
    })
    .join(' ');
}

/** Maps normalized page points to PDF user space, honouring the page rotation. */
export function pageMapper(page: PDFPage) {
  const { width: w, height: h } = page.getSize();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const quarter = rotation === 90 || rotation === 270;
  // Visual width/height: annotation sizes are relative to the page width as displayed.
  const vw = quarter ? h : w,
    vh = quarter ? w : h;
  const map: Mapper = p =>
    rotation === 90
      ? { x: p.y * w, y: p.x * h }
      : rotation === 180
        ? { x: (1 - p.x) * w, y: p.y * h }
        : rotation === 270
          ? { x: (1 - p.y) * w, y: (1 - p.x) * h }
          : { x: p.x * vw, y: (1 - p.y) * vh };
  return { map, rotation, vw };
}

function color(hex: string) {
  const value = hex.replace('#', '');
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  );
}

export async function exportAnnotated(asset: Asset, annotations: Annotation[]) {
  const bytes = await asset.blob.arrayBuffer();
  let pdf: PDFDocument;
  if (asset.mime === 'application/pdf' || asset.name.endsWith('.pdf')) pdf = await PDFDocument.load(bytes);
  else {
    pdf = await PDFDocument.create();
    let source = bytes;
    if (asset.mime !== 'image/png' && asset.mime !== 'image/jpeg') {
      const bitmap = await createImageBitmap(asset.blob),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      source = await (
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            b => (b ? resolve(b) : reject(new Error('Não foi possível converter a imagem.'))),
            'image/png',
          ),
        )
      ).arrayBuffer();
    }
    const image = asset.mime === 'image/jpeg' ? await pdf.embedJpg(source) : await pdf.embedPng(source);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageCount = pdf.getPageCount();
  for (const a of annotations) {
    if (a.page < 1 || a.page > pageCount || !a.points.length) continue;
    const page = pdf.getPage(a.page - 1);
    const { map, rotation, vw } = pageMapper(page);
    if (a.kind === 'text') {
      let text = a.text ?? '';
      try {
        font.encodeText(text);
      } catch {
        text = text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
      }
      page.drawText(text, {
        ...map(a.points[0]),
        size: ((a.fontSize ?? 20) * vw) / 1000,
        font,
        color: color(a.color),
        rotate: degrees(rotation),
      });
    } else {
      // Round joins match the on-screen stroke; drawSvgPath inherits them from this graphics state.
      page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
      page.drawSvgPath(strokePath(a.points, map), {
        x: 0,
        y: 0,
        borderColor: color(a.color),
        borderWidth: (a.width * vw) / 1000,
        borderLineCap: LineCapStyle.Round,
        borderOpacity: a.kind === 'highlight' ? 0.3 : 1,
      });
      page.pushOperators(popGraphicsState());
    }
  }
  return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
}

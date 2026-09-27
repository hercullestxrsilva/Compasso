import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib';
import { exportAnnotated, pageMapper, strokePath } from '../src/score-export';
import type { Annotation, Asset } from '../src/domain';

async function pdfAsset(rotation = 0): Promise<Asset> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]).setRotation(degrees(rotation));
  const bytes = await doc.save();
  return {
    id: 'a',
    name: 'teste.pdf',
    mime: 'application/pdf',
    size: bytes.length,
    blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    createdAt: '',
  };
}

const highlight: Annotation = {
  id: 'h',
  scoreId: 's',
  page: 1,
  layer: 'Minhas notas',
  kind: 'highlight',
  color: '#e0a100',
  width: 18,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.12 },
    { x: 0.3, y: 0.1 },
    { x: 0.4, y: 0.14 },
  ],
  createdAt: '',
};

/** Decoded text of every content stream appended to the first page. */
async function pageOperators(blob: Blob) {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  const contents = doc.getPage(0).node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map(ref => doc.context.lookup(ref))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map(stream => {
      const filter = stream.dict.get(PDFName.of('Filter'));
      const bytes = filter ? unzlibSync(stream.contents) : stream.contents;
      return new TextDecoder().decode(bytes);
    })
    .join('\n');
}

describe('annotated PDF export', () => {
  it('draws a highlight as a single translucent path with round caps and joins', async () => {
    const operators = await pageOperators(await exportAnnotated(await pdfAsset(), [highlight]));
    expect(operators.match(/ m\b/g)).toHaveLength(1);
    expect(operators.match(/ l\b/g)).toHaveLength(3);
    expect(operators.match(/^S$/gm)).toHaveLength(1);
    // Line width 18/1000 of the 600 pt page width, as on screen.
    expect(operators).toMatch(/^10\.8 w$/m);
    expect(operators).toMatch(/^1 j$/m);
    expect(operators).toMatch(/^1 J$/m);
    expect(operators).toMatch(/\/GS-\d+ gs/);
  });

  it('builds one path per stroke in PDF space', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const { map, vw } = pageMapper(page);
    expect(vw).toBe(600);
    expect(strokePath(highlight.points.slice(0, 2), map)).toBe('M60.000,-720.000 L120.000,-704.000');
  });

  it('uses the displayed width of rotated pages for sizes', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setRotation(degrees(90));
    const { map, vw } = pageMapper(page);
    expect(vw).toBe(800);
    expect(map({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(map({ x: 1, y: 1 })).toEqual({ x: 600, y: 800 });
    const operators = await pageOperators(
      await exportAnnotated(await pdfAsset(90), [{ ...highlight, kind: 'pen', width: 2.5 }]),
    );
    expect(operators).toMatch(/^2 w$/m);
  });
});

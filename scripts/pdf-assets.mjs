import { cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const destination = resolve('public', 'pdfjs', version);
await mkdir(destination, { recursive: true });
for (const directory of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  await cp(join(source, directory), join(destination, directory), { recursive: true });
}
await cp(join(source, 'LICENSE'), join(destination, 'LICENSE'));
console.log(`PDF.js ${version}: local decoders, fonts and color profiles prepared.`);

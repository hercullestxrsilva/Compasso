import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const root = resolve('public', 'pdfjs');
const destination = join(root, version);
await mkdir(destination, { recursive: true });
// Older versions would otherwise be shipped and precached by the service worker.
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== version)
    await rm(join(root, entry.name), { recursive: true, force: true });
}
for (const directory of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  await cp(join(source, directory), join(destination, directory), { recursive: true });
}
await cp(join(source, 'LICENSE'), join(destination, 'LICENSE'));
console.log(`PDF.js ${version}: local decoders, fonts and color profiles prepared.`);

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
// Small geometric piano keyboard icon, generated locally for PWA installation.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(size) {
  const row = size * 4 + 1,
    pixels = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    pixels[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      let color = [18, 59, 64];
      if (u > 0.24 && u < 0.76 && v > 0.26 && v < 0.78) color = [245, 250, 248];
      if ((Math.abs(u - 0.415) < 0.01 || Math.abs(u - 0.585) < 0.01) && v > 0.26 && v < 0.78)
        color = [18, 59, 64];
      if (((u > 0.36 && u < 0.47) || (u > 0.53 && u < 0.64)) && v > 0.26 && v < 0.56) color = [18, 59, 64];
      if (Math.hypot(u - 0.75, v - 0.23) < 0.055) color = [232, 180, 105];
      const p = y * row + 1 + x * 4;
      pixels[p] = color[0];
      pixels[p + 1] = color[1];
      pixels[p + 2] = color[2];
      pixels[p + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
await mkdir('public', { recursive: true });
for (const size of [180, 192, 512]) await writeFile(`public/icon-${size}.png`, png(size));
console.log('PWA icons generated.');

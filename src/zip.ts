import { Inflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

/** Blobs are read and written in slices of this size so large media never sits whole in the JS heap. */
const CHUNK = 4 * 1024 * 1024;
/** Without zip64 every size and offset must fit in 32 bits. */
export const ZIP_MAX_BYTES = 0xffffffff;

export class ZipError extends Error {}

let crcTable: Uint32Array | undefined;
/** CRC-32 (the ZIP checksum). Pass the previous result to continue over several chunks. */
export function crc32(data: Uint8Array, previous = 0) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = ~previous;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

async function* chunks(blob: Blob) {
  for (let at = 0; at < blob.size; at += CHUNK)
    yield new Uint8Array(await blob.slice(at, Math.min(blob.size, at + CHUNK)).arrayBuffer());
}

/**
 * Collects output chunks into intermediate Blobs so that the browser, not the JS heap, holds the bytes
 * (Chrome pages large blobs to disk).
 */
export class BlobSink {
  private parts: Blob[] = [];
  private pending: Uint8Array<ArrayBuffer>[] = [];
  private pendingBytes = 0;
  size = 0;
  push(chunk: Uint8Array) {
    // Copy views into a shared buffer; whole buffers are kept by reference.
    const own = (
      chunk.byteOffset || chunk.byteLength !== chunk.buffer.byteLength ? chunk.slice() : chunk
    ) as Uint8Array<ArrayBuffer>;
    this.pending.push(own);
    this.pendingBytes += own.length;
    this.size += own.length;
    if (this.pendingBytes >= 16 * 1024 * 1024) this.flush();
  }
  private flush() {
    if (!this.pending.length) return;
    this.parts.push(new Blob(this.pending));
    this.pending = [];
    this.pendingBytes = 0;
  }
  toBlob(type: string) {
    this.flush();
    return new Blob(this.parts, { type });
  }
}

/** Streams entries into a ZIP Blob. Entries are written one after another, never held whole in memory. */
export class ZipWriter {
  private sink = new BlobSink();
  private failure: Error | null = null;
  private count = 0;
  private zip = new Zip((err, chunk) => {
    if (err) this.failure = err;
    else this.sink.push(chunk);
  });
  private check() {
    if (this.failure) throw this.failure;
    if (this.sink.size > ZIP_MAX_BYTES)
      throw new ZipError('O backup passou de 4 GB, o limite de um arquivo .zip.');
  }
  addBytes(name: string, data: Uint8Array, deflate: boolean) {
    const file = deflate ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    this.zip.add(file);
    this.count++;
    file.push(data, true);
    this.check();
  }
  async addBlob(name: string, blob: Blob, deflate: boolean, onBytes?: (n: number) => void) {
    const file = deflate ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    this.zip.add(file);
    this.count++;
    let read = 0;
    for await (const chunk of chunks(blob)) {
      read += chunk.length;
      file.push(chunk, read >= blob.size);
      this.check();
      onBytes?.(chunk.length);
    }
    if (!blob.size) file.push(new Uint8Array(0), true);
    this.check();
  }
  finish() {
    if (this.count > 0xfffe) throw new ZipError('O backup tem arquivos demais para um único .zip.');
    this.zip.end();
    this.check();
    return this.sink.toBlob('application/zip');
  }
}

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** Offset of the local file header. */
  offset: number;
}

const corrupt = () => new ZipError('O arquivo .zip está incompleto ou corrompido.');

/**
 * Lists the entries of a ZIP from its central directory. Only the directory is read, so this is cheap
 * even for a multi-GB file. A truncated file loses the directory at its end and is rejected here.
 */
export async function readZipDirectory(file: Blob) {
  if (file.size < 22) throw corrupt();
  const tailSize = Math.min(file.size, 22 + 0xffff);
  const tailStart = file.size - tailSize;
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw corrupt();
  const count = tail.getUint16(eocd + 10, true),
    cdSize = tail.getUint32(eocd + 12, true),
    cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new ZipError('Este .zip usa um formato estendido (zip64) que o Compasso não lê.');
  if (cdOffset + cdSize > tailStart + eocd) throw corrupt();
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw corrupt();
    if (cd.getUint16(p + 8, true) & 1)
      throw new ZipError('Arquivos .zip protegidos por senha não são aceitos.');
    const nameLength = cd.getUint16(p + 28, true);
    if (p + 46 + nameLength > cd.byteLength) throw corrupt();
    const entry: ZipEntry = {
      name: decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength)),
      method: cd.getUint16(p + 10, true),
      crc: cd.getUint32(p + 16, true),
      compressedSize: cd.getUint32(p + 20, true),
      size: cd.getUint32(p + 24, true),
      offset: cd.getUint32(p + 42, true),
    };
    if (entry.offset + 30 + entry.compressedSize > cdOffset) throw corrupt();
    entries.set(entry.name, entry);
    p += 46 + nameLength + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
  }
  return entries;
}

/** The raw (possibly compressed) bytes of an entry, as a lazy slice of the file. */
async function rawData(file: Blob, entry: ZipEntry) {
  const head = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (head.byteLength < 30 || head.getUint32(0, true) !== 0x04034b50) throw corrupt();
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  if (start + entry.compressedSize > file.size) throw corrupt();
  return { start, end: start + entry.compressedSize };
}

/**
 * Returns an entry's content after checking its size and CRC. Stored entries come back as a slice of
 * the file (no copy); deflated ones are inflated chunk by chunk. onBytes reports uncompressed progress.
 */
export async function extractEntry(
  file: Blob,
  entry: ZipEntry,
  {
    type = '',
    label = entry.name,
    onBytes,
  }: { type?: string; label?: string; onBytes?: (n: number) => void } = {},
) {
  const { start, end } = await rawData(file, entry);
  const damaged = () => new ZipError(`O arquivo “${label}” dentro do backup está corrompido.`);
  let crc = 0,
    size = 0;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw damaged();
    for await (const chunk of chunks(file.slice(start, end))) {
      crc = crc32(chunk, crc);
      onBytes?.(chunk.length);
    }
    if (crc !== entry.crc) throw damaged();
    return file.slice(start, end, type);
  }
  if (entry.method !== 8) throw new ZipError(`O arquivo “${label}” usa uma compressão não suportada.`);
  const sink = new BlobSink();
  const inflater = new Inflate(data => {
    size += data.length;
    if (size > entry.size) throw damaged();
    crc = crc32(data, crc);
    sink.push(data);
    onBytes?.(data.length);
  });
  try {
    for await (const chunk of chunks(file.slice(start, end))) inflater.push(chunk);
    inflater.push(new Uint8Array(0), true);
  } catch (e) {
    throw e instanceof ZipError ? e : damaged();
  }
  if (size !== entry.size || crc !== entry.crc) throw damaged();
  return sink.toBlob(type);
}

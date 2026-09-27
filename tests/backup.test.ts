import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { db } from '../src/db';
import {
  CLOUD_BACKUP_LIMIT,
  MAX_MEDIA_BYTES,
  backupAgeDays,
  backupTables,
  describeBackupAge,
  exportRoom,
  formatBytes,
  lastBackupAt,
  makeBackupZip,
  markBackup,
  openBackup,
  parseBackup,
  restoreBackup,
  type Backup,
} from '../src/backup';
import { crc32, readZipDirectory } from '../src/zip';
import { defaultConfig } from '../src/domain';
const fixture = (): Backup => ({
  format: 'compasso-backup',
  version: 1,
  createdAt: '2026-09-26',
  tables: {
    pieces: [
      {
        id: 'piece',
        title: 'Teste',
        composer: '',
        status: 'studying',
        tags: '',
        createdAt: '2026-09-26',
        updatedAt: '2026-09-26',
      },
    ],
    assets: [
      { id: 'asset', name: 'test.txt', mime: 'text/plain', size: 3, createdAt: '2026-09-26', data: 'YWJj' },
    ],
    scores: [{ id: 'score', pieceId: 'piece', assetId: 'asset', title: 'Teste', createdAt: '2026-09-26' }],
    annotations: [],
    segments: [],
    presets: [],
    sessions: [],
    lessons: [],
    notes: [],
    tasks: [],
    recordings: [],
    routines: [],
  },
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const table of backupTables) await db.table(table).clear();
});
describe('restore protects the existing library', () => {
  it('restores binary files and related records together', async () => {
    await restoreBackup(fixture());
    expect(await db.pieces.count()).toBe(1);
    expect(await (await db.assets.get('asset'))?.blob.text()).toBe('abc');
  });
  it('rejects malformed data before changing records', async () => {
    await restoreBackup(fixture());
    expect(() => parseBackup('{"format":"unknown"}')).toThrow();
    expect(() => parseBackup('not json')).toThrow('não é um backup válido');
    expect(await db.pieces.count()).toBe(1);
  });
  it('rejects truncated files without clearing existing data', async () => {
    await restoreBackup(fixture());
    const broken = fixture();
    broken.tables.assets[0].size = 4;
    await expect(restoreBackup(broken)).rejects.toThrow('incompleto');
    expect(await db.scores.count()).toBe(1);
  });
  it('rejects missing files referenced by a score', async () => {
    await restoreBackup(fixture());
    const broken = fixture();
    broken.tables.assets = [];
    await expect(restoreBackup(broken)).rejects.toThrow('referências');
    expect(await db.assets.count()).toBe(1);
  });
  it('keeps font size and moved coordinates through backup restoration', async () => {
    const backup = fixture();
    backup.tables.annotations.push({
      id: 'note',
      scoreId: 'score',
      page: 1,
      layer: 'Minhas notas',
      kind: 'text',
      color: '#087e8b',
      width: 2.4,
      points: [{ x: 0.62, y: 0.3 }],
      text: 'Dedilhado',
      fontSize: 48,
      createdAt: '2026-09-26',
    });
    await restoreBackup(parseBackup(JSON.stringify(backup)));
    const note = await db.annotations.get('note');
    expect(note?.fontSize).toBe(48);
    expect(note?.points[0].x).toBe(0.62);
  });
});

const pattern = (length: number, seed: number) =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + seed * 17 + (i >> 8)) & 0xff);
// ZIP signatures inside the media: entries must be found through the central directory, not by scanning.
const pdfBytes = new Uint8Array([
  ...strToU8('%PDF-1.7\n'),
  ...pattern(3000, 1),
  ...[0x50, 0x4b, 0x03, 0x04, 0x50, 0x4b, 0x07, 0x08, 0x50, 0x4b, 0x01, 0x02],
  ...pattern(3000, 2),
]);
// Larger than one read slice (4 MB) to cross chunk boundaries.
const audioBytes = pattern(5 * 1024 * 1024 + 123, 3);
const textBytes = strToU8('1 2 3 1 2 3 4 5 — ré');
const created = '2026-09-20T10:00:00.000Z';

async function seed() {
  await db.pieces.put({
    id: 'piece',
    title: 'Noturno',
    composer: 'Chopin',
    status: 'studying',
    tags: '',
    createdAt: created,
    updatedAt: created,
    // A field this schema does not know yet must survive too.
    ...({ reviewDate: '2026-10-01' } as object),
  });
  await db.assets.bulkPut([
    {
      id: 'pdf',
      name: 'noturno.pdf',
      mime: 'application/pdf',
      size: pdfBytes.length,
      blob: new Blob([pdfBytes], { type: 'application/pdf' }),
      createdAt: created,
    },
    {
      id: 'audio',
      name: 'aula.webm',
      mime: 'audio/webm',
      size: audioBytes.length,
      blob: new Blob([audioBytes], { type: 'audio/webm' }),
      createdAt: created,
    },
    {
      id: 'txt',
      name: 'dedilhado.txt',
      mime: 'text/plain',
      size: textBytes.length,
      blob: new Blob([textBytes], { type: 'text/plain' }),
      createdAt: created,
    },
    {
      id: 'empty',
      name: 'vazio.wav',
      mime: 'audio/wav',
      size: 0,
      blob: new Blob([], { type: 'audio/wav' }),
      createdAt: created,
    },
  ]);
  await db.scores.put({
    id: 'score',
    pieceId: 'piece',
    assetId: 'pdf',
    title: 'Edição Henle',
    createdAt: created,
  });
  await db.annotations.put({
    id: 'ann',
    scoreId: 'score',
    page: 1,
    layer: 'Dedilhado',
    kind: 'pen',
    color: '#087e8b',
    width: 2,
    points: [
      { x: 0.1, y: 0.2, pressure: 0.5 },
      { x: 0.3, y: 0.4 },
    ],
    createdAt: created,
  });
  await db.segments.put({
    id: 'seg',
    pieceId: 'piece',
    scoreId: 'score',
    title: 'Entrada',
    measures: '17–20',
    goal: 'Legato',
    difficulty: 'média',
    hand: 'left',
    regions: [{ page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.2 }],
    bpm: 56,
    reviewDate: '2026-09-30',
    createdAt: created,
    practiceConfig: { numerator: 3, bars: 4, metronome: false },
  });
  await db.presets.put({
    id: 'preset',
    name: 'Lento',
    segmentId: 'seg',
    config: { ...defaultConfig, bpm: 48 },
  });
  await db.sessions.put({
    id: 'session',
    pieceId: 'piece',
    segmentId: 'seg',
    title: 'Entrada',
    hand: 'left',
    config: { ...defaultConfig, metronome: false },
    startedAt: created,
    endedAt: created,
    activeSeconds: 300,
    completedRepetitions: 4,
    rating: 'difficult',
    note: 'Troquei o dedilhado no c. 19',
    completed: true,
    kind: 'segment',
    intention: 'Mão esquerda sem olhar',
    nextStep: 'Subir para 60',
    routineId: 'routine',
  });
  await db.lessons.put({
    id: 'lesson',
    title: 'Aula 3',
    date: '2026-09-19',
    teacher: 'Ana',
    pieceId: 'piece',
    assetId: 'audio',
    transcript: '',
    summary: '',
    createdAt: created,
  });
  await db.notes.put({
    id: 'note',
    lessonId: 'lesson',
    text: 'Pulso',
    source: 'teacher',
    timestamp: 12.5,
    createdAt: created,
  });
  await db.tasks.put({
    id: 'task',
    pieceId: 'piece',
    segmentId: 'seg',
    title: 'Mãos separadas',
    done: false,
    dueDate: '',
    createdAt: created,
  });
  await db.recordings.put({
    id: 'rec',
    assetId: 'empty',
    segmentId: 'seg',
    title: 'Tentativa',
    createdAt: created,
    sessionId: 'session',
    bpm: 56,
    hand: 'left',
  });
  await db.routines.put({
    id: 'routine',
    title: 'Manhã',
    items: [
      { label: 'Escalas', minutes: 5 },
      { segmentId: 'seg', minutes: 10, hand: 'left', bpm: 52 },
    ],
  });
}

async function dump() {
  const out: Record<string, unknown[]> = {};
  for (const name of backupTables) {
    const rows = await db.table(name).orderBy(':id').toArray();
    out[name] =
      name === 'assets'
        ? await Promise.all(
            rows.map(async ({ blob, ...asset }) => {
              const bytes = new Uint8Array(await blob.arrayBuffer());
              return { ...asset, type: blob.type, length: bytes.length, crc: crc32(bytes) };
            }),
          )
        : rows;
  }
  return out;
}

describe('zip backup (v2)', () => {
  it('round-trips every table and every file byte for byte', async () => {
    await seed();
    const before = await dump();
    const progress: number[] = [];
    const { blob, summary } = await makeBackupZip(p => progress.push(p.done / p.total));
    expect(blob.type).toBe('application/zip');
    expect(progress.at(-1)).toBe(1);
    expect(summary).toMatchObject({ pieces: 1, lessons: 1, recordings: 1, sessions: 1, bytes: blob.size });
    for (const table of backupTables) await db.table(table).clear();
    const prepared = await openBackup(blob);
    expect(prepared.summary).toMatchObject({ version: 2, pieces: 1, lessons: 1, recordings: 1, sessions: 1 });
    expect(prepared.summary.mediaBytes).toBe(pdfBytes.length + audioBytes.length + textBytes.length);
    expect(await db.pieces.count()).toBe(0);
    await prepared.apply();
    expect(await dump()).toEqual(before);
    const session = await db.sessions.get('session');
    expect(session).toMatchObject({
      kind: 'segment',
      intention: 'Mão esquerda sem olhar',
      nextStep: 'Subir para 60',
    });
    expect(session?.config.metronome).toBe(false);
    expect((await db.segments.get('seg'))?.practiceConfig).toEqual({
      numerator: 3,
      bars: 4,
      metronome: false,
    });
    expect((await db.routines.get('routine'))?.items[0]).toEqual({ label: 'Escalas', minutes: 5 });
    expect(await db.recordings.get('rec')).toMatchObject({ sessionId: 'session', bpm: 56, hand: 'left' });
    expect(await db.pieces.get('piece')).toMatchObject({ reviewDate: '2026-10-01' });
  });

  it('writes a standard zip: deflated manifest, media stored as raw files', async () => {
    await seed();
    const { blob } = await makeBackupZip();
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(
      ['assets/audio', 'assets/empty', 'assets/pdf', 'assets/txt', 'manifest.json'].sort(),
    );
    expect(files['assets/pdf']).toEqual(pdfBytes);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    expect(manifest).toMatchObject({ format: 'compasso-backup', version: 2 });
    expect(manifest.tables.assets).toBeUndefined();
    expect(manifest.assets.find((a: { id: string }) => a.id === 'pdf')).toMatchObject({
      name: 'noturno.pdf',
      mime: 'application/pdf',
      size: pdfBytes.length,
    });
    const entries = await readZipDirectory(blob);
    expect(entries.get('manifest.json')?.method).toBe(8);
    expect(entries.get('assets/txt')?.method).toBe(8);
    expect(entries.get('assets/pdf')?.method).toBe(0);
    expect(entries.get('assets/audio')?.method).toBe(0);
  });

  it('restores legacy .json backups through the same entry point', async () => {
    const prepared = await openBackup(new Blob([JSON.stringify(fixture())], { type: 'application/json' }));
    expect(prepared.summary).toMatchObject({ version: 1, pieces: 1, mediaBytes: 3 });
    await prepared.apply();
    expect(await (await db.assets.get('asset'))?.blob.text()).toBe('abc');
  });

  it('rejects a truncated zip and leaves the library untouched', async () => {
    await seed();
    const before = await dump();
    const { blob } = await makeBackupZip();
    for (const cut of [100, Math.floor(blob.size / 2), blob.size - 10])
      await expect(openBackup(blob.slice(0, cut))).rejects.toThrow('Nenhum dado foi alterado');
    expect(await dump()).toEqual(before);
  });

  it('rejects damaged media by checksum', async () => {
    await seed();
    const { blob } = await makeBackupZip();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const entry = (await readZipDirectory(blob)).get('assets/audio')!;
    bytes[entry.offset + 30 + 'assets/audio'.length + 4096] ^= 0xff;
    await expect(openBackup(new Blob([bytes]))).rejects.toThrow(
      '“aula.webm” dentro do backup está corrompido',
    );
    expect(await db.assets.count()).toBe(4);
  });

  it('rejects a backup with a missing or resized file', async () => {
    await seed();
    const { blob } = await makeBackupZip();
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const withoutPdf = { ...files };
    delete withoutPdf['assets/pdf'];
    await expect(openBackup(new Blob([zipSync(withoutPdf)]))).rejects.toThrow(
      'falta o arquivo “noturno.pdf”',
    );
    const resized = { ...files, 'assets/audio': audioBytes.subarray(10) };
    await expect(openBackup(new Blob([zipSync(resized)]))).rejects.toThrow('incompleto');
    expect(await db.scores.count()).toBe(1);
  });

  it('rejects other files, invalid manifests and newer versions', async () => {
    await expect(openBackup(new Blob(['olá']))).rejects.toThrow('.zip');
    await expect(openBackup(new Blob([zipSync({ 'foto.jpg': new Uint8Array(4) })]))).rejects.toThrow(
      'não é um backup',
    );
    const manifest = (value: object) =>
      new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(value)) })]);
    await expect(openBackup(manifest({ format: 'compasso-backup', version: 2 }))).rejects.toThrow('válido');
    await expect(openBackup(manifest({ format: 'compasso-backup', version: 3 }))).rejects.toThrow(
      'mais nova',
    );
  });

  it('applies the restore atomically: a failing write keeps the previous data', async () => {
    await seed();
    const { blob } = await makeBackupZip();
    await db.pieces.put({ ...(await db.pieces.get('piece'))!, id: 'extra', title: 'Só neste navegador' });
    const before = await dump();
    const prepared = await openBackup(blob);
    vi.spyOn(db.table('routines'), 'bulkPut').mockRejectedValue(new Error('disco cheio'));
    await expect(prepared.apply()).rejects.toThrow('disco cheio');
    expect(await dump()).toEqual(before);
  });
});

describe('backup helpers', () => {
  it('computes the standard CRC-32, also across chunks', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
    expect(crc32(strToU8('6789'), crc32(strToU8('12345')))).toBe(0xcbf43926);
  });
  it('counts whole days since the last backup', () => {
    const now = new Date(2026, 8, 26, 9, 0);
    expect(backupAgeDays(null, now)).toBeNull();
    expect(backupAgeDays(new Date(2026, 8, 26, 1, 0).toISOString(), now)).toBe(0);
    expect(backupAgeDays(new Date(2026, 8, 25, 23, 0).toISOString(), now)).toBe(1);
    expect(backupAgeDays('2026-09-18', now)).toBe(8);
    expect([0, 1, 12].map(describeBackupAge)).toEqual(['hoje', 'ontem', 'há 12 dias']);
  });
  it('remembers the last backup and survives blocked storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(lastBackupAt()).toBeNull();
    markBackup('2026-09-26T12:00:00.000Z');
    expect(lastBackupAt()).toBe('2026-09-26T12:00:00.000Z');
    markBackup('2026-08-01');
    expect(lastBackupAt()).toBe('2026-08-01T00:00:00.000Z');
    markBackup('não é data');
    expect(Date.parse(lastBackupAt()!)).toBeGreaterThan(Date.parse('2026-08-02'));
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(lastBackupAt()).toBeNull();
    expect(() => markBackup()).not.toThrow();
  });
  it('warns about space and refuses only impossible sizes', () => {
    expect(exportRoom(10 * 1024 * 1024)).toBe('ok');
    expect(exportRoom(10 * 1024 * 1024, { quota: 100 * 1024 * 1024, usage: 95 * 1024 * 1024 })).toBe('tight');
    expect(exportRoom(10 * 1024 * 1024, { quota: 1024 ** 3, usage: 50 * 1024 * 1024 })).toBe('ok');
    expect(exportRoom(MAX_MEDIA_BYTES + 1)).toBe('too-large');
  });
  it('uses the same cloud size limit as the Supabase migrations', () => {
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const sql = readdirSync(dir)
      .map(name => readFileSync(new URL(name, dir), 'utf8'))
      .join('\n');
    const limits = [...sql.matchAll(/(?:file_size_limit\s*=\s*|bytes <= |false,)(\d+)/g)].map(m =>
      Number(m[1]),
    );
    expect(limits.length).toBeGreaterThanOrEqual(3);
    expect(new Set(limits)).toEqual(new Set([CLOUD_BACKUP_LIMIT]));
    expect(sql).toContain("'application/zip'");
  });
  it('formats sizes in Portuguese', () => {
    expect(formatBytes(CLOUD_BACKUP_LIMIT)).toBe('45 MB');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1,3 GB');
  });
});

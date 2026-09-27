import { z } from 'zod';
import { strToU8 } from 'fflate';
import { db } from './db';
import { configSchema, localDay, type Asset } from './domain';
import { ZIP_MAX_BYTES, ZipError, ZipWriter, extractEntry, readZipDirectory } from './zip';

const id = z.string().min(1).max(100),
  optionalId = id.optional(),
  str = z.string().max(100000),
  date = z.string().max(50);
// Rows are loose: a field added later survives a backup even before this schema learns about it.
const row = z.looseObject;
const config = configSchema.loose();
const point = z.object({
  x: z.number().min(0).max(1.01),
  y: z.number().min(0).max(1.01),
  pressure: z.number().optional(),
});
const rating = z.enum(['difficult', 'improving', 'comfortable']).optional();
const hand = z.enum(['left', 'right', 'both']);
const tablesSchema = z.object({
  pieces: z
    .array(
      row({
        id,
        title: str,
        composer: str,
        status: z.enum(['planned', 'studying', 'learned']),
        tags: str,
        createdAt: date,
        updatedAt: date,
      }),
    )
    .max(10000),
  scores: z.array(row({ id, pieceId: id, assetId: id, title: str, createdAt: date })).max(20000),
  annotations: z
    .array(
      row({
        id,
        scoreId: id,
        page: z.number().int().positive(),
        layer: str,
        kind: z.enum(['pen', 'highlight', 'text']),
        color: z.string().regex(/^#[\da-fA-F]{6}$/),
        width: z.number().positive().max(100),
        points: z.array(point).min(1).max(100000),
        text: str.optional(),
        fontSize: z.number().int().min(10).max(100).optional(),
        createdAt: date,
      }),
    )
    .max(100000),
  segments: z
    .array(
      row({
        id,
        pieceId: id,
        scoreId: z.string().max(100),
        title: str,
        measures: str,
        goal: str,
        difficulty: str,
        hand,
        regions: z.array(
          z.object({
            page: z.number().int().positive(),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().positive().max(1),
            h: z.number().positive().max(1),
          }),
        ),
        bpm: z.number().min(20).max(300),
        rating,
        reviewDate: date,
        createdAt: date,
        practiceConfig: config.partial().optional(),
      }),
    )
    .max(20000),
  presets: z.array(row({ id, name: str, segmentId: optionalId, config })).max(10000),
  sessions: z
    .array(
      row({
        id,
        pieceId: optionalId,
        segmentId: optionalId,
        title: str,
        hand,
        config,
        startedAt: date,
        endedAt: date,
        activeSeconds: z.number().nonnegative(),
        completedRepetitions: z.number().nonnegative(),
        rating,
        note: str,
        completed: z.boolean(),
        kind: z.enum(['segment', 'piece', 'free']).optional(),
        intention: str.optional(),
        nextStep: str.optional(),
        routineId: optionalId,
      }),
    )
    .max(100000),
  lessons: z
    .array(
      row({
        id,
        title: str,
        date,
        teacher: str,
        pieceId: z.string().max(100),
        assetId: optionalId,
        transcript: str,
        summary: str,
        createdAt: date,
      }),
    )
    .max(10000),
  notes: z
    .array(
      row({
        id,
        pieceId: optionalId,
        lessonId: optionalId,
        text: str,
        source: z.enum(['mine', 'teacher', 'ai']),
        timestamp: z.number().nonnegative().optional(),
        createdAt: date,
      }),
    )
    .max(100000),
  tasks: z
    .array(
      row({
        id,
        pieceId: z.string().max(100),
        segmentId: optionalId,
        lessonId: optionalId,
        title: str,
        done: z.boolean(),
        dueDate: date,
        createdAt: date,
      }),
    )
    .max(100000),
  recordings: z
    .array(
      row({
        id,
        assetId: id,
        segmentId: optionalId,
        title: str,
        createdAt: date,
        sessionId: optionalId,
        bpm: z.number().min(20).max(300).optional(),
        hand: hand.optional(),
      }),
    )
    .max(10000),
  routines: z
    .array(
      row({
        id,
        title: str,
        items: z.array(
          row({
            segmentId: optionalId,
            label: str.optional(),
            minutes: z.number().positive().max(120),
            hand: hand.optional(),
            bpm: z.number().min(20).max(300).optional(),
          }),
        ),
      }),
    )
    .max(10000),
  assets: z
    .array(
      row({
        id,
        name: str,
        mime: z.string().max(150),
        size: z
          .number()
          .nonnegative()
          .max(100 * 1024 * 1024),
        createdAt: date,
        data: z.string().max(140 * 1024 * 1024),
      }),
    )
    .max(20000),
});
/** Legacy format (v1): one JSON file with every asset inlined as base64. Still accepted for restore. */
export const backupSchema = z.object({
  format: z.literal('compasso-backup'),
  version: z.literal(1),
  createdAt: date,
  tables: tablesSchema,
});
export type Backup = z.infer<typeof backupSchema>;

export const BACKUP_VERSION = 2;
const assetMeta = row({
  id,
  name: str,
  mime: z.string().max(150),
  size: z.number().int().nonnegative().max(ZIP_MAX_BYTES),
  createdAt: date,
});
/** manifest.json of a v2 .zip backup; each asset's bytes live in assets/<id>. */
export const manifestSchema = z.object({
  format: z.literal('compasso-backup'),
  version: z.literal(BACKUP_VERSION),
  createdAt: date,
  tables: tablesSchema.omit({ assets: true }),
  assets: z.array(assetMeta).max(20000),
});
export type Manifest = z.infer<typeof manifestSchema>;
type Tables = Manifest['tables'];

export const backupTables = [
  'pieces',
  'scores',
  'annotations',
  'segments',
  'presets',
  'sessions',
  'lessons',
  'notes',
  'tasks',
  'recordings',
  'routines',
  'assets',
] as const;
const recordTables = backupTables.filter(n => n !== 'assets') as Exclude<
  (typeof backupTables)[number],
  'assets'
>[];

/** Size limit of the cloud bucket and of compasso_backups.bytes (supabase/migrations/002_zip_backups.sql). */
export const CLOUD_BACKUP_LIMIT = 45 * 1024 * 1024;
/** Media plus a margin for manifest and headers must fit in a ZIP without zip64. */
export const MAX_MEDIA_BYTES = ZIP_MAX_BYTES - 64 * 1024 * 1024;
const LEGACY_LIMIT = 180 * 1024 * 1024;
const MANIFEST_LIMIT = 512 * 1024 * 1024;

export interface BackupProgress {
  done: number;
  total: number;
}
export interface BackupSummary {
  createdAt: string;
  version: number;
  /** Size of the backup file. */
  bytes: number;
  mediaBytes: number;
  pieces: number;
  lessons: number;
  recordings: number;
  sessions: number;
}
interface RestoreData {
  createdAt: string;
  version: number;
  tables: Tables;
  assets: Asset[];
}

// Text-like media gains from deflate; PDFs, audio and images are already compressed.
const deflatable = (mime: string) => /^text\/|json|xml|svg/.test(mime);
export const backupFileName = (d = new Date()) => `compasso-backup-${localDay(d)}.zip`;

/** Total bytes of media in the library, read before exporting to warn early. */
export async function mediaBytes() {
  let total = 0;
  await db.assets.each(a => {
    total += a.blob?.size ?? a.size;
  });
  return total;
}

/** 'too-large' cannot be written at all; 'tight' means the browser reports less free space than needed. */
export function exportRoom(bytes: number, estimate?: StorageEstimate): 'ok' | 'tight' | 'too-large' {
  if (bytes > MAX_MEDIA_BYTES) return 'too-large';
  if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < bytes * 1.1)
    return 'tight';
  return 'ok';
}

function summarize(data: Omit<RestoreData, 'assets'> & { assets: { size: number }[] }, bytes: number) {
  const summary: BackupSummary = {
    createdAt: data.createdAt,
    version: data.version,
    bytes,
    mediaBytes: data.assets.reduce((s, a) => s + a.size, 0),
    pieces: data.tables.pieces.length,
    lessons: data.tables.lessons.length,
    recordings: data.tables.recordings.length,
    sessions: data.tables.sessions.length,
  };
  return summary;
}

/**
 * Builds a v2 backup: manifest.json (deflated) plus assets/<id> with the raw bytes of each file.
 * Media is streamed from IndexedDB in slices; nothing is base64-encoded.
 */
export async function makeBackupZip(onProgress?: (p: BackupProgress) => void) {
  const tables: Record<string, unknown[]> = {};
  let assets: Asset[] = [];
  // Read a consistent snapshot; the rows hold Blob handles, not the bytes.
  await db.transaction(
    'r',
    backupTables.map(n => db.table(n)),
    async () => {
      for (const name of recordTables) tables[name] = await db.table(name).toArray();
      assets = await db.assets.toArray();
    },
  );
  const missing = assets.find(a => !(a.blob instanceof Blob));
  if (missing) throw new Error(`O arquivo “${missing.name}” não pôde ser lido deste navegador.`);
  const total = assets.reduce((s, a) => s + a.blob.size, 0);
  if (total > MAX_MEDIA_BYTES)
    throw new Error('O acervo passa de 4 GB, o limite de um arquivo de backup. Nenhum arquivo foi gerado.');
  const parsed = manifestSchema.safeParse({
    format: 'compasso-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tables,
    assets: assets.map(({ blob, ...meta }) => ({ ...meta, size: blob.size })),
  });
  if (!parsed.success)
    throw new Error(
      `Um registro do acervo não passou na verificação (${parsed.error.issues[0].path.join('.')}). Nenhum arquivo foi gerado.`,
    );
  const manifest = parsed.data;
  const zip = new ZipWriter();
  zip.addBytes('manifest.json', strToU8(JSON.stringify(manifest)), true);
  let done = 0;
  onProgress?.({ done, total });
  for (const asset of assets) {
    try {
      await zip.addBlob(`assets/${asset.id}`, asset.blob, deflatable(asset.mime), n => {
        done += n;
        onProgress?.({ done, total });
      });
    } catch (e) {
      if (e instanceof ZipError) throw e;
      throw new Error(`Não foi possível ler “${asset.name}” do acervo. Nenhum arquivo foi gerado.`, {
        cause: e,
      });
    }
  }
  const blob = zip.finish();
  const summary = summarize({ ...manifest, version: BACKUP_VERSION }, blob.size);
  return { blob, summary };
}

export function parseBackup(text: string): Backup {
  if (text.length > LEGACY_LIMIT) throw new Error('O backup excede o limite de 180 MB.');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const result = backupSchema.safeParse(json);
  if (!result.success)
    throw new Error('Este arquivo não é um backup válido do Compasso. Nenhum dado foi alterado.');
  return result.data;
}

function decodeLegacy(data: Backup): RestoreData {
  const assets = data.tables.assets.map(({ data: encoded, ...asset }) => {
    let raw: string;
    try {
      raw = atob(encoded);
    } catch {
      throw new Error('Arquivo inválido no backup.');
    }
    if (raw.length !== asset.size) throw new Error('Um arquivo do backup está incompleto.');
    return { ...asset, blob: new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], { type: asset.mime }) };
  });
  const { assets: _, ...tables } = data.tables;
  return { createdAt: data.createdAt, version: 1, tables, assets };
}

function checkReferences({ tables, assets }: RestoreData) {
  const assetIds = new Set(assets.map(a => a.id)),
    pieceIds = new Set(tables.pieces.map(p => p.id)),
    scoreIds = new Set(tables.scores.map(s => s.id));
  if (
    tables.scores.some(s => !assetIds.has(s.assetId) || !pieceIds.has(s.pieceId)) ||
    tables.lessons.some(l => l.assetId && !assetIds.has(l.assetId)) ||
    tables.recordings.some(r => !assetIds.has(r.assetId)) ||
    tables.annotations.some(a => !scoreIds.has(a.scoreId))
  )
    throw new Error('O backup contém referências incompletas. Nenhum dado foi alterado.');
}

/** Replaces every backed-up table in one transaction: if anything fails, nothing changes. */
async function applyRestore({ tables, assets }: RestoreData) {
  await db.transaction(
    'rw',
    backupTables.map(n => db.table(n)),
    async () => {
      for (const name of backupTables) {
        await db.table(name).clear();
        const rows = name === 'assets' ? assets : tables[name];
        if (rows.length) await db.table(name).bulkPut(rows);
      }
    },
  );
}

/** Restores a legacy v1 backup object (kept for compatibility and tests). */
export async function restoreBackup(input: Backup) {
  const data = decodeLegacy(backupSchema.parse(input));
  checkReferences(data);
  await applyRestore(data);
}

async function readZipBackup(file: Blob, onProgress?: (p: BackupProgress) => void): Promise<RestoreData> {
  const entries = await readZipDirectory(file);
  const manifestEntry = entries.get('manifest.json');
  if (!manifestEntry) throw new Error('Este .zip não é um backup do Compasso.');
  if (manifestEntry.size > MANIFEST_LIMIT) throw new Error('O índice deste backup é grande demais.');
  let json: { format?: unknown; version?: unknown } | undefined;
  try {
    json = JSON.parse(await (await extractEntry(file, manifestEntry, { label: 'manifest.json' })).text());
  } catch (e) {
    if (e instanceof ZipError) throw e;
  }
  if (json?.format === 'compasso-backup' && typeof json.version === 'number' && json.version > BACKUP_VERSION)
    throw new Error('Este backup foi criado por uma versão mais nova do Compasso. Atualize o aplicativo.');
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new Error('Este arquivo não é um backup válido do Compasso.');
  const manifest = parsed.data;
  const total = manifest.assets.reduce((s, a) => s + a.size, 0);
  let done = 0;
  onProgress?.({ done, total });
  const assets: Asset[] = [];
  for (const meta of manifest.assets) {
    const entry = entries.get(`assets/${meta.id}`);
    if (!entry) throw new Error(`O backup está incompleto: falta o arquivo “${meta.name}”.`);
    if (entry.size !== meta.size) throw new Error(`O arquivo “${meta.name}” está incompleto no backup.`);
    const blob = await extractEntry(file, entry, {
      type: meta.mime,
      label: meta.name,
      onBytes: n => {
        done += n;
        onProgress?.({ done, total });
      },
    });
    assets.push({ ...meta, blob });
  }
  return { createdAt: manifest.createdAt, version: BACKUP_VERSION, tables: manifest.tables, assets };
}

async function sniff(file: Blob) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
  const text = new TextDecoder().decode(head).trimStart();
  if (text.startsWith('{')) return 'json';
  throw new Error('Escolha um backup do Compasso (.zip, ou .json de versões anteriores).');
}

export interface PreparedRestore {
  summary: BackupSummary;
  /** Replaces this browser's data with the backup, atomically. */
  apply(): Promise<void>;
}

/**
 * Reads and fully verifies a backup (.zip, or legacy .json) without touching the database:
 * schema, every asset present with the right size and checksum, and references between records.
 */
export async function openBackup(
  file: Blob,
  onProgress?: (p: BackupProgress) => void,
): Promise<PreparedRestore> {
  let data: RestoreData;
  try {
    if ((await sniff(file)) === 'zip') data = await readZipBackup(file, onProgress);
    else {
      if (file.size > LEGACY_LIMIT) throw new Error('Backups .json antigos aceitam até 180 MB.');
      data = decodeLegacy(parseBackup(await file.text()));
    }
    checkReferences(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Não foi possível ler o backup.';
    throw new Error(message.includes('Nenhum dado') ? message : `${message} Nenhum dado foi alterado.`, {
      cause: e,
    });
  }
  return { summary: summarize(data, file.size), apply: () => applyRestore(data) };
}

const LAST_BACKUP_KEY = 'compasso:lastBackupAt';
/** Fired on window after markBackup, so other parts of the app can refresh their reminder. */
export const BACKUP_EVENT = 'compasso:backup';

/** When the last successful export or cloud copy happened in this browser (ISO string), or null. */
export function lastBackupAt(): string | null {
  try {
    const value = localStorage.getItem(LAST_BACKUP_KEY);
    return value && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}
export function markBackup(at: string | Date = new Date()) {
  const when = new Date(at);
  try {
    localStorage.setItem(LAST_BACKUP_KEY, (Number.isNaN(when.getTime()) ? new Date() : when).toISOString());
  } catch {
    // Private mode or blocked storage: the reminder simply stays on.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BACKUP_EVENT));
}

/** Whole calendar days between the backup and now (0 = today), or null when there is none. */
export function backupAgeDays(at: string | null, now = new Date()) {
  if (!at) return null;
  const then = new Date(at.length === 10 ? `${at}T12:00:00` : at);
  if (Number.isNaN(then.getTime())) return null;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((day(now) - day(then)) / 86400000));
}
export const describeBackupAge = (days: number) =>
  days === 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`;
export const BACKUP_STALE_DAYS = 7;

export function formatBytes(bytes: number) {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit < 2 ? 0 : 1 })} ${units[unit]}`;
}

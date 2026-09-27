import { z } from 'zod';
import { strToU8 } from 'fflate';
import { db } from './db';
import { configSchema, localDay, type Asset } from './domain';
import { ZIP_MAX_BYTES, ZipError, ZipWriter, extractEntry, readZipDirectory, type ZipEntry } from './zip';

const id = z.string().min(1).max(100),
  optionalId = id.optional(),
  str = z.string().max(100000),
  // Transcripts come from the AI service untruncated; a long lesson must never block a backup.
  longText = z.string().max(2_000_000),
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
        note: longText,
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
        transcript: longText,
        summary: longText,
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
        text: longText,
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
  /** Files left out because this browser could not read them; records may still point to them. */
  missingAssets: z
    .array(row({ id, name: str }))
    .max(20000)
    .optional(),
});
export type Manifest = z.infer<typeof manifestSchema>;
type Tables = Manifest['tables'];
type Row = Record<string, unknown>;

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
export type BackupTable = (typeof backupTables)[number];
const recordTables = backupTables.filter(n => n !== 'assets') as Exclude<BackupTable, 'assets'>[];

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
  /** Files that were unreadable when the backup was made and are not inside it. */
  missingFiles: number;
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
  /** Ids of files recorded as missing in the manifest; references to them are expected. */
  missing: string[];
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
    missingFiles: data.missing.length,
    pieces: data.tables.pieces.length,
    lessons: data.tables.lessons.length,
    recordings: data.tables.recordings.length,
    sessions: data.tables.sessions.length,
  };
  return summary;
}

const quoted = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? `“${text.length > 60 ? `${text.slice(0, 59)}…` : text}”` : 'sem título';
};
const rowLabels: Record<string, (r: Row) => string> = {
  pieces: r => `a peça ${quoted(r.title)}`,
  scores: r => `a partitura ${quoted(r.title)}`,
  annotations: () => 'uma marcação de partitura',
  segments: r => `o trecho ${quoted(r.title)}`,
  presets: r => `a configuração ${quoted(r.name)}`,
  sessions: r => `a sessão ${quoted(r.title)}`,
  lessons: r => `a aula ${quoted(r.title)}`,
  notes: () => 'uma nota',
  tasks: r => `a tarefa ${quoted(r.title)}`,
  recordings: r => `a gravação ${quoted(r.title)}`,
  routines: r => `a rotina ${quoted(r.title)}`,
  assets: r => `o arquivo ${quoted(r.name)}`,
};
const fieldLabels: Record<string, string> = {
  title: 'título',
  name: 'nome',
  composer: 'compositor',
  teacher: 'professor',
  transcript: 'transcrição',
  summary: 'resumo',
  text: 'texto',
  note: 'observação',
  goal: 'objetivo',
  measures: 'compassos',
  intention: 'intenção',
  nextStep: 'próximo passo',
  points: 'traço',
  regions: 'região na partitura',
  items: 'etapas',
  config: 'configuração',
  practiceConfig: 'configuração de prática',
  bpm: 'andamento',
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Names the record behind a schema issue, so the student knows which item to fix. */
function describeInvalid(issue: z.core.$ZodIssue, tables: Record<string, unknown[]>, assets: Row[]) {
  const [first, ...rest] = issue.path;
  const [table, index, field] =
    first === 'tables' ? rest : first === 'assets' ? ['assets', ...rest] : [undefined, undefined, undefined];
  const rows = table === 'assets' ? assets : tables[String(table)];
  const r = typeof index === 'number' ? (rows?.[index] as Row | undefined) : undefined;
  const label = r && rowLabels[String(table)] ? rowLabels[String(table)](r) : 'um registro do acervo';
  const where = typeof field === 'string' ? ` em “${fieldLabels[field] ?? field}”` : '';
  const what = issue.code === 'too_big' ? 'um texto longo demais' : 'um valor fora do formato esperado';
  return `${capitalize(label)} tem ${what}${where}. Edite ou apague esse item e exporte de novo. Nenhum arquivo foi gerado.`;
}

export interface UnreadableAsset {
  id: string;
  name: string;
  /** What the file belongs to, e.g. 'gravação “Tentativa”'. */
  owner: string;
}
export function describeUnreadable(assets: UnreadableAsset[]) {
  const label = (a: UnreadableAsset) => `“${a.name}”${a.owner ? ` (${a.owner})` : ''}`;
  return assets.length === 1
    ? `O arquivo ${label(assets[0])} não pôde ser lido neste navegador.`
    : `${assets.length} arquivos não puderam ser lidos neste navegador: ${assets.slice(0, 3).map(label).join(', ')}${assets.length > 3 ? ' e outros' : ''}.`;
}
/** Media this browser can no longer read. The export can be repeated without those files (skip). */
export class UnreadableAssetError extends Error {
  readonly assets: UnreadableAsset[];
  constructor(assets: UnreadableAsset[]) {
    super(
      `${describeUnreadable(assets)} ${
        assets.length === 1
          ? 'Apague esse item ou exporte o restante sem ele.'
          : 'Apague esses itens ou exporte o restante sem eles.'
      } Nenhum arquivo foi gerado.`,
    );
    this.assets = assets;
  }
}

function ownerOf(assetId: string, tables: Record<string, unknown[]>) {
  const find = (name: string) => (tables[name] as Row[]).find(r => r.assetId === assetId);
  const score = find('scores'),
    lesson = find('lessons'),
    recording = find('recordings');
  if (score) return `partitura ${quoted(score.title)}`;
  if (lesson) return `áudio da aula ${quoted(lesson.title)}`;
  return recording ? `gravação ${quoted(recording.title)}` : '';
}

async function readable(blob: unknown) {
  if (!(blob instanceof Blob)) return false;
  try {
    // A blob whose file the browser lost fails on its first read.
    await blob.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a v2 backup: manifest.json (deflated) plus assets/<id> with the raw bytes of each file.
 * Media is streamed from IndexedDB in slices; nothing is base64-encoded. Files listed in skip are left out
 * and recorded in manifest.missingAssets; any other unreadable file throws UnreadableAssetError.
 */
export async function makeBackupZip(onProgress?: (p: BackupProgress) => void, skip: readonly string[] = []) {
  const tables: Record<string, unknown[]> = {};
  let stored: Asset[] = [];
  // Taken before the snapshot: anything saved from now on is newer than this backup.
  const createdAt = new Date().toISOString();
  // Read a consistent snapshot; the rows hold Blob handles, not the bytes.
  await db.transaction(
    'r',
    backupTables.map(n => db.table(n)),
    async () => {
      for (const name of recordTables) tables[name] = await db.table(name).toArray();
      stored = await db.assets.toArray();
    },
  );
  const skipped = new Set(skip);
  const assets: Asset[] = [],
    unreadable: UnreadableAsset[] = [];
  for (const asset of stored) {
    if (skipped.has(asset.id)) continue;
    if (await readable(asset.blob)) assets.push(asset);
    else unreadable.push({ id: asset.id, name: asset.name, owner: ownerOf(asset.id, tables) });
  }
  if (unreadable.length) throw new UnreadableAssetError(unreadable);
  const total = assets.reduce((s, a) => s + a.blob.size, 0);
  if (total > MAX_MEDIA_BYTES)
    throw new Error('O acervo passa de 4 GB, o limite de um arquivo de backup. Nenhum arquivo foi gerado.');
  const missingAssets = stored.filter(a => skipped.has(a.id)).map(a => ({ id: a.id, name: a.name }));
  const metas = assets.map(({ blob, ...meta }) => ({ ...meta, size: blob.size }));
  const parsed = manifestSchema.safeParse({
    format: 'compasso-backup',
    version: BACKUP_VERSION,
    createdAt,
    tables,
    assets: metas,
    ...(missingAssets.length ? { missingAssets } : {}),
  });
  if (!parsed.success) throw new Error(describeInvalid(parsed.error.issues[0], tables, metas));
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
      throw new UnreadableAssetError([{ id: asset.id, name: asset.name, owner: ownerOf(asset.id, tables) }]);
    }
  }
  const blob = zip.finish();
  const summary = summarize(
    { ...manifest, version: BACKUP_VERSION, missing: missingAssets.map(a => a.id) },
    blob.size,
  );
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
  if (result.success) return result.data;
  const head = json as { format?: unknown; version?: unknown } | null | undefined;
  if (head?.format === 'compasso-backup' && head.version === BACKUP_VERSION)
    throw new Error(
      'Este é só o índice do backup (manifest.json), sem as partituras e gravações. Escolha o arquivo .zip completo. Nenhum dado foi alterado.',
    );
  throw new Error('Este arquivo não é um backup válido do Compasso. Nenhum dado foi alterado.');
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
  return { createdAt: data.createdAt, version: 1, tables, assets, missing: [] };
}

function checkReferences({ tables, assets, missing }: RestoreData) {
  const assetIds = new Set([...assets.map(a => a.id), ...missing]),
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

/** True when a write failed because the browser ran out of storage (Dexie wraps it in inner/cause). */
export function isQuotaError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const { name, message, inner, cause } = current as Record<string, unknown>;
    if (/quota/i.test(`${String(name)} ${String(message)}`)) return true;
    current = inner ?? cause;
  }
  return false;
}

/** Replaces every backed-up table in one transaction: if anything fails, nothing changes. */
async function applyRestore({ tables, assets }: RestoreData) {
  try {
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
  } catch (e) {
    throw new Error(
      isQuotaError(e)
        ? 'Não há espaço suficiente neste navegador para restaurar este backup: até o fim, o acervo atual e o backup ocupam espaço ao mesmo tempo. Nenhum dado foi alterado.'
        : 'Não foi possível gravar o backup neste navegador. Nenhum dado foi alterado.',
      { cause: e },
    );
  }
}

/** Restores a legacy v1 backup object (kept for compatibility and tests). */
export async function restoreBackup(input: Backup) {
  const data = decodeLegacy(backupSchema.parse(input));
  checkReferences(data);
  await applyRestore(data);
}

/** '' for a backup as exported; 'folder/' after it was extracted and compressed again (Finder, Explorer). */
function manifestRoot(entries: Map<string, ZipEntry>) {
  if (entries.has('manifest.json')) return '';
  const nested = [...entries.keys()].filter(n => n.endsWith('/manifest.json') && !n.startsWith('__MACOSX/'));
  return nested.length === 1 ? nested[0].slice(0, -'manifest.json'.length) : undefined;
}

async function readZipBackup(file: Blob, onProgress?: (p: BackupProgress) => void): Promise<RestoreData> {
  const entries = await readZipDirectory(file);
  const root = manifestRoot(entries);
  const manifestEntry = root === undefined ? undefined : entries.get(`${root}manifest.json`);
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
    const entry = entries.get(`${root}assets/${meta.id}`);
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
  return {
    createdAt: manifest.createdAt,
    version: BACKUP_VERSION,
    tables: manifest.tables,
    assets,
    missing: (manifest.missingAssets ?? []).map(a => a.id),
  };
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
  /** Replaces this browser's data with the backup, atomically. Errors are in Portuguese and say nothing changed. */
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

/** Supabase answers in English; turns the usual failures into a sentence the student can act on. */
export function cloudErrorText(error: unknown, fallback: string) {
  const { status, statusCode, code, message, name } = (
    error && typeof error === 'object' ? error : {}
  ) as Record<string, unknown>;
  const http = Number(status ?? statusCode);
  const text = `${String(code ?? '')} ${String(message ?? '')}`;
  if (/invalid login credentials|invalid_credentials/i.test(text)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(text)) return 'Confirme o e-mail desta conta antes de entrar.';
  if (http === 415 || /mime/i.test(text))
    return 'A nuvem ainda não aceita cópias .zip. Aplique supabase/migrations/002_zip_backups.sql no projeto (veja o README).';
  if (http === 413 || /too ?large|maximum allowed size/i.test(text))
    return `A cópia passa do limite de ${formatBytes(CLOUD_BACKUP_LIMIT)} da nuvem. Use “Exportar backup” para guardar tudo.`;
  if (http === 401 || http === 403 || /jwt|unauthori[sz]ed|row-level security/i.test(text))
    return 'Sua sessão na nuvem expirou ou não tem permissão para isso. Saia e entre de novo.';
  if (http === 404 || /not.?found/i.test(text)) return 'Esta cópia não foi encontrada na nuvem.';
  if (name === 'TypeError' || /failed to fetch|load failed|network/i.test(text))
    return 'Não foi possível falar com a nuvem. Confira a internet e tente de novo.';
  return fallback;
}

const LAST_BACKUP_KEY = 'compasso:lastBackupAt',
  LAST_BACKUP_HOW_KEY = 'compasso:lastBackupHow';
/** Fired on window after markBackup, so other parts of the app can refresh their reminder. */
export const BACKUP_EVENT = 'compasso:backup';
/**
 * How the last backup was made: 'file' written through a save dialog, 'download' handed to the browser
 * (its saving cannot be confirmed), 'cloud', or 'restore' (the data here came from a backup).
 */
export type BackupHow = 'file' | 'download' | 'cloud' | 'restore';
const backupHows: readonly string[] = ['file', 'download', 'cloud', 'restore'];

/** When the last successful export or cloud copy happened in this browser (ISO string), or null. */
export function lastBackupAt(): string | null {
  try {
    const value = localStorage.getItem(LAST_BACKUP_KEY);
    return value && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}
export function lastBackupHow(): BackupHow | null {
  try {
    const value = localStorage.getItem(LAST_BACKUP_HOW_KEY);
    return value && backupHows.includes(value) ? (value as BackupHow) : null;
  } catch {
    return null;
  }
}
/** Pass the backup's own createdAt: work saved while a long export ran is not in it and still counts as new. */
export function markBackup(at: string | Date = new Date(), how: BackupHow = 'file') {
  const when = new Date(at);
  try {
    localStorage.setItem(LAST_BACKUP_KEY, (Number.isNaN(when.getTime()) ? new Date() : when).toISOString());
    localStorage.setItem(LAST_BACKUP_HOW_KEY, how);
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
/**
 * Time for a new backup: there is data here and no backup yet, the last one is over a week old, or files were
 * added after it (a score or a lesson recording lost with the browser cannot be recreated). Shared by the top
 * bar and Preferências, so both say the same.
 */
export function isBackupStale(hasData: boolean, days: number | null, newFiles = 0) {
  return hasData && (days === null || days > BACKUP_STALE_DAYS || newFiles > 0);
}

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

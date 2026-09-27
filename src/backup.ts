import { z } from 'zod';
import { db } from './db';
import { configSchema, type Asset } from './domain';
const id = z.string().min(1).max(100),
  optionalId = id.optional(),
  str = z.string().max(100000),
  date = z.string().max(50);
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
      z.object({
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
  scores: z.array(z.object({ id, pieceId: id, assetId: id, title: str, createdAt: date })).max(20000),
  annotations: z
    .array(
      z.object({
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
      z.object({
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
      }),
    )
    .max(20000),
  presets: z.array(z.object({ id, name: str, segmentId: optionalId, config: configSchema })).max(10000),
  sessions: z
    .array(
      z.object({
        id,
        pieceId: optionalId,
        segmentId: optionalId,
        title: str,
        hand,
        config: configSchema,
        startedAt: date,
        endedAt: date,
        activeSeconds: z.number().nonnegative(),
        completedRepetitions: z.number().nonnegative(),
        rating,
        note: str,
        completed: z.boolean(),
      }),
    )
    .max(100000),
  lessons: z
    .array(
      z.object({
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
      z.object({
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
      z.object({
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
    .array(z.object({ id, assetId: id, segmentId: optionalId, title: str, createdAt: date }))
    .max(10000),
  routines: z
    .array(
      z.object({
        id,
        title: str,
        items: z.array(z.object({ segmentId: id, minutes: z.number().positive().max(120) })),
      }),
    )
    .max(10000),
  assets: z
    .array(
      z.object({
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
export const backupSchema = z.object({
  format: z.literal('compasso-backup'),
  version: z.literal(1),
  createdAt: date,
  tables: tablesSchema,
});
export type Backup = z.infer<typeof backupSchema>;
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
export async function makeBackup(): Promise<Backup> {
  const tables: Record<string, unknown> = {};
  // Read a consistent database snapshot before encoding binary data.
  await db.transaction(
    'r',
    backupTables.map(n => db.table(n)),
    async () => {
      for (const name of backupTables) tables[name] = await db.table(name).toArray();
    },
  );
  const assets = tables.assets as Asset[];
  if (assets.reduce((s, a) => s + a.size, 0) > 120 * 1024 * 1024)
    throw new Error(
      'O acervo excede o limite de backup desta versão (120 MB). Exporte os áudios individualmente antes de reduzir o acervo.',
    );
  tables.assets = await Promise.all(
    assets.map(async ({ blob, ...a }) => ({
      ...a,
      data: await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error('Não foi possível ler um arquivo do acervo.'));
        r.readAsDataURL(blob);
      }),
    })),
  );
  return backupSchema.parse({
    format: 'compasso-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    tables,
  });
}
export function parseBackup(text: string): Backup {
  if (text.length > 180 * 1024 * 1024) throw new Error('O backup excede o limite de 180 MB.');
  const result = backupSchema.safeParse(JSON.parse(text));
  if (!result.success)
    throw new Error('Este arquivo não é um backup válido do Compasso. Nenhum dado foi alterado.');
  return result.data;
}
export async function restoreBackup(input: Backup) {
  const data = backupSchema.parse(input);
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
  const assetIds = new Set(assets.map(a => a.id)),
    pieceIds = new Set(data.tables.pieces.map(p => p.id)),
    scoreIds = new Set(data.tables.scores.map(s => s.id));
  if (
    data.tables.scores.some(s => !assetIds.has(s.assetId) || !pieceIds.has(s.pieceId)) ||
    data.tables.lessons.some(l => l.assetId && !assetIds.has(l.assetId)) ||
    data.tables.recordings.some(r => !assetIds.has(r.assetId)) ||
    data.tables.annotations.some(a => !scoreIds.has(a.scoreId))
  )
    throw new Error('O backup contém referências incompletas. Nenhum dado foi alterado.');
  await db.transaction(
    'rw',
    backupTables.map(n => db.table(n)),
    async () => {
      for (const name of backupTables) {
        await db.table(name).clear();
        const rows = name === 'assets' ? assets : data.tables[name];
        if (rows.length) await db.table(name).bulkPut(rows);
      }
    },
  );
}

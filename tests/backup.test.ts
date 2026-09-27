import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { backupTables, parseBackup, restoreBackup, type Backup } from '../src/backup';
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

// Writes guarded by etags (tables.ts, writeIf): an older version never overwrites a newer one, even when two writes
// race, as two devices syncing at the same moment or a retry racing its first try do.

import { describe, expect, it } from 'vitest';
import { writeIf, type Row, type Table } from '../src/tables';

/** A table in memory whose batches check etags as Azure's do, and that can slip in another write before one. */
function memoryTable(before?: (rows: Map<string, Row>) => void): Table {
  const rows = new Map<string, Row>();
  const key = (p: string, r: string) => `${p}|${r}`;
  let tag = 0;
  return {
    async list() { throw new Error('not used here'); },
    async get<T extends Row>(p: string, r: string) { const x = rows.get(key(p, r)); return x ? structuredClone(x) as T : null; },
    async put(row) { rows.set(key(row.partitionKey, row.rowKey), { ...row, etag: String(++tag) }); },
    async add() { throw new Error('not used here'); },
    async remove() { throw new Error('not used here'); },
    async batch(steps) {
      before?.(rows);
      before = undefined;
      for (const s of steps) {
        const have = rows.get(key(s.row.partitionKey, s.row.rowKey));
        if (s.op === 'create' && have) return false;
        if (s.op === 'replace' && have?.etag !== s.etag) return false;
      }
      for (const s of steps) rows.set(key(s.row.partitionKey, s.row.rowKey), { ...s.row, etag: String(++tag) });
      return true;
    },
    async where() { throw new Error('not used here'); },
  };
}

const newer = (updatedAt: number) => (s: (Row & { updatedAt?: number }) | null) => !s || (s.updatedAt ?? 0) < updatedAt;

describe('writeIf', () => {
  it('writes a newer version and keeps a newer one already there', async () => {
    const t = memoryTable();
    await t.put({ partitionKey: 'u', rowKey: 'd', updatedAt: 5 });
    expect(await writeIf(t, { partitionKey: 'u', rowKey: 'd', updatedAt: 3 }, newer(3))).toMatchObject({ updatedAt: 5 });
    expect(await writeIf(t, { partitionKey: 'u', rowKey: 'd', updatedAt: 7 }, newer(7))).toMatchObject({ updatedAt: 7 });
    expect(await t.get('u', 'd')).toMatchObject({ updatedAt: 7 });
  });

  it('never puts an older version over a newer one written in between', async () => {
    const t = memoryTable((rows) => rows.set('u|d', { partitionKey: 'u', rowKey: 'd', updatedAt: 9, etag: 'other' }));
    await t.put({ partitionKey: 'u', rowKey: 'd', updatedAt: 1 });
    const stored = await t.get<Row & { updatedAt: number }>('u', 'd');
    // Read at 1; another device writes 9 before this write of 5 lands: 9 stays.
    expect(await writeIf(t, { partitionKey: 'u', rowKey: 'd', updatedAt: 5 }, newer(5), stored)).toMatchObject({ updatedAt: 9 });
    expect(await t.get('u', 'd')).toMatchObject({ updatedAt: 9 });
  });

  it('creates a row once, when two try at the same moment', async () => {
    const t = memoryTable((rows) => rows.set('u|d', { partitionKey: 'u', rowKey: 'd', updatedAt: 4, etag: 'other' }));
    expect(await writeIf(t, { partitionKey: 'u', rowKey: 'd', updatedAt: 6 }, newer(6), null)).toMatchObject({ updatedAt: 6 });
    expect(await t.get('u', 'd')).toMatchObject({ updatedAt: 6 });
  });
});

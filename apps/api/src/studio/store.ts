// Where the Artist Studio keeps its data (docs/artist-studio-plan.md): rows in one table and pictures as blobs.
// Two stores with the same shape: Azure (Table Storage and a blob container, reached with the app's managed
// identity) for the real thing, and a folder on disk for local development and tests.
//
// Pictures are only ever added. putBlob refuses a name that exists, and there's no way to delete one, so an
// upload can never replace or lose an earlier one.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TableClient, TableServiceClient } from '@azure/data-tables';
import { ContainerClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';

export type Value = string | number | boolean;
export type Row = Record<string, Value>;

export interface Store {
  /** Add a row; false if one with this key is there already. */
  insert(pk: string, rk: string, row: Row): Promise<boolean>;
  /** Add or replace a row. */
  upsert(pk: string, rk: string, row: Row): Promise<void>;
  get(pk: string, rk: string): Promise<Row | null>;
  /** Every row in a partition, with its row key as `rk`, in row-key order. */
  list(pk: string): Promise<(Row & { rk: string })[]>;
  remove(pk: string, rk: string): Promise<void>;
  /** Store a new picture. Throws if the name is taken: pictures are never overwritten. */
  putBlob(name: string, bytes: Buffer, contentType: string): Promise<void>;
  getBlob(name: string): Promise<{ bytes: Buffer; contentType: string } | null>;
}

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// ── Azure ────────────────────────────────────────────────────────────────────────────────────────

/** Table Storage's system fields, left out of the rows we hand back. */
const SYSTEM = new Set(['partitionKey', 'rowKey', 'timestamp', 'etag', 'odata.etag', 'odata.metadata']);

export function azureStore(tables: string, blobs: string, credential: TokenCredential, name = 'studio'): Store {
  const table = new TableClient(tables, name, credential);
  const container = new ContainerClient(`${blobs.replace(/\/$/, '')}/${name}`, credential);
  // Made in the background on first start, like the API's other tables; a fresh account needs no setup.
  const ready = Promise.all([
    new TableServiceClient(tables, credential).createTable(name).catch(() => {}),
    container.createIfNotExists().catch(() => {}),
  ]);
  const clean = (e: Record<string, unknown>): Row =>
    Object.fromEntries(Object.entries(e).filter(([k, v]) => !SYSTEM.has(k) && v !== undefined && v !== null)) as Row;
  return {
    async insert(pk, rk, row) {
      await ready;
      try { await table.createEntity({ partitionKey: pk, rowKey: rk, ...row }); return true; }
      catch (e) { if ((e as { statusCode?: number }).statusCode === 409) return false; throw e; }
    },
    async upsert(pk, rk, row) { await ready; await table.upsertEntity({ partitionKey: pk, rowKey: rk, ...row }, 'Replace'); },
    async get(pk, rk) {
      await ready;
      try { return clean(await table.getEntity(pk, rk)); }
      catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    },
    async list(pk) {
      await ready;
      const rows: (Row & { rk: string })[] = [];
      const filter = `PartitionKey eq '${pk.replace(/'/g, "''")}'`;
      for await (const e of table.listEntities({ queryOptions: { filter } })) rows.push({ ...clean(e), rk: e.rowKey! });
      return rows.sort((a, b) => (a.rk < b.rk ? -1 : a.rk > b.rk ? 1 : 0));
    },
    async remove(pk, rk) { await ready; await table.deleteEntity(pk, rk).catch(() => {}); },
    async putBlob(blobName, bytes, contentType) {
      await ready;
      await container.getBlockBlobClient(blobName).uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: contentType },
        conditions: { ifNoneMatch: '*' },   // never overwrite
      });
    },
    async getBlob(blobName) {
      await ready;
      const blob = container.getBlockBlobClient(blobName);
      try {
        const props = await blob.getProperties();
        return { bytes: await blob.downloadToBuffer(), contentType: props.contentType ?? 'application/octet-stream' };
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode === 404) return null;
        throw e;
      }
    },
  };
}

// ── A folder on disk ─────────────────────────────────────────────────────────────────────────────

/** For local development and tests: each partition is a JSON file, each picture a file. One writer at a time. */
export function folderStore(root: string): Store {
  const partFile = (pk: string) => join(root, 'tables', `${encodeURIComponent(pk)}.json`);
  const blobFile = (name: string) => join(root, 'blobs', ...name.split('/'));
  const read = (pk: string): Record<string, Row> => {
    const f = partFile(pk);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  };
  const write = (pk: string, rows: Record<string, Row>) => {
    const f = partFile(pk);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(`${f}.tmp`, JSON.stringify(rows, null, 1));
    renameSync(`${f}.tmp`, f);
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => T): Promise<T> => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };
  return {
    insert: (pk, rk, row) => serial(() => {
      const rows = read(pk);
      if (rows[rk]) return false;
      rows[rk] = row;
      write(pk, rows);
      return true;
    }),
    upsert: (pk, rk, row) => serial(() => { const rows = read(pk); rows[rk] = row; write(pk, rows); }),
    get: async (pk, rk) => read(pk)[rk] ?? null,
    list: async (pk) => Object.entries(read(pk)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rk, row]) => ({ ...row, rk })),
    remove: (pk, rk) => serial(() => { const rows = read(pk); delete rows[rk]; write(pk, rows); }),
    putBlob: (name, bytes, contentType) => serial(() => {
      const f = blobFile(name);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, bytes, { flag: 'wx' });   // fails if it exists
      writeFileSync(`${f}.type`, contentType, { flag: 'wx' });
    }),
    getBlob: async (name) => {
      const f = blobFile(name);
      if (!existsSync(f)) return null;
      return { bytes: readFileSync(f), contentType: existsSync(`${f}.type`) ? readFileSync(`${f}.type`, 'utf8') : 'application/octet-stream' };
    },
  };
}

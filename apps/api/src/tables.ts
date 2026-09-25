// Where the API keeps its rows: Azure Table Storage (with the app's managed identity), or, when LOCAL_DATA names a
// folder, JSON files there. The local kind is for running the API on your own computer (npm run api:local): nothing
// in Azure is touched and no Azure sign-in is needed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TableClient, TableServiceClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';

export type Row = { partitionKey: string; rowKey: string } & Record<string, unknown>;

/**
 * One step of a batch. `etag` (from a row as it was read) makes the step fail if the row changed since; `create` fails
 * if the row exists.
 */
export type BatchStep =
  | { op: 'create'; row: Row }
  | { op: 'replace'; row: Row; etag: string }
  | { op: 'upsert'; row: Row };

export interface Table {
  /** Every row of one partition (one account). */
  list<T extends Row>(partition: string): Promise<T[]>;
  get<T extends Row>(partition: string, row: string): Promise<T | null>;
  /** Write a whole row, replacing any row with the same keys. */
  put(row: Row): Promise<void>;
  /** Write a row only if there's none with the same keys yet. False if there was. */
  add(row: Row): Promise<boolean>;
  remove(partition: string, row: string): Promise<void>;
  /**
   * Write several rows of one partition all at once, or none of them: false if any step's condition failed (a row
   * changed since it was read, or a row to create exists). Rows read with get/list carry their `etag`.
   */
  batch(steps: BatchStep[]): Promise<boolean>;
  /** Rows of every partition whose fields equal these values (small tables or rare checks only: it reads widely). */
  where<T extends Row>(match: Record<string, string>): Promise<T[]>;
}

export const LOCAL_DATA = process.env.LOCAL_DATA;
const TABLES = process.env.TABLE_ENDPOINT ?? 'https://fruitcatsdata.table.core.windows.net';

/** The table with this name. Made on first use, so a fresh storage account needs no setup. */
export function table(name: string): Table {
  return LOCAL_DATA ? localTable(name) : azureTable(name);
}

// ── Azure ────────────────────────────────────────────────────────────────────────────────────────

let credential: DefaultAzureCredential | null = null;

function azureTable(name: string): Table {
  credential ??= new DefaultAzureCredential();
  const client = new TableClient(TABLES, name, credential);
  void new TableServiceClient(TABLES, credential).createTable(name).catch(() => {});
  const notFound = (e: unknown) => (e as { statusCode?: number }).statusCode === 404;
  return {
    async list<T extends Row>(partition: string) {
      const rows: T[] = [];
      // Partition keys are account ids (32 hex digits) or other plain ids, never text a player typed.
      for await (const row of client.listEntities<T>({ queryOptions: { filter: `PartitionKey eq '${partition.replace(/'/g, "''")}'` } }))
        rows.push(row as T);
      return rows;
    },
    async get<T extends Row>(partition: string, row: string) {
      try { return await client.getEntity<T>(partition, row) as T; } catch (e) { if (notFound(e)) return null; throw e; }
    },
    async put(row) { await client.upsertEntity(row, 'Replace'); },
    async add(row) {
      try { await client.createEntity(row); return true; } catch (e) { if ((e as { statusCode?: number }).statusCode === 409) return false; throw e; }
    },
    async remove(partition, row) {
      try { await client.deleteEntity(partition, row); } catch (e) { if (!notFound(e)) throw e; }
    },
    async batch(steps) {
      const strip = ({ etag: _, ...row }: Row) => row as Row;
      try {
        await client.submitTransaction(steps.map((s) =>
          s.op === 'create' ? ['create', strip(s.row)] as const
            : s.op === 'upsert' ? ['upsert', strip(s.row), 'Replace'] as const
              : ['update', strip(s.row), 'Replace', { etag: s.etag }] as const));
        return true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 409 || status === 412) return false;
        throw e;
      }
    },
    async where<T extends Row>(match: Record<string, string>) {
      const filter = Object.entries(match).map(([k, v]) => `${k} eq '${v.replace(/'/g, "''")}'`).join(' and ');
      const rows: T[] = [];
      for await (const row of client.listEntities<T>({ queryOptions: { filter } })) rows.push(row as T);
      return rows;
    },
  };
}

// ── Local files ──────────────────────────────────────────────────────────────────────────────────

function localTable(name: string): Table {
  mkdirSync(LOCAL_DATA!, { recursive: true });
  const file = join(LOCAL_DATA!, `${name}.json`);
  const rows: Record<string, Row> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const key = (p: string, r: string) => `${p}|${r}`;
  const save = () => writeFileSync(file, JSON.stringify(rows, null, 2));
  const copy = <T>(x: unknown) => structuredClone(x) as T;
  // Like Azure's: every write gives the row a new etag.
  let tag = Date.now();
  const stamp = (row: Row) => ({ ...copy<Row>(row), etag: `W/"${++tag}"` });
  return {
    async list<T extends Row>(partition: string) { return Object.values(rows).filter((r) => r.partitionKey === partition).map((r) => copy<T>(r)); },
    async get<T extends Row>(partition: string, row: string) { const r = rows[key(partition, row)]; return r ? copy<T>(r) : null; },
    async put(row) { rows[key(row.partitionKey, row.rowKey)] = stamp(row); save(); },
    async add(row) {
      if (rows[key(row.partitionKey, row.rowKey)]) return false;
      rows[key(row.partitionKey, row.rowKey)] = stamp(row);
      save();
      return true;
    },
    async remove(partition, row) { delete rows[key(partition, row)]; save(); },
    async batch(steps) {
      if (new Set(steps.map((s) => s.row.partitionKey)).size > 1) throw new Error('a batch is one partition');
      for (const s of steps) {
        const have = rows[key(s.row.partitionKey, s.row.rowKey)];
        if (s.op === 'create' && have) return false;
        if (s.op === 'replace' && have?.etag !== s.etag) return false;
      }
      for (const s of steps) rows[key(s.row.partitionKey, s.row.rowKey)] = stamp(s.row);
      save();
      return true;
    },
    async where<T extends Row>(match: Record<string, string>) {
      return Object.values(rows).filter((r) => Object.entries(match).every(([k, v]) => r[k] === v)).map((r) => copy<T>(r));
    },
  };
}

// Where the API keeps its rows: Azure Table Storage (with the app's managed identity), or, when LOCAL_DATA names a
// folder, JSON files there. The local kind is for running the API on your own computer (npm run api:local): nothing
// in Azure is touched and no Azure sign-in is needed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TableClient, TableServiceClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';

export type Row = { partitionKey: string; rowKey: string } & Record<string, unknown>;

export interface Table {
  /** Every row of one partition (one account). */
  list<T extends Row>(partition: string): Promise<T[]>;
  get<T extends Row>(partition: string, row: string): Promise<T | null>;
  /** Write a whole row, replacing any row with the same keys. */
  put(row: Row): Promise<void>;
  /** Write a row only if there's none with the same keys yet. False if there was. */
  add(row: Row): Promise<boolean>;
  remove(partition: string, row: string): Promise<void>;
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
  return {
    async list<T extends Row>(partition: string) { return Object.values(rows).filter((r) => r.partitionKey === partition).map((r) => copy<T>(r)); },
    async get<T extends Row>(partition: string, row: string) { const r = rows[key(partition, row)]; return r ? copy<T>(r) : null; },
    async put(row) { rows[key(row.partitionKey, row.rowKey)] = copy(row); save(); },
    async add(row) {
      if (rows[key(row.partitionKey, row.rowKey)]) return false;
      rows[key(row.partitionKey, row.rowKey)] = copy(row);
      save();
      return true;
    },
    async remove(partition, row) { delete rows[key(partition, row)]; save(); },
  };
}

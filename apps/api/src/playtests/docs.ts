// Where the playtest dashboard keeps its data: one JSON document per blob in the `playtests` container of fruitcatsdata
// (runs/<id>.json, requests/<id>.json, meta.json, ops.json), reached with the app's managed identity. Or, for local
// development and tests, one file per document in a folder.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ContainerClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';

export interface Docs {
  get<T>(name: string): Promise<T | null>;
  /** Write a document, replacing what was there. */
  put(name: string, value: unknown): Promise<void>;
  remove(name: string): Promise<void>;
  /** The names of the documents under a prefix, e.g. "runs/". */
  list(prefix: string): Promise<string[]>;
}

export function azureDocs(blobs: string, credential: TokenCredential, container = 'playtests'): Docs {
  const box = new ContainerClient(`${blobs.replace(/\/$/, '')}/${container}`, credential);
  const ready = box.createIfNotExists().catch(() => {});
  return {
    async get<T>(name: string) {
      await ready;
      try { return JSON.parse((await box.getBlockBlobClient(name).downloadToBuffer()).toString('utf8')) as T; }
      catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    },
    async put(name, value) {
      await ready;
      const body = JSON.stringify(value);
      await box.getBlockBlobClient(name).upload(body, Buffer.byteLength(body), { blobHTTPHeaders: { blobContentType: 'application/json' } });
    },
    async remove(name) { await ready; await box.deleteBlob(name).catch(() => {}); },
    async list(prefix) {
      await ready;
      const names: string[] = [];
      for await (const item of box.listBlobsFlat({ prefix })) names.push(item.name);
      return names;
    },
  };
}

export function folderDocs(root: string): Docs {
  const file = (name: string) => join(root, ...name.split('/'));
  return {
    async get<T>(name: string) { const f = file(name); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as T : null; },
    async put(name, value) {
      const f = file(name);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(`${f}.tmp`, JSON.stringify(value));
      renameSync(`${f}.tmp`, f);
    },
    async remove(name) { rmSync(file(name), { force: true }); },
    async list(prefix) {
      const dir = file(prefix.replace(/\/$/, ''));
      return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `${prefix.replace(/\/?$/, '/')}${f}`) : [];
    },
  };
}

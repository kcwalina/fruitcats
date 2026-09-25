// What online play keeps (docs/pvp-plan.md), in the API's tables:
//   matches  "live" / {id}         each game still going: its record (seed, decks, moves), so a restart loses nothing
//            "done-YYYY-MM" / {id}  finished games, by month: the replays
//   rivals   {account} / {friend}  games that counted between two friends: wins, losses, draws
//   seen     {account} / "seen"    when an account was last online, for "Last seen 3 days ago"
// Nothing a player typed is stored here apart from their display name, which is in the match record as it was shown.

import type { Tally } from '@fruitcats/match';
import type { Row, Table } from '../tables';
import type { MatchRecord } from './match';

export interface LiveStore {
  saveMatch(r: MatchRecord): Promise<void>;
  /** Games that were going when the API last stopped. */
  liveMatches(): Promise<MatchRecord[]>;
  /** The game is over: move its record from "live" to its month. */
  finishMatch(r: MatchRecord): Promise<void>;
  tally(account: string, friend: string): Promise<Tally>;
  addResult(account: string, friend: string, result: 'win' | 'loss' | 'draw'): Promise<Tally>;
  lastSeen(account: string): Promise<string | undefined>;
  seen(account: string, at: string): Promise<void>;
  /** Everything about an account (Export my data), and erasing it (Delete account). */
  exportFor(account: string): Promise<{ rivals: (Tally & { friend: string })[]; lastSeen?: string }>;
  erase(account: string): Promise<void>;
}

// A table property holds at most 32K characters, so a long record is split across d0, d1, …
const CHUNK = 30_000;
const MAX_CHUNKS = 30;

function split(json: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i * CHUNK < json.length && i < MAX_CHUNKS; i++) out[`d${i}`] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  return out;
}

function join(row: Row): string {
  let json = '';
  for (let i = 0; typeof row[`d${i}`] === 'string'; i++) json += row[`d${i}`];
  return json;
}

const month = (iso: string) => `done-${iso.slice(0, 7)}`;

export function tableStore(matches: Table, rivals: Table, seenTable: Table): LiveStore {
  type TallyRow = Row & Tally;
  const empty = (): Tally => ({ wins: 0, losses: 0, draws: 0 });
  return {
    async saveMatch(r) {
      if (r.end) return;
      await matches.put({ partitionKey: 'live', rowKey: r.id, ...split(JSON.stringify(r)) });
    },
    async liveMatches() {
      const out: MatchRecord[] = [];
      for (const row of await matches.list('live')) {
        try { out.push(JSON.parse(join(row))); } catch { await matches.remove('live', row.rowKey); }
      }
      return out;
    },
    async finishMatch(r) {
      await matches.put({ partitionKey: month(r.createdAt), rowKey: r.id, ...split(JSON.stringify(r)) });
      await matches.remove('live', r.id);
    },
    async tally(account, friend) {
      const row = await rivals.get<TallyRow>(account, friend);
      return row ? { wins: row.wins ?? 0, losses: row.losses ?? 0, draws: row.draws ?? 0 } : empty();
    },
    async addResult(account, friend, result) {
      const t = await this.tally(account, friend);
      if (result === 'win') t.wins++;
      else if (result === 'loss') t.losses++;
      else t.draws++;
      await rivals.put({ partitionKey: account, rowKey: friend, ...t });
      return t;
    },
    async lastSeen(account) {
      const row = await seenTable.get<Row & { at: string }>(account, 'seen');
      return row?.at;
    },
    async seen(account, at) {
      await seenTable.put({ partitionKey: account, rowKey: 'seen', at });
    },
    async exportFor(account) {
      const rows = await rivals.list<TallyRow>(account);
      return {
        rivals: rows.map((r) => ({ friend: r.rowKey, wins: r.wins ?? 0, losses: r.losses ?? 0, draws: r.draws ?? 0 })),
        lastSeen: await this.lastSeen(account),
      };
    },
    async erase(account) {
      for (const row of await rivals.list(account)) await rivals.remove(account, row.rowKey);
      await seenTable.remove(account, 'seen');
    },
  };
}

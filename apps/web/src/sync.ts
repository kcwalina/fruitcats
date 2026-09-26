// Keeps a signed-in player's custom decks and Showcase in their Via Mochi account, so they're the same on every device
// (docs/accounts.md). The Fruitcats API merges what this device has with the account's copy (the newest edit of
// each deck wins; deletions are remembered) and sends back the result, which replaces what's here.
//
// It syncs when you sign in (which also uploads the decks this device already had), when the game starts, when you
// come back to it, when the connection returns, and two seconds after each change. Offline, changes simply wait.

import { API } from './api';
import { session, signOut, token } from './auth';
import { applySyncedDecks, deletedDecks, forgetDecks, listDecks, onDecksChanged, type DeckOrigin, type MyDeck } from './mydecks';
import { applySyncedShowcase, forgetShowcase, onShowcaseChanged, savedShowcase } from './showcase';
import { forgetStore } from './shop';
import { SAFE_RETRY, fetchRetry } from './net';

interface Host { render(): void }
interface SyncDeck { id: string; updatedAt: number; deleted?: boolean; deck?: { name: string; hero: string; cards: Record<string, number>; from?: DeckOrigin } }

let host: Host | null = null;
let started = false;
let timer = 0;
let running: Promise<boolean> | null = null;
let again = false;
/** When this device and the account last agreed (ms since epoch): anything changed after it isn't in the account yet. */
const SYNCED_KEY = 'fruitcats-synced-at';
const SYNC_RETRY = { ...SAFE_RETRY, attemptMs: 20_000, delaysMs: [1000], budgetMs: 30_000 };

/** Start keeping this device in step with the account. Safe to call more than once. */
export function startSync(h: Host) {
  host = h;
  if (!session()) return;
  if (!started) {
    started = true;
    onDecksChanged(soon);
    onShowcaseChanged(soon);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); });
    window.addEventListener('online', () => void syncNow());
  }
  void syncNow();
}

function soon() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), 2000);
}

/** Sync now. True if this device and the account now agree. */
export async function syncNow(): Promise<boolean> {
  if (!session()) return false;
  if (running) { again = true; return running; }
  running = run().finally(() => { running = null; });
  const ok = await running;
  if (again) { again = false; return syncNow(); }
  return ok;
}

async function run(): Promise<boolean> {
  const t = await token();
  if (!t) return false;
  const decks: SyncDeck[] = [
    ...listDecks().map((d) => ({ id: d.id, updatedAt: d.updatedAt ?? Date.now(), deck: { name: d.name, hero: d.hero, cards: d.cards, from: d.from } })),
    ...deletedDecks().map((d) => ({ id: d.id, updatedAt: d.updatedAt, deleted: true })),
  ];
  let merged: { decks: SyncDeck[]; showcase: { faces: string[]; updatedAt: number } | null };
  const sentAt = Date.now();
  try {
    // A sync can safely happen twice (the account merges, the newest edit wins): one more try after a dropped
    // connection, so signing out doesn't stop over a blip.
    const r = await fetchRetry(`${API}/v1/sync`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decks, showcase: savedShowcase() ?? undefined }),
    }, SYNC_RETRY);
    if (!r.ok) return false;
    merged = await r.json();
  } catch {
    return false;   // offline: try again later
  }
  if (!session()) return false;   // signed out while this was running
  const before = JSON.stringify(listDecks());
  // A deck is only ever removed here because the account says it was deleted, never because the answer left it out:
  // a server that rejects decks it shouldn't (it once couldn't read the card sets and dropped every deck) must not
  // be able to wipe them from the device. Such a deck stays here and is sent again at the next sync.
  const answered = new Set(merged.decks.map((d) => d.id));
  // Where a copied deck came from: an account server that doesn't keep it yet mustn't make this device forget it.
  const from = new Map(listDecks().filter((d) => d.from).map((d) => [d.id, d.from]));
  const kept = listDecks().filter((d) => !answered.has(d.id));
  applySyncedDecks(
    [...merged.decks.filter((d) => !d.deleted && d.deck).map((d): MyDeck => ({ id: d.id, updatedAt: d.updatedAt, ...d.deck!, from: d.deck!.from ?? from.get(d.id) })), ...kept],
    merged.decks.filter((d) => d.deleted).map((d) => d.id),
  );
  const saved = savedShowcase();
  if (merged.showcase && (!saved || saved.updatedAt < merged.showcase.updatedAt)) applySyncedShowcase(merged.showcase.faces, merged.showcase.updatedAt);
  if (JSON.stringify(listDecks()) !== before || merged.showcase) host?.render();
  // The newest time in what the account sent counts too: another device's clock running ahead mustn't make its
  // decks look unsaved here. A deck the account left out (kept above) isn't saved in it, so the mark doesn't move.
  const newest = Math.max(sentAt, ...merged.decks.map((d) => d.updatedAt), merged.showcase?.updatedAt ?? 0);
  if (!kept.length) try { localStorage.setItem(SYNCED_KEY, String(newest)); } catch { /* private mode */ }
  return true;
}

/** Has this device got changes the account doesn't have yet? */
function unsaved(): boolean {
  let at = 0;
  try { at = Number(localStorage.getItem(SYNCED_KEY) ?? 0) || 0; } catch { /* private mode: never synced */ }
  return listDecks().some((d) => (d.updatedAt ?? Infinity) > at)
    || deletedDecks().some((d) => d.updatedAt > at)
    || (savedShowcase()?.updatedAt ?? 0) > at;
}

/**
 * Sign out: send anything unsynced first, then this device forgets the account's decks, Showcase and Store copy, so
 * the next person to sign in here doesn't see them. They stay safe in the account.
 *
 * Offline, the latest changes can't be sent, and forgetting them would lose them for good: then this doesn't sign
 * out and returns false, unless `anyway` (the player was told, and chose to).
 */
export async function signOutAndForget(anyway = false): Promise<boolean> {
  const ok = await syncNow();
  if (!ok && !anyway && session() && unsaved()) return false;
  forgetStore();
  signOut();
  forgetDecks();
  forgetShowcase();
  try { localStorage.removeItem(SYNCED_KEY); } catch { /* private mode */ }
  return true;
}

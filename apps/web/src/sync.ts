// Keeps a signed-in player's custom decks and Showcase in their Via Mochi account, so they're the same on every device
// (docs/accounts.md). The Fruitcats API merges what this device has with the account's copy (the newest edit of
// each deck wins; deletions are remembered) and sends back the result, which replaces what's here.
//
// It syncs when you sign in (which also uploads the decks this device already had), when the game starts, when you
// come back to it, when the connection returns, and two seconds after each change. Offline, changes simply wait.

import { API } from './api';
import { session, signOut, token } from './auth';
import { applySyncedDecks, deletedDecks, forgetDecks, listDecks, onDecksChanged, type MyDeck } from './mydecks';
import { applySyncedShowcase, forgetShowcase, onShowcaseChanged, savedShowcase } from './showcase';
import { forgetStore } from './shop';

interface Host { render(): void }
interface SyncDeck { id: string; updatedAt: number; deleted?: boolean; deck?: { name: string; hero: string; cards: Record<string, number> } }

let host: Host | null = null;
let started = false;
let timer = 0;
let running: Promise<boolean> | null = null;
let again = false;

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
    ...listDecks().map((d) => ({ id: d.id, updatedAt: d.updatedAt ?? Date.now(), deck: { name: d.name, hero: d.hero, cards: d.cards } })),
    ...deletedDecks().map((d) => ({ id: d.id, updatedAt: d.updatedAt, deleted: true })),
  ];
  let merged: { decks: SyncDeck[]; showcase: { faces: string[]; updatedAt: number } | null };
  try {
    const r = await fetch(`${API}/v1/sync`, {
      signal: AbortSignal.timeout(20_000),
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decks, showcase: savedShowcase() ?? undefined }),
    });
    if (!r.ok) return false;
    merged = await r.json();
  } catch {
    return false;   // offline: try again later
  }
  if (!session()) return false;   // signed out while this was running
  const before = JSON.stringify(listDecks());
  applySyncedDecks(
    merged.decks.filter((d) => !d.deleted && d.deck).map((d): MyDeck => ({ id: d.id, updatedAt: d.updatedAt, ...d.deck! })),
    merged.decks.filter((d) => d.deleted).map((d) => d.id),
  );
  const saved = savedShowcase();
  if (merged.showcase && (!saved || saved.updatedAt < merged.showcase.updatedAt)) applySyncedShowcase(merged.showcase.faces, merged.showcase.updatedAt);
  if (JSON.stringify(listDecks()) !== before || merged.showcase) host?.render();
  return true;
}

/**
 * Sign out: send anything unsynced first, then this device forgets the account's decks, Showcase and Store copy, so
 * the next person to sign in here doesn't see them. They stay safe in the account.
 */
export async function signOutAndForget() {
  await syncNow();
  forgetStore();
  signOut();
  forgetDecks();
  forgetShowcase();
}

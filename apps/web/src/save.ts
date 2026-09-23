// The game in progress, kept in localStorage so closing the tab (or the phone killing it) doesn't
// lose it. The engine state is plain JSON, so it is saved as-is after every change and picked up on
// the next visit. A save the current build can't continue is quietly thrown away.

import { CARDS, RULES_VERSION, legalActions, type GameState } from '@fruitcats/engine';

const STORAGE_KEY = 'fruitcats-game';

export interface SavedGame {
  rules: number;
  game: GameState;
  /** The AI difficulty the game was started with. */
  difficulty: string;
  /** Screen-only memory that isn't part of the rules state: see main.ts. */
  unitArrivals: [number, number][];
  foeFrom: number;
  foeUnitsBefore: number[];
}

export function saveGame(save: Omit<SavedGame, 'rules'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rules: RULES_VERSION, ...save }));
  } catch { /* private mode or storage full: the game just isn't remembered */ }
}

export function clearSave(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear */ }
}

/** The saved game, if there is one this build can continue. */
export function loadGame(): SavedGame | null {
  let save: SavedGame;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    save = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!usable(save)) { clearSave(); return null; }
  return save;
}

function usable(save: SavedGame): boolean {
  if (save?.rules !== RULES_VERSION || !save.game || save.game.winner !== null || !save.game.prompt) return false;
  try {
    // Every card must still exist (card data may have changed since), and the engine must accept the state.
    const cards = save.game.players.flatMap((p) => [
      p.hero.id, ...p.deck.map((c) => c.id), ...p.hand.map((c) => c.id), ...p.lives.map((c) => c.id),
      ...p.pantry.map((t) => t.card.id), ...p.compost.map((c) => c.id),
      ...p.yard.flatMap((u) => [u.id, ...(u.toy ? [u.toy.id] : [])]),
    ]);
    if (cards.some((id) => !CARDS[id])) return false;
    legalActions(save.game);
    return true;
  } catch {
    return false;
  }
}

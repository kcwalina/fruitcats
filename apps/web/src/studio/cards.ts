// The cards of a Studio project, as the core reads its Alex file (games/folkborn/sets/<set>/<set>.alex): what the Studio
// shows beside a picture and on its game previews. It reads the words and numbers only; it knows no rules.

import type { Json } from '../../../../cardengine/engine/host/core';

export interface StudioFace {
  /** The card's type as its file writes it, in words: 'Fabled', 'Token Creature'. */
  type: string;
  name: string;
  text?: string;
  flavor?: string;
  cost?: number;
  power?: number;
  health?: number;
}

export interface StudioCard extends StudioFace {
  number: string;
  rarity?: string;
  family?: string;
  /** A two-faced card's second face (a Hero's Awakened side). */
  back?: StudioFace;
}

type Record_ = { [key: string]: Json };
const isRecord = (v: Json | undefined): v is Record_ => v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);
const text = (o: Record_, field: string) => (typeof o[field] === 'string' ? (o[field] as string) : undefined);
const whole = (o: Record_, field: string) => (typeof o[field] === 'number' ? (o[field] as number) : undefined);

function face(o: Record_): StudioFace {
  const epithet = text(o, 'epithet');
  const name = text(o, 'name') ?? '';
  return {
    type: String(o.$type ?? '').replace(/([a-z])([A-Z])/g, '$1 $2'),
    name: epithet ? `${name}, ${epithet}` : name,
    text: text(o, 'text'),
    flavor: text(o, 'flavor'),
    cost: whole(o, 'cost'),
    power: whole(o, 'power'),
    health: whole(o, 'health'),
  };
}

/** The cards of a set, from its document's value, by their number. */
export function cardsFrom(set: Json): Map<string, StudioCard> {
  const cards = new Map<string, StudioCard>();
  if (!isRecord(set)) return cards;
  const family = isRecord(set.family) ? text(set.family, 'name') : undefined;
  const all = isRecord(set.cards) ? set.cards : {};
  for (const [, value] of Object.entries(all)) {
    if (!isRecord(value)) continue;
    const number = text(value, 'number');
    if (!number) continue;
    cards.set(number, {
      ...face(value), number, family, back: isRecord(value.back) ? face(value.back) : undefined, rarity: text(value, 'rarity'),
    });
  }
  return cards;
}

// The cards of a Studio project, as its Alex file writes them (games/folkborn/sets/<set>/<set>.alex): what the Studio
// shows beside a picture and on its game previews. It reads the words and numbers only; it knows no rules.

import { intOf, objectOf, textOf, type AlexFolder, type AlexObject, type AlexValue } from '../../../../cardengine/alex/alex';

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

/** The cards of `set` (a document of `folder`), by their number. */
export function cardsOf(folder: AlexFolder, set: string): Map<string, StudioCard> {
  const doc = folder.documents.get(set);
  const cards = new Map<string, StudioCard>();
  if (!doc) return cards;
  const at = (v: AlexValue | undefined) => folder.resolve(v, set);
  const family = textOf(objectOf(at(doc.root.get('family')))?.get('name'));
  const face = (o: AlexObject): StudioFace => {
    const epithet = textOf(at(o.get('epithet')));
    const name = textOf(at(o.get('name'))) ?? '';
    return {
      type: (o.type ?? '').replace(/([a-z])([A-Z])/g, '$1 $2'),
      name: epithet ? `${name}, ${epithet}` : name,
      text: textOf(at(o.get('text'))),
      flavor: textOf(at(o.get('flavor'))),
      cost: intOf(o.get('cost')),
      power: intOf(o.get('power')),
      health: intOf(o.get('health')),
    };
  };
  for (const [, v] of objectOf(at(doc.root.get('cards')))?.entries ?? []) {
    const card = objectOf(at(v));
    const number = card && textOf(card.get('number'));
    if (!card || !number) continue;
    const back = objectOf(at(card.get('back')));
    const rarity = at(card.get('rarity'));
    cards.set(number, {
      ...face(card), number, family, back: back ? face(back) : undefined,
      rarity: rarity?.kind === 'enum' ? rarity.member : undefined,
    });
  }
  return cards;
}

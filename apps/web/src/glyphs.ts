// What a unit is and does, short enough for its tile on the board: its class as an icon, and each ability as a
// line like "⟳ heal 1 · sides" (each bout, heal 1 to the units next to it). The card's full text is a tap away;
// this is for reading a board at a glance (the owner's playtest, 2026-10-02: the abilities were hidden).

import { CARDS, cardName, unitClass, type Ability, type TargetSel, type UnitClass } from '@fruitcats/engine';

export const CLASS_ICON: Record<UnitClass, string> = { Tank: '🛡', Bruiser: '👊', Assassin: '🗡', Marksman: '🏹', Mage: '✨', Support: '💠' };

/** What each class does, in a line, for a tooltip and the glossary. */
export const CLASS_TEXT: Record<UnitClass, string> = {
  Tank: 'Front: enemies hit Tanks before anyone else (a unit with Taunt comes first of all).',
  Bruiser: 'Front: hit after the Tanks. Hits the enemy across, else the nearest.',
  Assassin: 'Strikes first in every bout, and goes for the enemy’s back (Marksmen, Mages, Supports), unless a unit taunts.',
  Marksman: 'Back: hit after the front. Hits the enemy across, else the nearest.',
  Mage: 'Back: hit after the front. A weak hit; its spell is its ability.',
  Support: 'Back: hit after the front. Never attacks: its ability helps the units next to it.',
};

export const classOf = (id: string): UnitClass => unitClass(id);

const WHEN: Record<string, string> = {
  clashStart: '⚡', boutStart: '⟳', everyOtherBout: '⟳²', goodbye: '✝', damagedAndSurvives: '🩹', defeatsInCombat: '🏆',
  roundStart: '🌅', exhaust: '', play: '', hello: '',
};

const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

function target(t: TargetSel | undefined): string {
  if (!t || t === 'self') return '';
  if (typeof t !== 'object') return '';
  if ('unit' in t) return t.unit === 'enemy' ? 'a foe' : t.unit === 'own' ? 'one of yours' : '';
  if ('each' in t) {
    if (t.range === 0) return t.each === 'enemy' ? 'across' : 'itself';
    if (t.range === 1) return t.each === 'enemy' ? '3 across' : 'sides';
    return t.each === 'enemy' ? 'all foes' : t.each === 'own' ? 'all yours' : 'all';
  }
  return '';
}

function effect(act: Record<string, unknown>): string {
  const [name, v] = Object.entries(act)[0] ?? [];
  switch (name) {
    case 'damage': return `${v} dmg`;
    case 'heal': return `heal ${v}`;
    case 'buff': {
      const b = v as { power?: number; health?: number; keywords?: string[] };
      return [b.power ? `${signed(b.power)}⚔` : '', b.health ? `${signed(b.health)}♥` : '', ...(b.keywords ?? []).map((k) => (k === 'Zoomies' ? 'Swift' : k))].filter(Boolean).join(' ');
    }
    case 'stun': return `stun ${v}`;
    case 'exhaust': return 'stun';
    case 'readyTreats': return `+${v}🪙`;
    case 'sprout': return `+${v}🪙`;
    case 'freeRoll': return 'free roll';
    case 'summon': return `+${cardName(String(v))}`;
    case 'counter': return `+1 🌽`;
    default: return '';
  }
}

/** One ability in a few symbols and words, or '' for one the tile doesn't need (a Talisman's grant, say). */
export function abilityLine(a: Ability): string {
  if (a.static) {
    const g = a.static.grant;
    if (!g || a.static.to === 'attached') return '';
    return [g.power ? `${signed(g.power)}⚔` : '', g.health ? `${signed(g.health)}♥` : ''].filter(Boolean).join(' ');
  }
  const when = WHEN[a.when ?? ''] ?? '';
  const what = (a.do ?? []).map(effect).filter(Boolean).join(', ');
  if (!what) return '';
  const where = target(a.target);
  return `${when ? `${when} ` : ''}${what}${where ? ` · ${where}` : ''}`;
}

/** Every ability of a unit card as lines for its tile. */
export function abilityLines(id: string): string[] {
  return (CARDS[id]?.abilities ?? []).map(abilityLine).filter(Boolean);
}

/** The legend for the symbols, for the Rules screen. */
export const LEGEND = '⚡ Clash start · ⟳ each bout · ⟳² every second bout · ✝ when it goes down · 🩹 when hurt and still standing · '
  + '🏆 after it knocks a unit down · 🌅 at the start of each round. “across”: the enemy facing it; “3 across”: that one and the ones next to it; '
  + '“sides”: your units next to it.';

// Rarity and finishes. Rarity is printed on the card, the same on every copy: a bronze circle, a silver
// diamond, a gold star or a crown, as tools/compose_cards.py draws it. A finish is how one copy shines
// (collection.ts): Foil, Gold, or Prismatic, the rarest, with a turning rainbow border.

import './finish.css';
import { CARDS, type Rarity } from '@fruitcats/engine';
import { FINISH_NAMES, finish, type Finish } from './collection';
import { BASE, cardUrl } from './ui';

/** Each rarity's metal: light, dark, outline (compose_cards.py's RARITY_MARKS). */
const METAL: Record<Rarity, [string, string, string]> = {
  Common: ['#F2B880', '#8A4A1C', '#4A2408'],
  Uncommon: ['#F4F6FA', '#7F8B9C', '#2F3842'],
  Rare: ['#FFE680', '#E0A019', '#6B4500'],
  Legendary: ['#FF8AD8', '#8B4DFF', '#3F1466'],
};

export const rarity = (id: string): Rarity => CARDS[id]?.rarity ?? 'Common';

/** The mark's outline as points around (cx, cy), r its radius; null for the Common circle. */
function shape(r: Rarity, cx: number, cy: number, R: number): [number, number][] | null {
  if (r === 'Uncommon') return [[cx, cy - R], [cx + R * 0.78, cy], [cx, cy + R], [cx - R * 0.78, cy]];
  if (r === 'Rare') {
    return Array.from({ length: 10 }, (_, i) => {
      const len = i % 2 === 0 ? R : R * 0.46, a = Math.PI / 2 + (i * Math.PI) / 5;
      return [cx + len * Math.cos(a), cy - len * Math.sin(a)] as [number, number];
    });
  }
  if (r === 'Legendary') {
    const w = R * 1.05, top = cy - R * 0.85, base = cy + R * 0.7;
    return [[cx - w, base], [cx - w, top + R * 0.25], [cx - w * 0.5, cy], [cx, top - R * 0.1], [cx + w * 0.5, cy], [cx + w, top + R * 0.25], [cx + w, base]];
  }
  return null;
}

/** The rarity mark as a small inline SVG, sized by the font (1em). */
export function rarityMark(r: Rarity): string {
  const [light, dark, ink] = METAL[r];
  const pts = shape(r, 12, 12, 10);
  const body = pts ? `<polygon points="${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}"` : '<circle cx="12" cy="12" r="10"';
  return `<svg class="rarity-mark" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="rm-${r}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
    ${body} fill="url(#rm-${r})" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

/** The rarity mark on a canvas (the wallpaper), centred on (cx, cy). */
export function drawRarityMark(ctx: CanvasRenderingContext2D, r: Rarity, cx: number, cy: number, R: number): void {
  const [light, dark, ink] = METAL[r];
  const pts = shape(r, cx, cy, R);
  ctx.save();
  ctx.beginPath();
  if (pts) {
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
  }
  const metal = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  metal.addColorStop(0, light);
  metal.addColorStop(1, dark);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = R * 0.16;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.restore();
}

/**
 * The picture of your copy of a card, printed in its finish (compose_cards.py prints every card in each
 * finish, its chrome in holographic silver, gold or a rainbow). `key` is a card id, or a Hero Cat's
 * `<id>-kitten` / `<id>-bigcat`. The opponent's cards are always the standard print: use cardUrl.
 */
export function yourCardUrl(key: string): string {
  const f = finish(key.replace(/-(kitten|bigcat)$/, ''));
  return f === 'standard' ? cardUrl(key) : `${BASE}cards/sb1/${f}/${key}.webp`;
}

/** Classes for the element holding a picture of your copy: its sheen and glow (finish.css). None for standard. */
export function finishClasses(id: string): string {
  const f = finish(id);
  return f === 'standard' ? '' : `finished holo finish-${f}`;
}

/** Prismatic copies twinkle: put these inside the element with finishClasses, after the picture. */
export function finishSparks(id: string): string {
  if (finish(id) !== 'prismatic') return '';
  return SPARKS.map(([x, y, s, d]) => `<i class="fin-spark" style="left:${x}%;top:${y}%;--s:${s};animation-delay:${d}s"></i>`).join('');
}

/** Prismatic twinkles, over the art only: [left %, top %, size (fraction of the card's width), delay s]. */
const SPARKS = [[84, 20, 0.07, 0], [18, 27, 0.06, 1.1], [75, 46, 0.06, 2.3], [26, 49, 0.05, 0.6], [56, 17, 0.05, 1.8]];

/** Classes that frame a picture of a card (not a wrapper) in the player's finish: for the deck pickers. */
export function finishFrame(id: string): string {
  const f = finish(id);
  return f === 'standard' ? '' : `fin-frame fin-${f}`;
}

export const finishName = (f: Finish) => FINISH_NAMES[f];

// Phone wallpapers: the whole screen is the card. The same frame, name banner, type line, rules text
// and stat badges as the printed cards (tools/compose_cards.py), stretched to a phone's shape, with the
// art filling the top of the screen behind the lock-screen clock.
// No website can set the wallpaper itself: the player saves the picture (the share sheet's Save Image
// on iPhone) and chooses it in Photos.

import { CARDS, type CardDef, type Rarity } from '@fruitcats/engine';
import type { Finish } from './collection';
import { drawRarityMark } from './rarity';
import { BASE, artUrl } from './ui';

/** Main, dark and tint colour of each fruit family, as compose_cards.py draws them. */
const FAMILIES: Record<string, [string, string, string]> = {
  Citrus: ['#F29F05', '#A86400', '#FFF1CC'],
  Orchard: ['#D64545', '#8E2A2A', '#FBE0DA'],
  Garden: ['#5FA84D', '#3B7430', '#E3F2DC'],
  Berry: ['#D6336C', '#8F1D46', '#FBDDE7'],
  Tropical: ['#F2780C', '#A24E05', '#FFE6CC'],
  Melon: ['#3FA66B', '#25714A', '#DDF3E6'],
};
/** The finishes' chrome, as compose_cards.py prints it: silver with rainbow flashes, gold, a rainbow. */
const RAINBOW = ['#ff6b6b', '#ffd36b', '#7bff9a', '#6bd5ff', '#b07bff', '#ff6bd0'];
const HOLO = ['#8e97a3', '#eef1f5', '#d7c2ec', '#a7b0bb', '#f7f9fb', '#bfe6f2', '#7f8894', '#f3dcec', '#8e97a3'];
const PRISM = ['#ff3d8b', '#ff9f1a', '#ffe23d', '#2ee88a', '#2bb8ff', '#7a5cff', '#e84dff', '#ff3d8b'];
const GOLD = ['#fff4c2', '#e8b73a', '#8a5a0c', '#f7d774', '#b07d17', '#fff0b0', '#c89224', '#fff4c2'];
const CHROME_INK: Record<Finish, string> = { standard: '', foil: '#4a5362', gold: '#5a3a04', prismatic: '#3a2a5a' };
/** Each finish's code in the collector line, and its letter's colour (compose_cards.py's FINISH_CODES). */
const FINISH_CODES: Record<Exclude<Finish, 'standard'>, [string, string]> = {
  foil: ['F', '#2e3552'], gold: ['G', '#4a2c02'], prismatic: ['P', 'white'],
};
const CREAM = '#FFF8EC', INK = '#2B211B', MUTED = '#7A6A5C';
const FOOTER = 'Fruitcats · Starter Box · © 2026 Krzysztof Cwalina';
const FONT = 'Nunito, "Segoe UI", sans-serif';

/** The stat chips' icons (Phosphor's paw and heart, white masks) and the heart's own colour (compose_cards.py's stat_chip). */
const STAT_ICONS = { paw: 'stat-paw', heart: 'stat-heart' } as const;
const HEART_COLOR = '#D9486C';

const KEYWORDS = /\b(Zoomies|Guardian|Sneaky|Fierce|Tough \d+|Lucky|Pounce|Ripen|Zest|Sprout \d+|Lush)\b/g;
const LABEL = /(?:^|(?<=\n)|(?<=\. ))([A-Z][A-Za-z ,0-9]*?:)/g;

type Style = 'regular' | 'bold' | 'italic';

/** An image, once loaded. (Not `img.decode()`: it never finishes while the page is hidden.) */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`couldn't load ${src}`));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, r);
}

/** Rules text as styled runs: labels ("Grow Up:") and keywords bold, reminders in brackets italic. */
function runs(text: string): [string, Style][] {
  const marks: Style[] = Array.from(text, () => 'regular');
  for (const pattern of [KEYWORDS, LABEL])
    for (const m of text.matchAll(pattern)) {
      const start = m.index! + m[0].indexOf(m[1]);
      for (let i = start; i < start + m[1].length; i++) marks[i] = 'bold';
    }
  for (const m of text.matchAll(/\([^)]*\)/g)) for (let i = m.index!; i < m.index! + m[0].length; i++) marks[i] = 'italic';
  const out: [string, Style][] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++)
    if (i === text.length || marks[i] !== marks[start]) { out.push([text.slice(start, i), marks[start]]); start = i; }
  return out;
}

/** Word-wraps styled runs into lines of [word or space, style]. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, font: (s: Style) => string): [string, Style][][] {
  const lines: [string, Style][][] = [];
  let line: [string, Style][] = [], used = 0;
  const measure = (piece: string, style: Style) => { ctx.font = font(style); return ctx.measureText(piece).width; };
  for (const [chunk, style] of runs(text))
    for (const piece of chunk.split(/(\s+)/)) {
      if (!piece) continue;
      if (piece.includes('\n')) { lines.push(line); line = []; used = 0; continue; }
      if (/^\s+$/.test(piece)) { if (line.length) { line.push([' ', style]); used += measure(' ', style); } continue; }
      const size = measure(piece, style);
      if (used + size > width && line.length) {
        while (line.length && line[line.length - 1][0] === ' ') line.pop();
        lines.push(line);
        line = []; used = 0;
      }
      line.push([piece, style]);
      used += size;
    }
  if (line.length) lines.push(line);
  return lines;
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * 0.45 : r, angle = Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + radius * Math.cos(angle), cy - radius * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A stat badge standing on `bottom`, lined up by the drawing inside the icon, its number on the icon's flat area. */
/**
 * A stat as a small chip in the family's tint, as compose_cards.py prints it: the icon, then the number.
 * `edge` is the chip's left edge (Power) or right edge (Health, `right`), `bottom` its bottom.
 */
function statChip(p: Parts, icon: HTMLImageElement, kind: 'paw' | 'heart', edge: number, bottom: number, value: number, right: boolean) {
  const { ctx, s } = p;
  const [main, dark, tint] = p.colors;
  const h = 62 * s, size = 34 * s, pad = 14 * s, gap = 8 * s;
  const digits = String(value);
  ctx.font = `900 ${40 * s}px ${FONT}`;
  const w = pad + size + gap + ctx.measureText(digits).width + pad;
  const x = right ? edge - w : edge, y = bottom - h;
  roundRect(ctx, x, y, x + w, y + h, h / 2);
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = main;
  ctx.stroke();
  // The icon is a white mask: tint it on a scratch canvas, then place it.
  const px = Math.max(1, Math.round(size));
  const tinted = document.createElement('canvas');
  tinted.width = tinted.height = px;
  const t = tinted.getContext('2d')!;
  t.drawImage(icon, 0, 0, px, px);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = kind === 'heart' ? HEART_COLOR : dark;
  t.fillRect(0, 0, px, px);
  ctx.drawImage(tinted, x + pad, y + (h - size) / 2, size, size);
  ctx.fillStyle = dark;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(digits, x + pad + size + gap, y + h / 2 + 1 * s);
}

/** What the wallpaper is for. Each gets its own shape, and its screen's corner rounding. */
export type Device = 'phone' | 'tablet' | 'computer';
export const DEVICES: [Device, string][] = [['phone', 'Phone'], ['tablet', 'Tablet'], ['computer', 'Computer']];

/** The kind of device this is: iPads say they're Macs, but Macs have no touch screen. */
export function thisDevice(): Device {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile/.test(ua)) return 'phone';
  if (/Android/.test(ua)) return 'tablet';
  return 'computer';
}

/**
 * The picture's size and its screen's corner radius. On the device it's for, the screen's own pixels;
 * otherwise a big current model: iPhone Pro Max, iPad Pro 12.9", a 4K monitor. Phones and tablets
 * are portrait; computers landscape. Corners: iPhones are rounded by about 14% of their width, iPads
 * by about 2.5%, monitors not at all. `controls` is how tall a band at the bottom a phone's lock
 * screen covers with its flashlight and camera buttons (50pt circles, their tops about 105pt up).
 */
function wallpaperSize(device: Device): { W: number; H: number; corner: number; controls: number } {
  const ratio = window.devicePixelRatio || 1;
  const short = Math.round(Math.min(screen.width, screen.height) * ratio);
  const long = Math.round(Math.max(screen.width, screen.height) * ratio);
  const mine = device === thisDevice() && short > 0;
  if (device === 'phone') {
    const [W, H] = mine && long / short > 1.6 ? [short, long] : [1290, 2796];
    return { W, H, corner: W * 0.14, controls: 118 * (mine ? ratio : 3) };
  }
  if (device === 'tablet') {
    const [W, H] = mine && long / short < 1.6 ? [short, long] : [2048, 2732];
    return { W, H, corner: W * 0.025, controls: 0 };
  }
  const [W, H] = mine && long >= 1600 ? [long, short] : [3840, 2160];
  return { W, H, corner: 0, controls: 0 };
}

interface Parts {
  ctx: CanvasRenderingContext2D;
  card: CardDef;
  side: 'kitten' | 'bigcat' | null;
  colors: [string, string, string];
  s: number;
  number: string;
  rarity: Rarity;
  finish: Finish;
  /** The finish's chrome, painted where a standard card has its family's colours; null for standard. */
  chrome: CanvasGradient | null;
  paw: HTMLImageElement;
  heart: HTMLImageElement;
}

/** A four-point twinkle, as the Prismatic finish scatters over its art. */
function twinkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  [[0, -1], [0.2, -0.2], [1, 0], [0.2, 0.2], [0, 1], [-0.2, 0.2], [-1, 0], [-0.2, -0.2]]
    .forEach(([x, y], i) => (i ? ctx.lineTo(cx + x * r, cy + y * r) : ctx.moveTo(cx + x * r, cy + y * r)));
  ctx.closePath();
  ctx.fill();
}

/**
 * The art in a rounded window, cropped to fill it, bordered in the finish's chrome. Finished copies get
 * a sheen over the art (warm for Gold) and a glint; Prismatic, twinkles too.
 */
function drawArt(p: Parts, art: HTMLImageElement, x0: number, y0: number, x1: number, y1: number, r: number) {
  const { ctx, s, finish, chrome } = p;
  const main = p.colors[0];
  ctx.save();
  roundRect(ctx, x0, y0, x1, y1, r);
  ctx.clip();
  const scale = Math.max((x1 - x0) / art.naturalWidth, (y1 - y0) / art.naturalHeight);
  const aw = art.naturalWidth * scale, ah = art.naturalHeight * scale;
  ctx.drawImage(art, (x0 + x1 - aw) / 2, (y0 + y1 - ah) / 2, aw, ah);
  if (finish !== 'standard') {
    const sheen = ctx.createLinearGradient(x0, y0, x1, y1);
    if (finish === 'gold') {
      sheen.addColorStop(0, 'rgba(255, 200, 80, 0.5)');
      sheen.addColorStop(1, 'rgba(255, 170, 40, 0.35)');
    } else {
      RAINBOW.forEach((c, i, all) => sheen.addColorStop(i / (all.length - 1), c));
    }
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = sheen;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const glint = ctx.createLinearGradient(x0, y0 + (y1 - y0) * 0.25, x1, y0 + (y1 - y0) * 0.6);
    glint.addColorStop(0.35, 'rgba(255,255,255,0)');
    glint.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    glint.addColorStop(0.65, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = glint;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (finish === 'prismatic') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fffbea';
      ctx.shadowColor = 'rgba(255, 220, 255, 0.9)';
      ctx.shadowBlur = 14 * s;
      for (const [fx, fy, size] of [[0.16, 0.14, 26], [0.84, 0.3, 20], [0.24, 0.72, 16], [0.8, 0.84, 22], [0.56, 0.08, 14]]) {
        twinkle(ctx, x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy, size * s);
      }
    }
  }
  ctx.restore();
  roundRect(ctx, x0, y0, x1, y1, r);
  ctx.lineWidth = (chrome ? 7 : 6) * s;
  ctx.strokeStyle = chrome ?? main;
  ctx.stroke();
}

/** The name banner from x0 to x1, with the cost (or a Hero Cat's star) in a circle at its left. Returns its bottom. */
function drawBanner(p: Parts, x0: number, x1: number, top: number): number {
  const { ctx, card, side, s } = p;
  const [main, dark] = p.colors;
  const face = side ? (side === 'kitten' ? card.kitten! : card.bigCat!) : card;
  const bottom = top + 96 * s;
  roundRect(ctx, x0, top, x1, bottom, 26 * s);
  ctx.fillStyle = main;
  ctx.fill();
  ctx.lineWidth = (p.chrome ? 5 : 4) * s;
  ctx.strokeStyle = p.chrome ?? dark;
  ctx.stroke();
  const [title, epithet] = face.name.split(/, (.*)/s);
  const textX = x0 + 114 * s;
  let size = 42 * s;
  ctx.font = `800 ${size}px ${FONT}`;
  while (ctx.measureText(title).width > x1 - textX - 24 * s && size > 26 * s) ctx.font = `800 ${(size -= 2 * s)}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = dark;
  ctx.fillStyle = 'white';
  const titleY = epithet ? top + 50 * s : top + 62 * s;
  ctx.strokeText(title, textX, titleY);
  ctx.fillText(title, textX, titleY);
  if (epithet) {
    ctx.font = `italic 700 ${25 * s}px ${FONT}`;
    ctx.fillText(epithet, textX + 2 * s, top + 84 * s);
  }
  const cx = x0 + 45 * s, cy = top + 48 * s;
  ctx.beginPath();
  ctx.arc(cx, cy, 51 * s, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.lineWidth = (p.chrome ? 9 : 8) * s;
  ctx.strokeStyle = p.chrome ?? dark;
  ctx.stroke();
  if (p.chrome) {   // the cost ring's edges in the chrome's ink
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = CHROME_INK[p.finish];
    for (const r of [55.5, 46.5]) { ctx.beginPath(); ctx.arc(cx, cy, r * s, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (card.type === 'Hero Cat') star(ctx, cx, cy, 38 * s, main);
  else {
    ctx.font = `900 ${60 * s}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dark;
    ctx.fillText(String(card.cost ?? ''), cx, cy + 3 * s);
  }
  return bottom;
}

/** The type line ("CRITTER · CITRUS", with the rarity mark and collector number at the right). Returns its bottom. */
function drawTypeLine(p: Parts, x0: number, x1: number, top: number): number {
  const { ctx, card, side, s } = p;
  const [main, dark, tint] = p.colors;
  const bottom = top + 52 * s;
  roundRect(ctx, x0, top, x1, bottom, 14 * s);
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.lineWidth = (p.chrome ? 4 : 3) * s;
  ctx.strokeStyle = p.chrome ?? main;
  ctx.stroke();
  const kind = side ? `HERO CAT · ${side === 'kitten' ? 'KITTEN' : 'BIG CAT'}` : card.type.toUpperCase();
  // The type on the left, the collector number on the right: the type shrinks to fit beside it, and in
  // a narrow line the number gives way.
  const label = `${kind} · ${card.family.toUpperCase()}`, numberText = `SB1 · ${p.number}`;
  ctx.font = `600 ${20 * s}px ${FONT}`;
  const markW = 36 * s;   // the rarity mark, and the gap before the number
  const tagW = p.finish === 'standard' ? 0 : 34 * s;   // the finish code's tag, and the gap after the number
  const numberW = ctx.measureText(numberText).width + markW + tagW;
  let size = 25 * s;
  const fits = (room: number) => { ctx.font = `800 ${size}px ${FONT}`; return ctx.measureText(label).width <= room; };
  const withNumber = x1 - x0 - 40 * s - numberW - 16 * s;
  while (!fits(withNumber) && size > 19 * s) size -= s;
  const showNumber = fits(withNumber);
  if (!showNumber) { size = 25 * s; while (!fits(x1 - x0 - 40 * s) && size > 14 * s) size -= s; }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.fillStyle = dark;
  ctx.fillText(label, x0 + 20 * s, (top + bottom) / 2);
  if (showNumber) {
    ctx.textAlign = 'right';
    ctx.font = `600 ${20 * s}px ${FONT}`;
    ctx.fillStyle = MUTED;
    const cy = (top + bottom) / 2;
    if (tagW) drawFinishTag(p, x1 - 20 * s, cy);
    ctx.fillText(numberText, x1 - 20 * s - tagW, cy);
    drawRarityMark(ctx, p.rarity, x1 - 20 * s - (numberW - markW) - 20 * s, cy, 13 * s);
  }
  return bottom;
}

/** A finish's code in the collector line (F, G or P), on a little tag of the finish's own material. */
function drawFinishTag(p: Parts, right: number, cy: number) {
  const { ctx, s, finish } = p;
  if (finish === 'standard') return;
  const w = 26 * s, h = 24 * s, x0 = right - w, y0 = cy - h / 2;
  const metal = ctx.createLinearGradient(x0, y0, right, y0 + h);
  const stops = { foil: HOLO, gold: GOLD, prismatic: PRISM }[finish];
  stops.forEach((c, i) => metal.addColorStop(i / (stops.length - 1), c));
  roundRect(ctx, x0, y0, right, y0 + h, 7 * s);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = CHROME_INK[finish];
  ctx.stroke();
  const [letter, ink] = FINISH_CODES[finish];
  ctx.font = `900 ${16 * s}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (ink === 'white') {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * s;
    ctx.strokeText(letter, x0 + w / 2, cy + s);
  }
  ctx.fillStyle = ink;
  ctx.fillText(letter, x0 + w / 2, cy + s);
  ctx.textAlign = 'right';
  ctx.font = `600 ${20 * s}px ${FONT}`;
  ctx.fillStyle = MUTED;
}

/** The rules text and flavour in a white box, shrinking to fit; `reserve` keeps room at the bottom for the stat badges. */
function drawRules(p: Parts, x0: number, y0: number, x1: number, y1: number, reserve: number) {
  const { ctx, card, side, s } = p;
  const face = side ? (side === 'kitten' ? card.kitten! : card.bigCat!) : card;
  const text = face.text ?? '';
  const flavor = side === 'bigcat' ? undefined : card.flavor;
  roundRect(ctx, x0, y0, x1, y1, 18 * s);
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = '#E2D3BA';
  ctx.stroke();
  const inner = x1 - x0 - 48 * s;
  const room = y1 - y0 - 36 * s - reserve;
  const bodyFont = (px: number) => (st: Style) => `${st === 'bold' ? 800 : st === 'italic' ? 'italic 600' : 600} ${px}px ${FONT}`;
  const flavorFont = (px: number) => () => `italic 600 ${px}px ${FONT}`;
  let size = 40 * s, lines: [string, Style][][] = [], flavorLines: [string, Style][][] = [], lineH = 0, flavorH = 0, total = 0;
  for (; size >= 16 * s; size -= s) {
    lines = text ? wrap(ctx, text, inner, bodyFont(size)) : [];
    flavorLines = flavor ? wrap(ctx, flavor, inner, flavorFont(size - 5 * s)) : [];
    lineH = size * 1.32;
    flavorH = (size - 5 * s) * 1.32;
    total = lines.length * lineH + (lines.length && flavorLines.length ? 22 * s : 0) + flavorLines.length * flavorH;
    if (total <= room) break;
  }
  let y = y0 + 18 * s + (room - total) / 2;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  for (const line of lines) {
    let x = x0 + 24 * s;
    for (const [piece, style] of line) {
      ctx.font = bodyFont(size)(style);
      ctx.fillText(piece, x, y + size);
      x += ctx.measureText(piece).width;
    }
    y += lineH;
  }
  if (lines.length && flavorLines.length) {
    ctx.beginPath();
    ctx.moveTo(x0 + (x1 - x0) * 0.2, y + 8 * s);
    ctx.lineTo(x1 - (x1 - x0) * 0.2, y + 8 * s);
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#E2D3BA';
    ctx.stroke();
    y += 22 * s;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = flavorFont(size - 5 * s)();
  for (const line of flavorLines) {
    ctx.fillText(line.map(([piece]) => piece).join(''), (x0 + x1) / 2, y + size - 5 * s);
    y += flavorH;
  }
}

/** The paw (power) and heart (health) badges standing on `bottom` at pawX / heartX, and the footer centred on footerY. */
function drawStats(p: Parts, pawX: number, heartX: number, bottom: number, footerY: number, footerSize = 17) {
  const { ctx, card, side, s } = p;
  const face = side ? (side === 'kitten' ? card.kitten! : card.bigCat!) : card;
  // The chips keep the old badges' footprint: Power from 54 left of pawX, Health to 54 right of heartX.
  if (face.power !== undefined) statChip(p, p.paw, 'paw', pawX - 54 * s, bottom - 30 * s, face.power, false);
  if (!side && card.health !== undefined) statChip(p, p.heart, 'heart', heartX + 54 * s, bottom - 30 * s, card.health, true);
  ctx.font = `600 ${footerSize * s}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = MUTED;
  ctx.fillText(FOOTER, (pawX + heartX) / 2, footerY);
}

/**
 * Renders the wallpaper for a card: the whole screen is the card. Its coloured edge runs along the
 * screen's edge and every corner inside follows the screen's own rounding, so on an iPhone the border
 * curves with the glass. `side` picks a Hero Cat's Kitten or Big Cat face. `finish` is the copy's
 * finish, printed as the card is: its chrome (the edge, the art's border, the banner's and type line's
 * edges, the cost ring) in holographic silver, gold or a rainbow, with a sheen over the art. `rarity`
 * is the mark before the collector number (`number`, "002/055").
 */
export async function renderWallpaper(id: string, side: 'kitten' | 'bigcat' | null, finish: Finish, rarity: Rarity, number: string, device: Device): Promise<Blob> {
  const card: CardDef = CARDS[id];
  const colors = FAMILIES[card.family] ?? FAMILIES.Garden;
  const [main, dark] = colors;
  const { W, H, corner, controls } = wallpaperSize(device);
  const key = side ? `${id}-${side}` : id;
  // The card's fonts, but never waiting more than a moment for them (the fallback font is fine).
  await Promise.race([
    Promise.all([`800 10px ${FONT}`, `700 10px ${FONT}`, `italic 600 10px ${FONT}`, `900 10px ${FONT}`]
      .map((f) => document.fonts?.load(f).catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  const [art, paw, heart] = await Promise.all([
    loadImage(artUrl(key)), loadImage(`${BASE}ui/${STAT_ICONS.paw}.png`), loadImage(`${BASE}ui/${STAT_ICONS.heart}.png`)]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  // Measures are in the printed card's pixels (750 × 1050), times s. A phone's card is as wide as the
  // screen; a tablet's detail is a little finer; a computer's column of text is a card's width.
  const s = device === 'phone' ? W / 750 : device === 'tablet' ? W / 900 : H / 820;
  // The chrome: silver and gold in diagonal bands, the prismatic rainbow turning around the centre.
  let chrome: CanvasGradient | null = null;
  if (finish !== 'standard') {
    const stops = { foil: HOLO, gold: GOLD, prismatic: PRISM }[finish];
    const cycles = finish === 'foil' ? 3 : finish === 'gold' ? 2 : 1;
    chrome = finish === 'prismatic' ? ctx.createConicGradient(0.6, W / 2, H / 2) : ctx.createLinearGradient(0, 0, W, H);
    for (let k = 0; k < cycles; k++) {
      stops.forEach((c, i) => { if (k === 0 || i > 0) chrome!.addColorStop((k + i / (stops.length - 1)) / cycles, c); });
    }
  }
  const p: Parts = { ctx, card, side, colors, s, number, rarity, finish, chrome, paw, heart };

  // The card's edge is the screen's edge: a thin coloured border, then the cream face, both curving
  // with the screen's corners (a radius less the border, so the curves run side by side).
  const edge = 16 * s;
  const face = Math.max(corner - edge, 24 * s);
  ctx.fillStyle = chrome ?? dark;
  ctx.fillRect(0, 0, W, H);
  if (chrome) {   // a fine line in the chrome's ink where it meets the card
    roundRect(ctx, edge - 2 * s, edge - 2 * s, W - edge + 2 * s, H - edge + 2 * s, face + 2 * s);
    ctx.fillStyle = CHROME_INK[finish];
    ctx.fill();
  }
  roundRect(ctx, edge, edge, W - edge, H - edge, face);
  ctx.fillStyle = CREAM;
  ctx.fill();
  // A fine line just inside the border, like a foil-stamped edge: the chrome's ink on a finished copy.
  roundRect(ctx, edge + 5 * s, edge + 5 * s, W - edge - 5 * s, H - edge - 5 * s, Math.max(face - 5 * s, 20 * s));
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = chrome ? CHROME_INK[finish] : main;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const pad = edge + 22 * s;
  const inner = Math.max(face - 22 * s, 18 * s);   // the art window's corners, following the face's
  // In the corners the screen curves away, so the badges stand a little higher and further in there.
  const cornerLift = Math.max(0, corner * 0.4 - 12 * s);

  if (device === 'computer') {
    // Landscape: the art fills the left, and the rest of the card stands in a column on the right.
    const column = Math.min(W * 0.4, 700 * s);
    const artRight = W - pad - column - 24 * s;
    drawArt(p, art, pad, pad, artRight, H - pad, inner);
    const x0 = artRight + 24 * s, x1 = W - pad;
    const bannerBottom = drawBanner(p, x0, x1, pad);
    const typeBottom = drawTypeLine(p, x0, x1, bannerBottom + 12 * s);
    const statsBottom = H - edge - 12 * s;
    drawRules(p, x0, typeBottom + 12 * s, x1, statsBottom - 110 * s, 0);
    drawStats(p, x0 + 70 * s, x1 - 70 * s, statsBottom, statsBottom - 36 * s, 13);
  } else {
    // Portrait: the art fills the top (behind the lock-screen clock), the card's text below it. On a
    // phone the lock screen's flashlight and camera buttons sit in the bottom corners, so the badges
    // stand above them and the footer runs between them.
    const statsBottom = controls ? H - controls : H - edge - 12 * s - cornerLift;
    const footerY = controls ? H - controls * 0.67 : statsBottom - 32 * s;
    // With no stat chips below it (a Kitten, say), the rules box runs down to the footer.
    const shown = side ? (side === 'kitten' ? card.kitten! : card.bigCat!) : card;
    const badges = shown.power !== undefined || (!side && card.health !== undefined);
    const textBottom = badges ? statsBottom - 110 * s : statsBottom - 60 * s;
    const below = (16 + 96 + 12 + 52 + 12) * s + 300 * s + (H - textBottom);
    const artBottom = Math.min(H * 0.6, H - below);
    drawArt(p, art, pad, pad, W - pad, artBottom, inner);
    const bannerBottom = drawBanner(p, pad - 6 * s, W - pad + 6 * s, artBottom + 16 * s);
    const typeBottom = drawTypeLine(p, pad, W - pad, bannerBottom + 12 * s);
    // The stat chips stand just below the rules box, as on the printed card; they don't overlap it.
    drawRules(p, pad, typeBottom + 12 * s, W - pad, textBottom, 0);
    const inset = Math.max(96 * s, corner * 0.55 + 40 * s);
    drawStats(p, inset, W - inset, statsBottom, footerY);
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}

/**
 * Hands the picture to the phone's share sheet (Save Image puts it in Photos), or downloads it where
 * sharing files isn't possible. Must run straight from a tap, so the picture is made beforehand.
 */
export async function saveWallpaper(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

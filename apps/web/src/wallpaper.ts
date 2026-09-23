// Phone wallpapers: the whole screen is the card. The same frame, name banner, type line, rules text
// and stat badges as the printed cards (tools/compose_cards.py), stretched to a phone's shape, with the
// art filling the top of the screen behind the lock-screen clock.
// No website can set the wallpaper itself: the player saves the picture (the share sheet's Save Image
// on iPhone) and chooses it in Photos.

import { CARDS, type CardDef } from '@fruitcats/engine';
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
const CREAM = '#FFF8EC', INK = '#2B211B', MUTED = '#7A6A5C', BADGE_INK = '#50231c';
const FOOTER = 'Fruitcats · Starter Box · © 2026 Krzysztof Cwalina';
const FONT = 'Nunito, "Segoe UI", sans-serif';

/** The stat icons: where their drawing sits on the 256px canvas, and where the number goes (compose_cards.py's BADGES). */
const BADGES = {
  paw: { file: 'icon-paw', ink: [15, 8, 240, 248], at: [0.496, 0.672, 0.51] },
  heart: { file: 'icon-heart', ink: [7, 25, 248, 229], at: [0.496, 0.539, 0.52] },
} as const;

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
function badge(ctx: CanvasRenderingContext2D, icon: HTMLImageElement, kind: keyof typeof BADGES, cx: number, bottom: number, size: number, value: number) {
  const { ink, at: [fx, fy, room] } = BADGES[kind];
  const k = size / 256;
  const left = cx - ((ink[0] + ink[2]) / 2) * k, top = bottom - ink[3] * k;
  ctx.drawImage(icon, left, top, size, size);
  const digits = String(value);
  const width = size * room * 0.92;
  const height = Math.min((width / Math.max(digits.length, 1.6)) * 1.55, size * room * 0.92);
  ctx.font = `900 ${Math.round(height)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = BADGE_INK;
  ctx.strokeText(digits, left + size * fx, top + size * fy);
  ctx.fillStyle = 'white';
  ctx.fillText(digits, left + size * fx, top + size * fy);
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
 * by about 2.5%, monitors not at all.
 */
function wallpaperSize(device: Device): { W: number; H: number; corner: number } {
  const ratio = window.devicePixelRatio || 1;
  const short = Math.round(Math.min(screen.width, screen.height) * ratio);
  const long = Math.round(Math.max(screen.width, screen.height) * ratio);
  const mine = device === thisDevice() && short > 0;
  if (device === 'phone') {
    const [W, H] = mine && long / short > 1.6 ? [short, long] : [1290, 2796];
    return { W, H, corner: W * 0.14 };
  }
  if (device === 'tablet') {
    const [W, H] = mine && long / short < 1.6 ? [short, long] : [2048, 2732];
    return { W, H, corner: W * 0.025 };
  }
  const [W, H] = mine && long >= 1600 ? [long, short] : [3840, 2160];
  return { W, H, corner: 0 };
}

interface Parts {
  ctx: CanvasRenderingContext2D;
  card: CardDef;
  side: 'kitten' | 'bigcat' | null;
  colors: [string, string, string];
  s: number;
  number: string;
  paw: HTMLImageElement;
  heart: HTMLImageElement;
}

/** The art in a rounded window, cropped to fill it, with a rainbow sheen for foils. */
function drawArt(ctx: CanvasRenderingContext2D, art: HTMLImageElement, x0: number, y0: number, x1: number, y1: number, r: number, main: string, s: number, foil: boolean) {
  ctx.save();
  roundRect(ctx, x0, y0, x1, y1, r);
  ctx.clip();
  const scale = Math.max((x1 - x0) / art.naturalWidth, (y1 - y0) / art.naturalHeight);
  const aw = art.naturalWidth * scale, ah = art.naturalHeight * scale;
  ctx.drawImage(art, (x0 + x1 - aw) / 2, (y0 + y1 - ah) / 2, aw, ah);
  if (foil) {
    const sheen = ctx.createLinearGradient(x0, y0, x1, y1);
    ['#ff6b6b', '#ffd36b', '#7bff9a', '#6bd5ff', '#b07bff', '#ff6bd0'].forEach((c, i, all) => sheen.addColorStop(i / (all.length - 1), c));
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
  }
  ctx.restore();
  roundRect(ctx, x0, y0, x1, y1, r);
  ctx.lineWidth = 6 * s;
  ctx.strokeStyle = main;
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
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = dark;
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
  ctx.lineWidth = 8 * s;
  ctx.strokeStyle = dark;
  ctx.stroke();
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

/** The type line ("CRITTER · CITRUS", with the collector number at the right). Returns its bottom. */
function drawTypeLine(p: Parts, x0: number, x1: number, top: number): number {
  const { ctx, card, side, s } = p;
  const [main, dark, tint] = p.colors;
  const bottom = top + 52 * s;
  roundRect(ctx, x0, top, x1, bottom, 14 * s);
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = main;
  ctx.stroke();
  const kind = side ? `HERO CAT · ${side === 'kitten' ? 'KITTEN' : 'BIG CAT'}` : card.type.toUpperCase();
  // The type on the left, the collector number on the right: the type shrinks to fit beside it, and in
  // a narrow line the number gives way.
  const label = `${kind} · ${card.family.toUpperCase()}`, numberText = `SB1 · ${p.number}`;
  ctx.font = `600 ${20 * s}px ${FONT}`;
  const numberW = ctx.measureText(numberText).width;
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
    ctx.fillText(numberText, x1 - 20 * s, (top + bottom) / 2);
  }
  return bottom;
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

/** The paw (power) and heart (health) badges standing on `bottom` at pawX / heartX, and the footer between them. */
function drawStats(p: Parts, pawX: number, heartX: number, bottom: number, footerY: number, footerSize = 17) {
  const { ctx, card, side, s } = p;
  const face = side ? (side === 'kitten' ? card.kitten! : card.bigCat!) : card;
  if (face.power !== undefined) badge(ctx, p.paw, 'paw', pawX, bottom, 138 * s, face.power);
  if (!side && card.health !== undefined) badge(ctx, p.heart, 'heart', heartX, bottom, 138 * s, card.health);
  ctx.font = `600 ${footerSize * s}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = MUTED;
  ctx.fillText(FOOTER, (pawX + heartX) / 2, footerY);
}

/**
 * Renders the wallpaper for a card: the whole screen is the card. Its coloured edge runs along the
 * screen's edge and every corner inside follows the screen's own rounding, so on an iPhone the border
 * curves with the glass. `side` picks a Hero Cat's Kitten or Big Cat face; `foil` adds a rainbow sheen
 * over the art, as the Display Case shows it; `number` is the collector number ("002/055").
 */
export async function renderWallpaper(id: string, side: 'kitten' | 'bigcat' | null, foil: boolean, number: string, device: Device): Promise<Blob> {
  const card: CardDef = CARDS[id];
  const colors = FAMILIES[card.family] ?? FAMILIES.Garden;
  const [main, dark] = colors;
  const { W, H, corner } = wallpaperSize(device);
  const key = side ? `${id}-${side}` : id;
  // The card's fonts, but never waiting more than a moment for them (the fallback font is fine).
  await Promise.race([
    Promise.all([`800 10px ${FONT}`, `700 10px ${FONT}`, `italic 600 10px ${FONT}`, `900 10px ${FONT}`]
      .map((f) => document.fonts?.load(f).catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  const [art, paw, heart] = await Promise.all([
    loadImage(artUrl(key)), loadImage(`${BASE}ui/${BADGES.paw.file}.webp`), loadImage(`${BASE}ui/${BADGES.heart.file}.webp`)]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  // Measures are in the printed card's pixels (750 × 1050), times s. A phone's card is as wide as the
  // screen; a tablet's detail is a little finer; a computer's column of text is a card's width.
  const s = device === 'phone' ? W / 750 : device === 'tablet' ? W / 900 : H / 820;
  const p: Parts = { ctx, card, side, colors, s, number, paw, heart };

  // The card's edge is the screen's edge: a thin coloured border, then the cream face, both curving
  // with the screen's corners (a radius less the border, so the curves run side by side).
  const edge = 16 * s;
  const face = Math.max(corner - edge, 24 * s);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, edge, edge, W - edge, H - edge, face);
  ctx.fillStyle = CREAM;
  ctx.fill();
  // A fine gold line just inside the border, like a foil-stamped edge.
  roundRect(ctx, edge + 5 * s, edge + 5 * s, W - edge - 5 * s, H - edge - 5 * s, Math.max(face - 5 * s, 20 * s));
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = foil ? 'rgba(214, 170, 70, 0.9)' : main;
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
    drawArt(ctx, art, pad, pad, artRight, H - pad, inner, main, s, foil);
    const x0 = artRight + 24 * s, x1 = W - pad;
    const bannerBottom = drawBanner(p, x0, x1, pad);
    const typeBottom = drawTypeLine(p, x0, x1, bannerBottom + 12 * s);
    const statsBottom = H - edge - 12 * s;
    drawRules(p, x0, typeBottom + 12 * s, x1, statsBottom - 110 * s, 0);
    drawStats(p, x0 + 70 * s, x1 - 70 * s, statsBottom, statsBottom - 36 * s, 13);
  } else {
    // Portrait: the art fills the top (behind the lock-screen clock), the card's text below it.
    const statsBottom = H - edge - 12 * s - cornerLift;
    const textBottom = statsBottom - 110 * s;
    const below = (16 + 96 + 12 + 52 + 12) * s + 300 * s + (H - textBottom);
    const artBottom = Math.min(H * 0.6, H - below);
    drawArt(ctx, art, pad, pad, W - pad, artBottom, inner, main, s, foil);
    const bannerBottom = drawBanner(p, pad - 6 * s, W - pad + 6 * s, artBottom + 16 * s);
    const typeBottom = drawTypeLine(p, pad, W - pad, bannerBottom + 12 * s);
    drawRules(p, pad, typeBottom + 12 * s, W - pad, textBottom + 40 * s, 40 * s);
    const inset = Math.max(96 * s, corner * 0.55 + 40 * s);
    drawStats(p, inset, W - inset, statsBottom, statsBottom - 32 * s);
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

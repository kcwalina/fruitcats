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

/** The picture's size: the screen's own pixels (portrait), or an iPhone Pro Max's when unknown. */
function wallpaperSize(): [number, number] {
  const ratio = window.devicePixelRatio || 1;
  let w = Math.round(Math.min(screen.width, screen.height) * ratio);
  let h = Math.round(Math.max(screen.width, screen.height) * ratio);
  if (!w || !h || h / w < 1.6) [w, h] = [1290, 2796];   // desktops: a phone-shaped picture
  if (w < 1000) [w, h] = [1170, Math.round((1170 * h) / w)];   // enough pixels to stay crisp
  return [w, h];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
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

/**
 * Renders the wallpaper for a card. `side` picks a Hero Cat's Kitten or Big Cat face. `foil` adds a
 * rainbow sheen over the art, as the Display Case shows it. `number` is the collector number ("002/055").
 */
export async function renderWallpaper(id: string, side: 'kitten' | 'bigcat' | null, foil: boolean, number: string): Promise<Blob> {
  const card: CardDef = CARDS[id];
  const face = side ? (side === 'kitten' ? card.kitten! : card.bigCat!) : card;
  const [main, dark, tint] = FAMILIES[card.family] ?? FAMILIES.Garden;
  const text = face.text ?? '';
  const power = face.power;
  const health = side ? undefined : card.health;
  const flavor = side === 'bigcat' ? undefined : card.flavor;

  const [W, H] = wallpaperSize();
  const s = W / 750;   // the printed card is 750 wide: every measure below is in its pixels, times s
  const key = side ? `${id}-${side}` : id;
  await Promise.all([`800 10px ${FONT}`, `700 10px ${FONT}`, `italic 600 10px ${FONT}`, `900 10px ${FONT}`]
    .map((f) => document.fonts?.load(f).catch(() => null)));
  const [art, paw, heart] = await Promise.all([
    loadImage(artUrl(key)), loadImage(`${BASE}ui/${BADGES.paw.file}.webp`), loadImage(`${BASE}ui/${BADGES.heart.file}.webp`)]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  // Frame: the family's dark colour to the screen's edges, cream inside.
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 21 * s, 21 * s, W - 21 * s, H - 21 * s, 30 * s);
  ctx.fillStyle = CREAM;
  ctx.fill();

  // The bottom of the card, measured up from the screen's bottom edge as the printed card is.
  const statsBottom = H - 28 * s;
  const textBottom = H - (1050 - 912) * s;

  // Art: the top of the screen, behind the clock.
  const pad = 42 * s;
  const artTop = pad, artBottom = Math.round(H * 0.6);
  ctx.save();
  roundRect(ctx, pad, artTop, W - pad, artBottom, 18 * s);
  ctx.clip();
  const scale = Math.max((W - 2 * pad) / art.naturalWidth, (artBottom - artTop) / art.naturalHeight);
  const aw = art.naturalWidth * scale, ah = art.naturalHeight * scale;
  ctx.drawImage(art, (W - aw) / 2, artTop + (artBottom - artTop - ah) / 2, aw, ah);
  if (foil) {
    const sheen = ctx.createLinearGradient(pad, artTop, W - pad, artBottom);
    ['#ff6b6b', '#ffd36b', '#7bff9a', '#6bd5ff', '#b07bff', '#ff6bd0'].forEach((c, i, all) => sheen.addColorStop(i / (all.length - 1), c));
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
    const glint = ctx.createLinearGradient(pad, artTop + (artBottom - artTop) * 0.25, W - pad, artTop + (artBottom - artTop) * 0.6);
    glint.addColorStop(0.35, 'rgba(255,255,255,0)');
    glint.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    glint.addColorStop(0.65, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = glint;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  roundRect(ctx, pad, artTop, W - pad, artBottom, 18 * s);
  ctx.lineWidth = 6 * s;
  ctx.strokeStyle = main;
  ctx.stroke();

  // Name banner, with the cost (or a Hero Cat's star) in a circle at its left.
  const bannerTop = artBottom + 16 * s, bannerBottom = bannerTop + 96 * s;
  roundRect(ctx, 36 * s, bannerTop, W - 36 * s, bannerBottom, 26 * s);
  ctx.fillStyle = main;
  ctx.fill();
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = dark;
  ctx.stroke();
  const [title, epithet] = face.name.split(/, (.*)/s);
  let titleSize = 42 * s;
  ctx.font = `800 ${titleSize}px ${FONT}`;
  while (ctx.measureText(title).width > W - 230 * s && titleSize > 26 * s) ctx.font = `800 ${(titleSize -= 2 * s)}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = dark;
  ctx.fillStyle = 'white';
  const titleY = epithet ? bannerTop + 50 * s : bannerTop + 62 * s;
  ctx.strokeText(title, 150 * s, titleY);
  ctx.fillText(title, 150 * s, titleY);
  if (epithet) {
    ctx.font = `italic 700 ${25 * s}px ${FONT}`;
    ctx.fillText(epithet, 152 * s, bannerTop + 84 * s);
  }
  const cx = 81 * s, cy = bannerTop + 48 * s;
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

  // Type line.
  const typeTop = bannerBottom + 12 * s, typeBottom = typeTop + 52 * s;
  roundRect(ctx, pad, typeTop, W - pad, typeBottom, 14 * s);
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = main;
  ctx.stroke();
  const kind = side ? `HERO CAT · ${side === 'kitten' ? 'KITTEN' : 'BIG CAT'}` : card.type.toUpperCase();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 ${25 * s}px ${FONT}`;
  ctx.fillStyle = dark;
  ctx.fillText(`${kind} · ${card.family.toUpperCase()}`, 62 * s, (typeTop + typeBottom) / 2);
  ctx.textAlign = 'right';
  ctx.font = `600 ${20 * s}px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`SB1 · ${number}`, W - 62 * s, (typeTop + typeBottom) / 2);

  // Rules text and flavour, shrinking to fit the box.
  const box = { x0: pad, y0: typeBottom + 12 * s, x1: W - pad, y1: textBottom };
  roundRect(ctx, box.x0, box.y0, box.x1, box.y1, 18 * s);
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = '#E2D3BA';
  ctx.stroke();
  const inner = box.x1 - box.x0 - 48 * s;
  // Room at the bottom for the stat badges, which stand over the box's lower corners.
  const room = box.y1 - box.y0 - 36 * s - (power !== undefined || health !== undefined ? 70 * s : 0);
  let size = 40 * s, lines: [string, Style][][] = [], flavorLines: [string, Style][][] = [], lineH = 0, flavorH = 0, total = 0;
  const bodyFont = (px: number) => (st: Style) => `${st === 'bold' ? 800 : st === 'italic' ? 'italic 600' : 600} ${px}px ${FONT}`;
  const flavorFont = (px: number) => () => `italic 600 ${px}px ${FONT}`;
  for (; size >= 18 * s; size -= s) {
    lines = text ? wrap(ctx, text, inner, bodyFont(size)) : [];
    flavorLines = flavor ? wrap(ctx, flavor, inner, flavorFont(size - 5 * s)) : [];
    lineH = size * 1.32;
    flavorH = (size - 5 * s) * 1.32;
    total = lines.length * lineH + (lines.length && flavorLines.length ? 22 * s : 0) + flavorLines.length * flavorH;
    if (total <= room) break;
  }
  let y = box.y0 + 18 * s + (room - total) / 2;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  for (const line of lines) {
    let x = box.x0 + 24 * s;
    for (const [piece, style] of line) {
      ctx.font = bodyFont(size)(style);
      ctx.fillText(piece, x, y + size);
      x += ctx.measureText(piece).width;
    }
    y += lineH;
  }
  if (lines.length && flavorLines.length) {
    ctx.beginPath();
    ctx.moveTo(box.x0 + 150 * s, y + 8 * s);
    ctx.lineTo(box.x1 - 150 * s, y + 8 * s);
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#E2D3BA';
    ctx.stroke();
    y += 22 * s;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = flavorFont(size - 5 * s)();
  for (const line of flavorLines) {
    ctx.fillText(line.map(([p]) => p).join(''), W / 2, y + size - 5 * s);
    y += flavorH;
  }

  // Stats, and the footer between them.
  if (power !== undefined) badge(ctx, paw, 'paw', 96 * s, statsBottom, 138 * s, power);
  if (health !== undefined) badge(ctx, heart, 'heart', W - 96 * s, statsBottom, 138 * s, health);
  ctx.font = `600 ${17 * s}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = MUTED;
  ctx.fillText(FOOTER, W / 2, H - 50 * s);

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

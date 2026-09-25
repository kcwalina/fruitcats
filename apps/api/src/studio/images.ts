// What kind of picture an upload is, and its size, read from the file's first bytes. No image library: the
// Studio only needs to know the format and the width and height, and these three formats say both up front.

export type Format = 'webp' | 'png' | 'jpeg';

export const CONTENT_TYPES: Record<Format, string> = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg' };

export interface Picture { format: Format; width: number; height: number }

export function sniff(b: Buffer): Picture | null {
  if (b.length < 30) return null;
  // PNG: the signature, then the IHDR chunk with the width and height.
  if (b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR')
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // WebP: RIFF....WEBP, then one of three kinds of first chunk.
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { format: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return { format: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    return null;
  }
  // JPEG: walk the markers to the frame header (SOF0–SOF15, except DHT, JPG and DAC).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { format: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + length;
    }
  }
  return null;
}

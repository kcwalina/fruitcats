// Friend codes as QR codes (docs/pvp-plan.md, Adding a friend): one phone shows its code as a QR code, the other scans
// it with the camera inside the game. The QR code holds only the code, never a link: it can only be read from inside
// Fruitcats, and it's no use once the code runs out (15 minutes) or has been used.
//
// Scanning uses the browser's own BarcodeDetector where there is one (Chrome on Android), and otherwise jsQR, loaded
// only when the camera opens (iPhone Safari has no QR reader for web pages).

import qrcode from 'qrcode-generator';
import { normalizeCode } from '@fruitcats/match';

/** What the QR code says: a label a person could read, and the code. */
const PREFIX = 'FRUITCATS FRIEND ';

/** The code as a QR code, in SVG, drawn in `color` on transparent. */
export function qrSvg(code: string, color = '#3b2412'): string {
  const qr = qrcode(0, 'M');
  qr.addData(PREFIX + normalizeCode(code));
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const size = n + quiet * 2;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Your friend code as a QR code"><path d="${path}" fill="${color}"/></svg>`;
}

/** A friend code read from a QR code, or null if it isn't one of ours. */
export function codeFromQr(text: string): string | null {
  const t = text.trim().toUpperCase();
  const raw = t.startsWith(PREFIX) ? t.slice(PREFIX.length) : t;
  const code = normalizeCode(raw);
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export const canScan = () => !!navigator.mediaDevices?.getUserMedia;

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }

/**
 * Open the back camera into `video` and look for a friend code. Resolves with the code, or null when stopped.
 * Rejects if the camera can't be opened (no camera, or permission refused).
 */
export function scan(video: HTMLVideoElement): { found: Promise<string | null>; stop(): void } {
  let stopped = false;
  let stream: MediaStream | null = null;
  let done: (code: string | null) => void = () => {};
  const stop = () => {
    stopped = true;
    for (const track of stream?.getTracks() ?? []) track.stop();
    video.srcObject = null;
    done(null);
  };
  const found = new Promise<string | null>((resolve, reject) => {
    done = resolve;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) { reject(e); return; }
      if (stopped) { stop(); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play().catch(() => {});
      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const detector: Detector | null = Native ? new Native({ formats: ['qr_code'] }) : null;
      const jsQR = detector ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2 && video.videoWidth) {
          let text: string | null = null;
          if (detector) {
            text = (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null;
          } else {
            // A smaller copy is plenty for a QR code filling the frame, and much quicker to read.
            const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR!(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          const code = text ? codeFromQr(text) : null;
          if (code) {
            for (const track of stream?.getTracks() ?? []) track.stop();
            stopped = true;
            resolve(code);
            return;
          }
        }
        window.setTimeout(() => void tick(), 180);
      };
      void tick();
    })();
  });
  return { found, stop };
}

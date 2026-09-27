// How big the site is that a deploy uploads, and whether it can get there.
//
// The Static Web Apps uploader sends the whole built site (apps/web/dist) as one zip every time, whatever changed, and
// Azure's upload permission lasts exactly 2 minutes ("Signature not valid in the specified key time frame", seen with
// SWA_CLI_DEBUG=silly). This machine uploads at about 0.44 MB/s, so a site much over 50 MB can't finish in time. On
// 2026-09-26 the site grew from 49 MB to 115 MB of card art in a day and deploys failed for hours with nothing but
// "The deployment binary exited with code 1", after the tests, the build and the push had all passed. Checked before
// the push, this fails in seconds and says why.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The most a deploy may upload. About 90 s at 0.44 MB/s, inside Azure's 2-minute window with room to spare. */
export const SITE_BUDGET_BYTES = 40 * 1024 * 1024;
/** The uplink measured on this machine (MB/s), for the time estimate in the message. */
const UPLINK_MB_PER_S = 0.44;

export interface SiteSize { bytes: number; files: number; folders: [string, number][] }

/** Total size of a built site, and the size of each top-level folder (biggest first). */
export function siteSize(dir: string): SiteSize {
  let files = 0;
  const walk = (path: string): number => {
    const s = statSync(path);
    if (!s.isDirectory()) { files++; return s.size; }
    return readdirSync(path).reduce((n, name) => n + walk(join(path, name)), 0);
  };
  const folders: [string, number][] = [];
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const size = walk(join(dir, name));
    bytes += size;
    folders.push([name, size]);
  }
  folders.sort((a, b) => b[1] - a[1]);
  return { bytes, files, folders };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Why this site is too big to deploy, or null when it fits the budget. */
export function sizeProblem(size: SiteSize, budget = SITE_BUDGET_BYTES): string | null {
  if (size.bytes <= budget) return null;
  const seconds = Math.round(size.bytes / 1024 / 1024 / UPLINK_MB_PER_S);
  const biggest = size.folders.slice(0, 5).map(([name, bytes]) => `${name} ${mb(bytes)}`).join(', ');
  return `The site is ${mb(size.bytes)} (${size.files} files), over the ${mb(budget)} a deploy can upload: about ${seconds} s at `
    + `${UPLINK_MB_PER_S} MB/s, and Azure's upload window is 2 minutes, so the upload would fail with "exit code 1". `
    + `Biggest: ${biggest}. Card art belongs in the card-pack storage (npm run publish-pack), not in apps/web/dist.`;
}

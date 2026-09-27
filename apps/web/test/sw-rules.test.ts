import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE, FALLBACK_FOR_MS, afterFailure, chooseVersion, evictions, failed, isShellFile, needsRefresh, precacheProblems,
  readState, route, shellCache, staleCaches, started, type RouteContext,
} from '../src/sw-rules';

const SITE = 'https://fruitcats.viamochi.com/';
const PACKS = 'https://fruitcatspacks.blob.core.windows.net';
const ctx: RouteContext = {
  scope: SITE,
  precache: new Set(['index.html', 'assets/main-abc.js', 'assets/main-abc.css', 'ui/glowwood.webp', 'sounds/ability.mp3', 'manifest.webmanifest', 'packs/index.json']),
  packsOrigin: PACKS,
};
const get = (url: string, mode = 'no-cors') => route({ url, method: 'GET', mode }, ctx).strategy;

describe('route', () => {
  it('serves the game page from the stored shell, however it is opened', () => {
    expect(route({ url: SITE, method: 'GET', mode: 'navigate' }, ctx)).toEqual({ strategy: 'shell', key: 'index.html' });
    expect(route({ url: `${SITE}?mute&invite=AB12`, method: 'GET', mode: 'navigate' }, ctx)).toEqual({ strategy: 'shell', key: 'index.html' });
    expect(route({ url: `${SITE}index.html`, method: 'GET', mode: 'navigate' }, ctx)).toEqual({ strategy: 'shell', key: 'index.html' });
  });

  it('leaves the other pages to the network', () => {
    for (const page of ['studio.html', 'portal.html', 'playtests.html', 'docs.html', 'rules.html', 'announcements/domowiki/'])
      expect(get(SITE + page, 'navigate')).toBe('network');
  });

  it('serves the built files from the shell, by their path', () => {
    expect(route({ url: `${SITE}assets/main-abc.js`, method: 'GET' }, ctx)).toEqual({ strategy: 'shell', key: 'assets/main-abc.js' });
    expect(get(`${SITE}ui/glowwood.webp`)).toBe('shell');
    expect(get(`${SITE}sounds/ability.mp3`)).toBe('shell');
    expect(get(`${SITE}manifest.webmanifest`)).toBe('shell');
  });

  it('leaves the site files the game does not use to the network', () => {
    for (const path of ['guide/play/solo.webp', 'studio/index.json', 'cards/sp1/sp1-001.webp', 'version.json', 'playtest/runner.mjs', 'sw.js'])
      expect(get(SITE + path)).toBe('network');
  });

  it('looks up any built script in the stored versions, so the last good version finds its own', () => {
    // Not in this worker's list: an older version's entry script, served by the fallback (or the network, if no
    // stored version has it).
    expect(route({ url: `${SITE}assets/main-old.js`, method: 'GET' }, ctx)).toEqual({ strategy: 'shell', key: 'assets/main-old.js' });
  });

  it('asks the network first for pack lists and set data, here and in the pack storage', () => {
    expect(route({ url: `${SITE}packs/index.json`, method: 'GET', mode: 'cors' }, ctx)).toEqual({ strategy: 'packs', key: `${SITE}packs/index.json` });
    expect(route({ url: `${SITE}packs/sb1/set.json?x=1`, method: 'GET' }, ctx)).toEqual({ strategy: 'packs', key: `${SITE}packs/sb1/set.json` });
    expect(get(`${PACKS}/packs/index.json`, 'cors')).toBe('packs');
    expect(get(`${PACKS}/packs/dw1/set.json`, 'cors')).toBe('packs');
  });

  it('keeps card art and fonts once seen', () => {
    expect(get(`${PACKS}/packs/sb1/art/cards/sb1-001.webp`)).toBe('runtime');
    expect(get(`${PACKS}/packs/sb1/art/illustrations/sb1-001-kitten.webp`)).toBe('runtime');
    expect(get(`${PACKS}/packs/sb1/art/cards/foil/sb1-001.webp`)).toBe('runtime');
    expect(get('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700')).toBe('runtime');
    expect(get('https://fonts.gstatic.com/s/fredoka/v14/abc.woff2', 'cors')).toBe('runtime');
  });

  it('never answers the API, sign-in, Paddle, WebSockets or anything but a GET', () => {
    expect(get('https://api.fruitcats.viamochi.com/v1/store', 'cors')).toBe('network');
    expect(get('https://api.fruitcats.viamochi.com/v1/live')).toBe('network');
    expect(get('https://id.viamochi.com/v1/me', 'cors')).toBe('network');
    expect(get('https://id.viamochi.com/avatars/abc.webp?v=3')).toBe('network');
    expect(get('https://viamochi-id.azurewebsites.net/auth/start', 'cors')).toBe('network');
    expect(get('https://cdn.paddle.com/paddle/v2/paddle.js')).toBe('network');
    expect(get('wss://api.fruitcats.viamochi.com/v1/live')).toBe('network');
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'])
      for (const url of [SITE, `${SITE}assets/main-abc.js`, `${PACKS}/packs/index.json`, `${PACKS}/packs/sb1/art/cards/sb1-001.webp`])
        expect(route({ url, method }, ctx).strategy).toBe('network');
  });

  it('leaves another site path, or a same-looking host, alone', () => {
    const nested: RouteContext = { ...ctx, scope: `${SITE}game/` };
    expect(route({ url: `${SITE}assets/main-abc.js`, method: 'GET' }, nested).strategy).toBe('network');
    expect(route({ url: `${SITE}game/assets/main-abc.js`, method: 'GET' }, nested).strategy).toBe('shell');
    expect(get('https://fruitcatspacks.blob.core.windows.net.evil.example/packs/sb1/art/cards/sb1-001.webp')).toBe('network');
    expect(get('not a url')).toBe('network');
  });
});

describe('the runtime store', () => {
  it('drops the oldest entries past the limit', () => {
    expect(evictions([1, 2, 3], 5)).toEqual([]);
    expect(evictions([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([1, 2]);
  });
  it('refreshes a kept picture once it is a day old, or when its age is unknown', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(needsRefresh(1000, 1000 + day - 1)).toBe(false);
    expect(needsRefresh(1000, 1000 + day + 1)).toBe(true);
    expect(needsRefresh(null, 5)).toBe(true);
    expect(needsRefresh(NaN, 5)).toBe(true);
  });
});

describe('the last-good fallback', () => {
  const now = 1_000_000_000;
  const stored = ['v1', 'v2'];

  it('serves the new version while nothing has started, or it has failed only once', () => {
    expect(chooseVersion(EMPTY_STATE, 'v2', stored, now)).toBe('v2');
    const once = failed(started(EMPTY_STATE, 'v1'), 'v2', now);
    expect(chooseVersion(once, 'v2', stored, now)).toBe('v2');
  });

  it('serves the last good version after two failed starts in a row', () => {
    const twice = failed(failed(started(EMPTY_STATE, 'v1'), 'v2', now), 'v2', now);
    expect(chooseVersion(twice, 'v2', stored, now + 1000)).toBe('v1');
  });

  it('counts failures in a row only: a start in between clears them', () => {
    const s = failed(started(failed(started(EMPTY_STATE, 'v1'), 'v2', now), 'v2'), 'v2', now);
    expect(s.good).toBe('v2');
    expect(chooseVersion(s, 'v2', stored, now)).toBe('v2');
  });

  it('never holds a player on an old version for good', () => {
    const twice = failed(failed(started(EMPTY_STATE, 'v1'), 'v2', now), 'v2', now);
    // A version that starts once takes over, even while it was being passed over.
    expect(chooseVersion(started(twice, 'v2'), 'v2', stored, now)).toBe('v2');
    // The next version gets its own chance straight away.
    expect(chooseVersion(twice, 'v3', ['v1', 'v3'], now)).toBe('v3');
    // And the failing one is tried again after a while (the failure may have been the device's).
    expect(chooseVersion(twice, 'v2', stored, now + FALLBACK_FOR_MS + 1)).toBe('v2');
    // The fallback running doesn't make it the version to keep serving once the new one works.
    expect(chooseVersion(started(started(twice, 'v1'), 'v2'), 'v2', stored, now)).toBe('v2');
  });

  it('serves the new version when the good one is no longer stored', () => {
    const twice = failed(failed(started(EMPTY_STATE, 'v1'), 'v2', now), 'v2', now);
    expect(chooseVersion(twice, 'v2', ['v2'], now)).toBe('v2');
  });

  it('keeps the active and the good shells, and drops the rest', () => {
    const names = [shellCache('v1'), shellCache('v2'), shellCache('v3'), 'folkborn-runtime', 'folkborn-packs', 'folkborn-meta'];
    expect(staleCaches(names, 'v3', 'v1')).toEqual([shellCache('v2')]);
    expect(staleCaches(names, 'v3', 'v3')).toEqual([shellCache('v1'), shellCache('v2')]);
    expect(staleCaches(names, 'v3', null)).toEqual([shellCache('v1'), shellCache('v2')]);
  });

  it('reads any stored state, ignoring what it cannot use', () => {
    expect(readState(null)).toEqual(EMPTY_STATE);
    expect(readState('junk')).toEqual(EMPTY_STATE);
    expect(readState({ good: 'v1', failures: { v2: 2, v3: 'x', v4: -1 }, lastFailureAt: 5 })).toEqual({ good: 'v1', failures: { v2: 2 }, lastFailureAt: 5 });
  });

  it('tells the page to reload once, then once more for the fallback, then to give up', () => {
    expect(afterFailure({ reloaded: false, fellBack: false, fallbackReady: false })).toBe('reload');
    expect(afterFailure({ reloaded: false, fellBack: false, fallbackReady: true })).toBe('reload');
    expect(afterFailure({ reloaded: true, fellBack: false, fallbackReady: true })).toBe('fall-back');
    expect(afterFailure({ reloaded: true, fellBack: false, fallbackReady: false })).toBe('give-up');
    expect(afterFailure({ reloaded: true, fellBack: true, fallbackReady: true })).toBe('give-up');
  });
});

describe('the build list', () => {
  const html = '<script type="module" crossorigin src="./assets/main-abc.js"></script>';

  it('takes the game files and leaves the other pages and large extras out', () => {
    for (const f of ['index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'ui/glowwood.webp', 'ui/stat-heart.svg', 'icons/icon-192.png',
      'sounds/ability.mp3', 'sounds/hit-bad.wav', 'packs/index.json', 'packs/sb1/set.json'])
      expect(isShellFile(f), f).toBe(true);
    for (const f of ['studio.html', 'portal.html', 'playtests.html', 'docs.html', 'rules.html', 'terms.html', 'guide/play/solo.webp', 'studio/index.json',
      'studio/sb1/brief.json', 'cards/sp1/sp1-001.webp', 'sp1/sp1-001.webp', 'avatars/apple.webp', 'announcements/domowiki/index.html',
      'prompts.json', 'staticwebapp.config.json', 'sounds/CREDITS.md', 'ui/app-icon.webp', 'version.json', 'sw.js'])
      expect(isShellFile(f), f).toBe(false);
  });

  it('needs the page, its entry script and the pack list', () => {
    expect(precacheProblems(['index.html', 'assets/main-abc.js', 'packs/index.json'], html)).toEqual([]);
    expect(precacheProblems(['assets/main-abc.js', 'packs/index.json'], html)).toEqual(['index.html is not in the precache list']);
    expect(precacheProblems(['index.html', 'assets/main-abc.js'], html)).toEqual(['packs/index.json is not in the precache list']);
    expect(precacheProblems(['index.html', 'packs/index.json'], html)).toEqual(['the entry script assets/main-abc.js is not in the precache list']);
    expect(precacheProblems(['index.html', 'packs/index.json'], '<p>no script</p>')).toEqual(['index.html loads no entry script']);
  });
});

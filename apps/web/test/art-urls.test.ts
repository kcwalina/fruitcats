// Card pictures carry the time their set's art was published, so redrawn art reaches devices that kept the old
// pictures (the offline worker and the browser keep a picture by its address).

import { describe, expect, it } from 'vitest';
import { ART_STAMPS, artUrl, cardUrl, finishUrl } from '../src/ui';

describe('card picture addresses', () => {
  it('have no stamp until the pack list gives one', () => {
    delete ART_STAMPS.dw1;
    expect(artUrl('DW1-D01')).toMatch(/\/DW1-D01\.webp$/);
  });

  it('change when the set is published again', () => {
    ART_STAMPS.dw1 = '2026-09-27T18:25:55.979Z';
    const before = [artUrl('DW1-D01'), cardUrl('DW1-D01'), finishUrl('DW1-D01', 'foil')];
    for (const url of before) expect(url).toMatch(/\.webp\?v=2026-09-27T18%3A25%3A55\.979Z$/);
    ART_STAMPS.dw1 = '2026-09-28T09:00:00.000Z';
    expect(artUrl('DW1-D01')).not.toBe(before[0]);
    delete ART_STAMPS.dw1;
  });
});

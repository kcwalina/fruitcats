import { describe, expect, it } from 'vitest';
import { runChecks } from '../../../content/check-set';

// Every set in content/ passes check-set (npm run check-set): the same checks a contributor runs.
describe('content sets pass check-set', () => {
  for (const { set, report } of runChecks()) {
    it(`${set.data.name} (${set.folder})`, () => expect(report.errors).toEqual([]));
  }
});

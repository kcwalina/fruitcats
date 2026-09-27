import { afterEach, describe, expect, it } from 'vitest';
import { lockHolder, releaseLock, requireLockHeldBy, takeLock } from './deploy-guard.mjs';

// npm run deploy hands the checks after its merge to a child process (so they read the merged cards), which runs under
// the parent's lock: it must refuse to run unless that parent really holds it.
describe('deploy lock handed to a child', () => {
  const name = `test-${process.pid}-${Date.now()}`;
  afterEach(() => releaseLock(name));

  it('passes for the holder and refuses anyone else', async () => {
    expect(lockHolder(name)).toBeNull();
    expect(() => requireLockHeldBy(name, process.pid)).toThrow(/held by nobody/);
    const unlock = await takeLock(name, { waitMinutes: 0 });
    expect(lockHolder(name)).toBe(process.pid);
    expect(() => requireLockHeldBy(name, process.pid)).not.toThrow();
    expect(() => requireLockHeldBy(name, process.pid + 1)).toThrow(/held by/);
    unlock();
    expect(lockHolder(name)).toBeNull();
  });
});

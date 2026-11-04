import { describe, expect, it } from 'bun:test';

import { RequestRaceGuard } from './requestRaceGuard';

describe('RequestRaceGuard', () => {
  it('marks the most recent request as current', () => {
    const guard = new RequestRaceGuard();
    const first = guard.start();
    const second = guard.start();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('treats an unknown id as stale', () => {
    const guard = new RequestRaceGuard();

    expect(guard.isCurrent(999)).toBe(false);
  });

  it('survives many sequential requests', () => {
    const guard = new RequestRaceGuard();
    let latest = 0;

    for (let i = 0; i < 10; i += 1) {
      latest = guard.start();
    }

    expect(guard.isCurrent(latest)).toBe(true);
    expect(guard.isCurrent(latest - 1)).toBe(false);
  });
});

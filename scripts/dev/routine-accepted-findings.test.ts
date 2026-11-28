import { describe, expect, it } from 'bun:test';

import { ACCEPTED_REMOTE_FINDINGS } from './routine-accepted-findings';

describe('ACCEPTED_REMOTE_FINDINGS', () => {
  it('gives every entry a reason and keys every object by its lint', () => {
    for (const entry of ACCEPTED_REMOTE_FINDINGS) {
      expect(entry.reason.trim()).not.toBe('');
      for (const key of entry.objects === 'all' ? [] : entry.objects)
        expect(key.startsWith(entry.lint)).toBe(true);
    }
  });
});

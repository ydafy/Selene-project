import { describe, expect, test } from 'bun:test';
import { selectLaunchDigest, createLaunchDigestGate } from '../launchDigest';

const row = (id: string, created_at: string, overrides = {}) => ({
  id, created_at, user_id: 'owner', read: false, deleted_at: null,
  title: 'Notice', message: null, type: 'info', action_path: '/product/abc', ...overrides,
});

describe('legacy launch digest', () => {
  test('selects newest eligible owner row regardless of type, title or path', () => {
    expect(selectLaunchDigest([
      row('old', '2025-01-01', { type: 'error', title: 'Urgent', action_path: '/verify/abc' }),
      row('new', '2025-01-02'), row('foreign', '2025-01-03', { user_id: 'other' }),
      row('read', '2025-01-04', { read: true }),
      row('deleted', '2025-01-05', { deleted_at: '2025-01-06' }),
    ], 'owner')?.id).toBe('new');
  });

  test('null read is unread; empty list has no digest', () => {
    expect(selectLaunchDigest([row('null', '2025-01-01', { read: null })], 'owner')?.id).toBe('null');
    expect(selectLaunchDigest([], 'owner')).toBeNull();
  });

  test('StrictMode cleanup releases an in-flight attempt, but a completed launch never repeats', () => {
    const gate = createLaunchDigestGate();
    const first = gate.begin('owner');
    expect(first).not.toBeNull();
    gate.cancel(first!);
    const second = gate.begin('owner');
    expect(second).not.toBeNull();
    expect(gate.complete(first!)).toBe(false);
    expect(gate.complete(second!)).toBe(true);
    expect(gate.begin('owner')).toBeNull();
    gate.reset();
    expect(gate.begin('other')).not.toBeNull();
  });
});

import { describe, expect, test } from 'bun:test';
import { selectLaunchDigest, createLaunchDigestGate, scanLaunchDigest } from '../launchDigest';

const row = (id: string, created_at: string, overrides = {}) => ({
  id, created_at, user_id: 'owner', read: false, deleted_at: null,
  title: 'Notice', message: null, type: 'info', action_path: '/product/abc', ...overrides,
});

const typed = (id: string, created: string, kind: string, role: string) => row(id, created, {
  event_kind: kind, source_event_key: `${kind}:aggregate:revision`, event_payload: { recipient_role: role },
});

describe('launch digest', () => {
  test('scans beyond twenty generic notices for an older priority-three notice', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(String(30 - i), `2026-04-${String(30 - i).padStart(2, '0')}`));
    rows.push(typed('older', '2026-04-01', 'dispute.opened', 'buyer'));
    const cursors: string[] = [];
    const result = await scanLaunchDigest('owner', async (cursor) => {
      cursors.push(cursor?.id ?? 'first');
      return cursor ? rows.slice(20) : rows.slice(0, 20);
    }, 20);
    expect(cursors).toEqual(['first', '11']);
    expect(result).toEqual({ notice: rows[20], hasMore: true });
  });

  test('ties across pages use ID; cancellation prevents another page', async () => {
    const first = row('z', '2026-04-02');
    const second = row('a', '2026-04-02');
    const result = await scanLaunchDigest('owner', async (cursor) => !cursor ? [first] : cursor.id === 'z' ? [second] : [], 1);
    expect(result).toEqual({ notice: first, hasMore: true });
    let calls = 0;
    const cancelled = await scanLaunchDigest('owner', async () => { calls++; return [first]; }, 1, () => calls > 0);
    expect(cancelled).toBeNull();
    expect(calls).toBe(1);
  });
  test('rejects a non-advancing page cursor rather than retrying indefinitely', async () => {
    const first = row('z', '2026-04-02');
    let calls = 0;
    await expect(scanLaunchDigest('owner', async () => {
      if (++calls > 3) throw new Error('fixture retry limit');
      return [first];
    }, 1)).rejects.toThrow('Launch digest cursor did not advance');
    expect(calls).toBe(2);
  });
  test('ranks approved typed priority above newer legacy and across two typed levels', () => {
    expect(selectLaunchDigest([
      row('legacy', '2026-04-04', { type: 'error', title: 'Urgent', action_path: '/verify/x' }),
      typed('listing', '2026-04-03', 'product.approved', 'seller'),
      typed('dispute', '2026-04-02', 'dispute.opened', 'buyer'),
    ], 'owner')?.id).toBe('dispute');
  });

  test('uses newest then ID for equal priority and treats malformed or unknown identity as generic', () => {
    expect(selectLaunchDigest([
      typed('a', '2026-04-02', 'dispute.opened', 'seller'),
      typed('z', '2026-04-02', 'dispute.opened', 'buyer'),
      typed('new', '2026-04-03', 'dispute.opened', 'buyer'),
    ], 'owner')?.id).toBe('new');
    expect(selectLaunchDigest([
      typed('a', '2026-04-02', 'dispute.opened', 'seller'),
      typed('z', '2026-04-02', 'dispute.opened', 'buyer'),
    ], 'owner')?.id).toBe('z');
    expect(selectLaunchDigest([
      row('legacy', '2026-04-02'),
      typed('unknown', '2026-04-03', 'payment.fake', 'buyer'),
      row('bad-key', '2026-04-04', { event_kind: 'dispute.opened', source_event_key: 'wrong:1', event_payload: { recipient_role: 'buyer' } }),
      row('bad-role', '2026-04-05', { event_kind: 'dispute.opened', source_event_key: 'dispute.opened:1', event_payload: { recipient_role: 'admin' } }),
    ], 'owner')?.id).toBe('bad-role');
  });

  test('typed ranking still excludes foreign, read and deleted notices', () => {
    expect(selectLaunchDigest([
      typed('valid', '2026-01-01', 'product.approved', 'seller'),
      { ...typed('foreign', '2026-01-02', 'dispute.opened', 'buyer'), user_id: 'other' },
      { ...typed('read', '2026-01-02', 'dispute.opened', 'buyer'), read: true },
      { ...typed('deleted', '2026-01-02', 'dispute.opened', 'buyer'), deleted_at: '2026-01-03' },
    ], 'owner')?.id).toBe('valid');
  });
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

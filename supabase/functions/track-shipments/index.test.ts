import { describe, expect, it } from 'bun:test';

const source = await Bun.file(
  new URL('./index.ts', import.meta.url),
).text();

describe('track shipments target selection', () => {
  it('selects preparing shipments due after five minutes and shipped shipments due after fifteen minutes', () => {
    expect(source).toContain("preparing: 5 * 60 * 1000");
    expect(source).toContain("shipped: 15 * 60 * 1000");
    expect(source).toContain(".or(`last_tracked_at.is.null,last_tracked_at.lte.${dueAt}`)");
  });

  it('orders due targets deterministically and caps the provider batch at fifty unique tracking numbers', () => {
    expect(source).toContain(".order('last_tracked_at', { ascending: true, nullsFirst: true })");
    expect(source).toContain(".order('id', { ascending: true })");
    expect(source).toContain('.limit(BATCH_SIZE)');
  });
});

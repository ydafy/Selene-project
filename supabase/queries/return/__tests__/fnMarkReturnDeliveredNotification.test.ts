import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = () => readFileSync(join(import.meta.dir, '..', 'fn_mark_return_delivered.sql'), 'utf8');
describe('return delivered notice', () => {
  it('uses the persisted transition timestamp and a unique per-recipient key', () => {
    const text = sql();
    expect(text).toMatch(/UPDATE public\.disputes[\s\S]*?RETURNING return_delivered_at INTO v_return_delivered_at/);
    expect(text).toContain('return_delivered_at = clock_timestamp()');
    expect(text).toContain("'return.delivered:' || p_dispute_id::text || ':' || extract(epoch FROM v_return_delivered_at)::text");
    expect(text).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING');
    expect(text).toMatch(/FROM \(VALUES[\s\S]*?\) AS recipients[\s\S]*?WHERE true/);
  });
  it('preserves guarded transition and avoids refund promises', () => {
    const text = sql();
    expect(text).toContain('FOR UPDATE');
    expect(text).toContain("v_status NOT IN ('waiting_return', 'return_shipped')");
    expect(text).toContain('d.shipment_id');
    expect(text).toContain('s.order_id = o.id');
    expect(text).toContain('o.buyer_id = v_buyer_id');
    expect(text).toContain('s.seller_id = v_seller_id');
    expect(text).toMatch(/IF NOT EXISTS \([\s\S]*?RAISE EXCEPTION 'Invalid return delivery relationship';/);
    expect(text).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(text).toContain("'recipient_role', recipients.recipient_role");
    expect(text).not.toMatch(/Tu reembolso se procesará|stripe|refund/i);
  });
});

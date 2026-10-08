import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const migration = readFileSync(join(root, 'supabase/migrations/20260930000000_dispute_opened_notification.sql'), 'utf8');
const edge = readFileSync(join(root, 'supabase/functions/create-dispute/index.ts'), 'utf8');

describe('dispute.opened transactional producer', () => {
  it('uses an unambiguous preflight column variable without conflict overrides', () => {
    const preflight = migration.match(/DO \$preflight\$([\s\S]*?)\$preflight\$;/)?.[1];
    expect(preflight).toBeDefined();
    expect(preflight).toContain('v_column_name text;');
    expect(preflight).toContain('FOR relation_name, v_column_name, expected_type IN');
    expect(preflight).toContain('AND c.column_name = v_column_name AND c.udt_name = expected_type');
    expect(preflight).toContain("RAISE EXCEPTION 'Required column %.% with type % is absent', relation_name, v_column_name, expected_type;");
    expect(preflight?.replace(/\bc\.column_name\b/g, '')).not.toMatch(/\bcolumn_name\b/);
    expect(migration).not.toMatch(/#\s*variable_conflict|\b(?:SET|set_config)\b[^;]*variable_conflict/i);
  });
  it('fails closed on notification authority, schema, and existing trigger', () => {
    expect(migration).toMatch(/^-- N5f:[\s\S]*?BEGIN;\s*SET LOCAL lock_timeout = '5s';/);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
    for (const marker of ["has_table_privilege('service_role', 'public.notifications', 'INSERT')", 'notifications_source_event_key_user_id_uidx', 'i.indnkeyatts = 2 AND i.indnatts = 2', 'set_product_in_dispute', 'fn_set_product_in_dispute', "t.tgenabled = 'O'", "'public.disputes'::regclass", "('orders', 'buyer_id', 'uuid')", "('shipments', 'order_id', 'uuid')"]) expect(migration).toContain(marker);
  });
  it('rolls back invalid disputes and derives the seller from the shipment', () => {
    expect(migration).toMatch(/AFTER INSERT ON public\.disputes\s+FOR EACH ROW/);
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain("NEW.status IS DISTINCT FROM 'open'");
    expect(migration).toContain('NEW.shipment_id IS NULL');
    expect(migration).toContain('s.order_id = o.id');
    expect(migration).toContain('o.id = NEW.order_id AND s.id = NEW.shipment_id');
    expect(migration).toContain('NEW.buyer_id IS DISTINCT FROM v_buyer_id');
    expect(migration).toContain('NEW.seller_id IS DISTINCT FROM v_seller_id');
    expect(migration).toContain('RAISE EXCEPTION');
    expect(migration).toContain('IF v_seller_id IS DISTINCT FROM v_buyer_id');
    expect(migration).toContain("'dispute.opened:' || NEW.id::text");
    expect(migration).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING');
    expect(migration).toContain("jsonb_build_object('dispute_id', NEW.id, 'order_id', NEW.order_id, 'recipient_role', 'seller')");
    expect(migration).not.toMatch(/user_id,\s*NEW\.seller_id/);
  });
  it('removes the post-commit Edge notices without changing the dispute insert', () => {
    expect(edge).toContain(".from('disputes')");
    expect(edge).not.toMatch(/\.from\('notifications'\)|const notifications =/);
  });
});

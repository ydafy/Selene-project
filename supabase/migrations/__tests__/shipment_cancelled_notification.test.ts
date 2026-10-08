import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const source = readFileSync(join(root, 'supabase/queries/orders/fn_cancel_shipment.sql'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260926000000_shipment_cancelled_notification.sql'), 'utf8');
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const body = (sql: string) => sql.match(/CREATE OR REPLACE FUNCTION public\.fn_cancel_shipment\([\s\S]*?\$\$;/)?.[0];

describe('shipment cancellation event cutover', () => {
  it('ships the entire canonical four-argument replacement without a DROP', () => {
    expect(body(migration)).toBeDefined();
    expect(normalize(body(migration)!)).toBe(normalize(body(source)!));
    expect(migration).not.toMatch(/DROP FUNCTION/i);
    expect(migration).toContain('p_cancellation_loss_cents BIGINT DEFAULT NULL');
  });

  it('fails closed against unexpected RPC authority and missing N4b/N4a prerequisites', () => {
    expect(migration).toContain("'public.fn_cancel_shipment(uuid,text,text,bigint)'::regprocedure");
    expect(migration).toContain('p.prosecdef');
    expect(migration).toContain("has_function_privilege('service_role', p.oid, 'EXECUTE')");
    expect(migration).toContain("NOT has_function_privilege('anon', p.oid, 'EXECUTE')");
    expect(migration).toContain("NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')");
    expect(migration).toContain("has_table_privilege('service_role', 'public.notifications', 'INSERT')");
    expect(migration).toContain("has_table_privilege('anon', 'public.notifications', 'INSERT')");
    expect(migration).toContain('notifications_source_event_key_user_id_uidx');
    expect(migration).toContain('i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate');
    expect(migration).toContain('i.indnkeyatts = 2 AND i.indnatts = 2');
    expect(migration).toContain("pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION');
    expect(migration).not.toMatch(/GRANT EXECUTE|REVOKE EXECUTE/i);
  });
});

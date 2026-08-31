import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  import.meta.dir,
  '..',
  '20260828030000_shipment_tracking_foundation.sql',
);

const migrationSql = (): string => readFileSync(migrationPath, 'utf8');

describe('shipment tracking foundation migration', () => {
  it('creates append-only delivery and tracking ledgers with the required deduplication keys', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.webhook_deliveries',
    );
    expect(sql).toContain('UNIQUE (provider, delivery_id)');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.shipment_tracking_events',
    );
    expect(sql).toContain(
      'webhook_delivery_id UUID REFERENCES public.webhook_deliveries(id)',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS shipment_tracking_events_deduplication_key',
    );
    expect(sql).toContain('NULLS NOT DISTINCT');
    expect(sql).toContain('raw_status');
    expect(sql).toContain('event_at TIMESTAMPTZ NOT NULL');
    expect(sql).toContain('received_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  it('exposes read-only events only to the shipment buyer, seller, and admins', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain(
      'ALTER TABLE public.shipment_tracking_events ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain('FOR SELECT TO authenticated');
    expect(sql).toContain('o.buyer_id = auth.uid()');
    expect(sql).toContain('s.seller_id = auth.uid()');
    expect(sql).toContain("pp.role = 'admin'");
    expect(sql).not.toContain('FOR INSERT TO authenticated');
    expect(sql).not.toContain('FOR UPDATE TO authenticated');
    expect(sql).not.toContain('FOR DELETE TO authenticated');
  });

  it('records events atomically, updates only monotonic shipment states, and restricts the RPC to service_role', () => {
    const sql = migrationSql();

    const rpc =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.fn_record_tracking_event[\s\S]*?\$\$;/i,
      )?.[0] ?? '';

    expect(rpc).toContain('SECURITY DEFINER');
    expect(rpc).toContain('SET search_path = public, pg_temp');
    expect(rpc).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(rpc).toContain(
      'FROM public.shipments WHERE id = p_shipment_id FOR UPDATE',
    );
    expect(rpc).toContain('ON CONFLICT DO NOTHING');
    expect(rpc).toContain(
      "v_status = 'preparing' AND p_transition = 'shipped'",
    );
    expect(rpc).toContain(
      "v_status = 'shipped' AND p_transition = 'delivered'",
    );
    expect(rpc).toContain('shipped_at = p_event_at');
    expect(rpc).toContain('delivered_at = p_event_at');
    expect(rpc).toContain("v_status = 'cancelled'");
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_record_tracking_event',
    );
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_record_tracking_event',
    );
    expect(sql).toContain('TO service_role');
  });
});

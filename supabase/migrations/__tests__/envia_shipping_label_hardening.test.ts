import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDirectory = join(import.meta.dir, '..');

function migrationSql(): string {
  const file = readdirSync(migrationsDirectory).find((entry) =>
    entry.endsWith('_envia_shipping_label_hardening.sql'),
  );

  if (!file) throw new Error('Envia shipping label hardening migration not found');
  return readFileSync(join(migrationsDirectory, file), 'utf8');
}

describe('envia shipping label hardening migration', () => {
  it('adds atomic Envia settings and backward-compatible label metadata without changing shipping_cost', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS envia_carrier TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS listing_quote_reference_destination JSONB/i);
    expect(sql).toMatch(/listing_quote_reference_destination IS NULL\)\s*OR/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS label_generation_state TEXT NOT NULL DEFAULT 'unclaimed'/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS label_provider_cost_cents BIGINT/i);
    expect(sql).toMatch(/UPDATE public\.shipments[\s\S]*?label_generation_state = 'generated'/i);
    expect(sql).toMatch(/label_generation_state IN \('claimed', 'orphan_pending'\)\) = \(claim_token IS NOT NULL\)/i);
    expect(sql).not.toMatch(/SET\s+shipping_cost\s*=/i);
  });

  it('uses shipment-level claim invariants instead of global provider identifier uniqueness', () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS shipments_envia_shipment_id_unique/i);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS shipments_tracking_number_unique/i);
    expect(sql).toMatch(/label_generation_state IN \('unclaimed', 'retryable_rejected'\)/i);
    expect(sql).toMatch(/label_generation_state = 'claimed' AND claim_token = p_claim_token/i);
    expect(sql).toMatch(/label_generation_state = 'orphan_pending'/i);
    expect(sql).toMatch(/v_state = 'claimed' AND v_claim_expires_at <= now\(\)/i);
    expect(sql).toMatch(/stale_claim_requires_reconciliation/i);
    expect(sql).toMatch(/claim_expires_at = NULL/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.shipment_label_events/i);
    expect(sql).toMatch(/CHECK \(event_type IN \('claimed', 'sent', 'rejected', 'orphaned', 'generated', 'reconciled'\)\)/i);
    expect(sql).toMatch(/ALTER TABLE public\.shipment_label_events ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/CREATE POLICY "shipment label events are append-only"/i);
    expect(sql).toMatch(/NOT metadata \?\| ARRAY\[[^\]]*'raw_provider_response'/i);
    expect(sql).not.toMatch(/label_url.*shipment_label_events/i);
  });

  it('hardens every label RPC with a fixed search path, server-side authorization, and service-role-only execution', () => {
    const sql = migrationSql();
    const functions = [
      'fn_claim_shipment_label',
      'fn_mark_shipment_label_sent',
      'fn_finalize_shipment_label',
      'fn_mark_shipment_label_rejected',
      'fn_mark_shipment_label_orphan',
      'fn_reconcile_shipment_label',
    ];

    for (const name of functions) {
      const block = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
      expect(block).toContain('SECURITY DEFINER');
      expect(block).toContain('SET search_path = public, pg_temp');
      expect(block).toContain("auth.role() IS DISTINCT FROM 'service_role'");
      expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO service_role`, 'i'));
    }

    expect(sql).toMatch(/v_seller_id IS DISTINCT FROM p_seller_id/i);
    expect(sql).toMatch(/v_role IS DISTINCT FROM 'admin'/i);
    expect(sql).toMatch(/INSERT INTO public\.shipment_label_events[\s\S]*?'reconciled'/i);
  });

  it('rejects incomplete provider data before reconciliation can generate a shipment', () => {
    const sql = migrationSql();
    const reconcile = sql.match(/CREATE OR REPLACE FUNCTION public\.fn_reconcile_shipment_label[\s\S]*?\$\$;/i)?.[0] ?? '';

    expect(reconcile).toMatch(/p_envia_shipment_id IS NULL[\s\S]*?p_tracking_number IS NULL[\s\S]*?p_label_url IS NULL/i);
    expect(reconcile).toMatch(/p_carrier IS NULL[\s\S]*?p_service IS NULL[\s\S]*?p_print_format IS NULL[\s\S]*?p_print_size IS NULL/i);
    expect(reconcile).toMatch(/p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0/i);
    expect(reconcile).toMatch(/RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'/i);
  });
});

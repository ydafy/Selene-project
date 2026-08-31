import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  import.meta.dir,
  '..',
  '20260824001426_post_purchase_label_generation_foundation.sql',
);

const migrationSql = () => readFileSync(migrationPath, 'utf8');

test('reconciliation atomically finalizes an orphaned label into preparing', () => {
  const sql = migrationSql();
  const reconcile = sql.match(
    /CREATE OR REPLACE FUNCTION public\.fn_reconcile_shipment_label[\s\S]*?\$\$;/i,
  )?.[0] ?? '';

  expect(reconcile).toContain("label_generation_state = 'generated'");
  expect(reconcile).toContain("status = 'preparing'");
  expect(reconcile).toMatch(
    /WHERE id = p_shipment_id AND status = 'paid' AND label_generation_state = 'orphan_pending'/,
  );
  expect(reconcile).toContain("p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0");
  expect(reconcile).toContain("lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress'");
  expect(reconcile).toContain("<> 'ground'");
});

test('locks persisted Envia configuration to Paquetexpress ground', () => {
  const sql = migrationSql();

  expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS system_settings_envia_tuple_check/i);
  expect(sql).toMatch(/envia_carrier = 'paquetexpress'/i);
  expect(sql).toMatch(/lower\(regexp_replace\(btrim\(envia_service\), '\\s\+', ' ', 'g'\)\) = 'ground'/i);
});

test('finalization accepts only the rate-validated Paquetexpress ground result', () => {
  const sql = migrationSql();
  const finalize = sql.match(
    /CREATE OR REPLACE FUNCTION public\.fn_finalize_shipment_label[\s\S]*?\$\$;/i,
  )?.[0] ?? '';

  expect(finalize).toContain("lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress'");
  expect(finalize).toContain("<> 'ground'");
  expect(finalize).toContain("status = 'preparing'");
  expect(finalize).toContain("label_generation_state = 'generation_sent'");
});

test('a sent claim can only become retryable or orphaned with its original token', () => {
  const sql = migrationSql();
  const rejected = sql.match(
    /CREATE OR REPLACE FUNCTION public\.fn_mark_shipment_label_rejected[\s\S]*?\$\$;/i,
  )?.[0] ?? '';
  const orphan = sql.match(
    /CREATE OR REPLACE FUNCTION public\.fn_mark_shipment_label_orphan[\s\S]*?\$\$;/i,
  )?.[0] ?? '';

  expect(rejected).toContain("label_generation_state IN ('claimed', 'generation_sent')");
  expect(rejected).toContain('claim_token = p_claim_token');
  expect(orphan).toContain("label_generation_state IN ('claimed', 'generation_sent')");
  expect(orphan).toContain('claim_token = p_claim_token');
});

test('an expired sent claim becomes reconciliation-only instead of permitting another generation', () => {
  const sql = migrationSql();
  const claim = sql.match(
    /CREATE OR REPLACE FUNCTION public\.fn_claim_shipment_label[\s\S]*?\$\$;/i,
  )?.[0] ?? '';

  expect(claim).toContain("v_state IN ('claimed', 'generation_sent')");
  expect(claim).toContain("SET label_generation_state = 'orphan_pending'");
  expect(claim).toContain("'reconciliation_required', true");
});

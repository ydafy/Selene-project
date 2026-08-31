import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const readSql = (path: string) =>
  readFileSync(join(root, path), 'utf8');

test('a label provider cost is an integer, non-negative shipment value before payout eligibility', () => {
  const migration = readSql(
    'supabase/migrations/20260824001426_post_purchase_label_generation_foundation.sql',
  );

  expect(migration).toMatch(
    /DROP CONSTRAINT IF EXISTS shipments_label_provider_cost_cents_check,[\s\S]*?label_provider_cost_cents IS NULL OR label_provider_cost_cents >= 0/i,
  );
});

test('the payout view deducts only the persisted actual provider cost and blocks invalid costs', () => {
  const sql = readSql(
    'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
  );

  expect(sql).toContain('s.label_provider_cost_cents');
  expect(sql).toContain('s.label_provider_cost_cents >= 0');
  expect(sql).toContain('- s.label_provider_cost_cents');
  expect(sql).toContain('GREATEST(');
  expect(sql).toContain('has_valid_label_provider_cost_cents');
  expect(sql).toContain("'invalid_label_provider_cost'");
});

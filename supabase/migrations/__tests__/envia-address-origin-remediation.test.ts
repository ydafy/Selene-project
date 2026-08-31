import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = () =>
  readFileSync(
    join(import.meta.dir, '..', '20260824020000_envia_address_origin_remediation.sql'),
    'utf8',
  );

test('persists a seller-owned immutable origin snapshot with a street number', () => {
  const sql = migration();

  expect(sql).toContain('ADD COLUMN IF NOT EXISTS street_number TEXT');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS origin_address_id UUID');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS origin_address JSONB');
  expect(sql).toContain('p_origin_address_id UUID');
  expect(sql).toContain('a.user_id = v_seller_id');
  expect(sql).toContain("RAISE EXCEPTION 'SELLER_ORIGIN_CORRECTION_REQUIRED'");
  expect(sql).toContain('origin_address IS NULL');
  expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_claim_shipment_label[\s\S]*FROM PUBLIC, anon, authenticated/i);
});

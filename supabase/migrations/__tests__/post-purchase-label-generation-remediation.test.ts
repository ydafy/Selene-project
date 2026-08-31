import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolvePaymentIntentSucceededAction,
} from '../../functions/stripe-webhooks/single-modal-settlement.ts';
import { selectPaquetexpressGroundRate } from '../../functions/_shared/envia-shipping.ts';

const root = process.cwd();
const readSql = (path: string) => readFileSync(join(root, path), 'utf8');

test('requires a maintainer-owned clean reset before adding the one-item shipment index', () => {
  const sql = readSql(
    'supabase/migrations/20260824001426_post_purchase_label_generation_foundation.sql',
  );

  expect(sql).toContain('PRELAUNCH_RESET_REQUIRED:LEGACY_GROUPED_SHIPMENTS');
  expect(sql).toContain('legacy grouped shipment links');
  expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.order_items/i);
  expect(sql).toMatch(
    /CREATE OR REPLACE FUNCTION public\.fn_create_shipment_from_payment[\s\S]*?LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED/i,
  );
  expect(sql.indexOf('PRELAUNCH_RESET_REQUIRED:LEGACY_GROUPED_SHIPMENTS')).toBeLessThan(
    sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS order_items_shipment_id_unique'),
  );
});

test('retires the legacy grouped settlement route before it can create a shipment', () => {
  const action = resolvePaymentIntentSucceededAction({
    metadata: { seller_id: 'seller-1' },
    amount: 1,
  });

  expect(action.kind).toBe('retired_grouped_settlement');
});

test('removes the retired grouped settlement RPC from background reconciliation', () => {
  const source = readSql(
    'supabase/functions/reconcile-connect-payments/index.ts',
  );

  expect(source).not.toContain('fn_create_shipment_from_payment');
});

test('preserves the INTEGER payout-view column with a final output cast only', () => {
  const sql = readSql(
    'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
  );

  expect(sql).toMatch(
    /GREATEST\([\s\S]*?END,\s*0\s*\)\s*::INTEGER\s+AS release_amount_cents/i,
  );
  expect(sql).not.toMatch(/label_provider_cost_cents\s*::\s*INTEGER/i);
});

test('accepts only the exact Paquetexpress ground rating', () => {
  expect(selectPaquetexpressGroundRate([
    {
      carrier: 'Paquetexpress',
      service: 'Ground',
      totalPrice: '168.75',
      currency: 'MXN',
      quoteId: 'ground-quote',
    },
  ])).toEqual({
    carrier: 'Paquetexpress',
    service: 'Ground',
    quoteReference: 'ground-quote',
    quotedCostCents: 16_875,
  });
});

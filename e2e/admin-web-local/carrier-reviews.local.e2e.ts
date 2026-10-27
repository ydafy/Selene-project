// Admin "Envíos" -> "Cancelaciones con el carrier" against the LOCAL Supabase stack: real login,
// real list-shipment-operation-reviews / resolve-shipment-operation-review functions, real SQL.
//
//   supabase start
//   supabase functions serve --no-verify-jwt --env-file supabase/functions/.env   (other terminal)
//   bun run test:e2e:local
//
// Expects the seeded local database (`supabase db reset`). Seeded rows are removed in
// afterAll, also when the test fails.

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { readLocalStack } from './local-stack';

const stack = readLocalStack();
const db = createClient(stack.apiUrl, stack.serviceRoleKey, { auth: { persistSession: false } });

const adminId = '00000000-0000-4000-8000-000000000001';
const sellerId = '00000000-0000-4000-8000-000000000002';
const buyerId = '00000000-0000-4000-8000-000000000003';
const orderId = 'e2e20000-0000-4000-8000-000000000001';
const shipmentId = 'e2e20000-0000-4000-8000-0000000000b1';
const paymentIntent = 'pi_e2e_carrier_review';
const trackingNumber = 'TRK-E2E-B44D';
const labelCostCents = 8900;
const note = 'El carrier confirmó que el paquete ya viaja';

async function ok<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function cleanup() {
  await ok(db.from('notifications').delete().eq('event_payload->>order_id', orderId), 'notifications');
  await ok(db.from('admin_audit_logs').delete().eq('target_id', shipmentId), 'admin_audit_logs');
  await ok(db.from('shipment_cancellation_operations').delete().eq('shipment_id', shipmentId), 'operations');
  await ok(db.from('shipments').delete().eq('id', shipmentId), 'shipments');
  await ok(db.from('orders').delete().eq('id', orderId), 'orders');
}

test.beforeAll(async () => {
  // Fail fast with a clear message when the functions are not being served.
  for (const name of ['list-shipment-operation-reviews', 'resolve-shipment-operation-review']) {
    const probe = await fetch(`${stack.apiUrl}/functions/v1/${name}`, { method: 'OPTIONS' }).catch(() => null);
    if (!probe || probe.status >= 500 || probe.status === 404) {
      throw new Error('FUNCTIONS_NOT_SERVED: run `supabase functions serve --no-verify-jwt --env-file supabase/functions/.env`.');
    }
  }

  await cleanup();
  await ok(
    db.from('orders').insert({
      id: orderId,
      buyer_id: buyerId,
      total_amount: 500,
      shipping_address: {},
      status: 'paid',
      stripe_payment_intent_id: 'pi_e2e_order',
      actual_stripe_fee_cents: 500,
    }),
    'order',
  );
  await ok(
    db.from('shipments').insert({
      id: shipmentId,
      order_id: orderId,
      seller_id: sellerId,
      status: 'preparing',
      stripe_payment_intent_id: paymentIntent,
      label_generation_state: 'generated',
      label_provider_cost_cents: labelCostCents,
      tracking_number: trackingNumber,
      carrier: 'estafeta',
    }),
    'shipment',
  );

  // The preparing cron claims the shipment and, with a refused carrier cancellation, marks the review.
  const claim = await ok(
    db.rpc('fn_claim_shipment_cancellation', {
      p_shipment_id: shipmentId,
      p_order_id: orderId,
      p_actor_id: null,
      p_source: 'preparing_timeout',
      p_reason: 'preparing_timeout e2e',
    }),
    'claim',
  );
  await ok(
    db.rpc('fn_mark_shipment_cancellation_review', {
      p_shipment_id: shipmentId,
      p_claim_token: (claim as { claim_token: string }).claim_token,
      p_reason: 'carrier_refused',
    }),
    'mark review',
  );
});

test.afterAll(async () => {
  await cleanup();
});

test('admin sees the pending carrier review and closes it without refund against the local stack', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: 'Entrar al Sistema', exact: true }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Envíos', exact: true }).click();
  await expect(page).toHaveURL(/\/shipments$/);
  await expect(page.getByRole('heading', { name: 'Cancelaciones con el carrier' })).toBeVisible();

  const row = page.getByRole('article').filter({ hasText: trackingNumber });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('El carrier rechazó la cancelación');
  await expect(row).toContainText('estafeta');
  await expect(row).toContainText('$89');
  await expect(row).toContainText('Esperando');

  await row.getByRole('button', { name: 'Cerrar sin reembolso' }).click();
  await page.getByLabel('Nota para el registro').fill(note);
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();

  await expect(row).toHaveCount(0, { timeout: 30_000 });

  const operation = await ok(
    db
      .from('shipment_cancellation_operations')
      .select('review_resolution, review_resolved_by, review_resolution_note, review_resolved_at')
      .eq('shipment_id', shipmentId)
      .single(),
    'operation',
  );
  expect(operation.review_resolution).toBe('closed_no_refund');
  expect(operation.review_resolved_by).toBe(adminId);
  expect(operation.review_resolution_note).toBe(note);
  expect(operation.review_resolved_at).not.toBeNull();

  const shipment = await ok(db.from('shipments').select('status').eq('id', shipmentId).single(), 'shipment');
  expect(shipment.status).toBe('preparing');
});

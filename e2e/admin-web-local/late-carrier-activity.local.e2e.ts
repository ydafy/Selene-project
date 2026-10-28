// Admin "Envíos" -> "Paquetes que se movieron después de cancelar" against the LOCAL Supabase stack:
// real login, real list-shipment-late-carrier-activity / acknowledge-shipment-late-carrier-activity
// functions, real SQL.
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
const orderId = 'e2e30000-0000-4000-8000-000000000001';
const shipmentId = 'e2e30000-0000-4000-8000-0000000000b1';
const paymentIntent = 'pi_e2e_late_activity';
const trackingNumber = 'TRK-E2E-B58B';
const labelCostCents = 8900;
const refundCents = 11000;
const note = 'El vendedor confirmó que el paquete ya salió';

async function ok<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function cleanup() {
  await ok(db.from('shipment_tracking_events').delete().eq('shipment_id', shipmentId), 'tracking events');
  await ok(db.from('notifications').delete().eq('event_payload->>order_id', orderId), 'notifications');
  await ok(db.from('admin_audit_logs').delete().eq('target_id', shipmentId), 'admin_audit_logs');
  await ok(db.from('shipment_cancellation_operations').delete().eq('shipment_id', shipmentId), 'operations');
  await ok(db.from('shipments').delete().eq('id', shipmentId), 'shipments');
  await ok(db.from('orders').delete().eq('id', orderId), 'orders');
}

test.beforeAll(async () => {
  // Fail fast with a clear message when the functions are not being served.
  for (const name of ['list-shipment-late-carrier-activity', 'acknowledge-shipment-late-carrier-activity']) {
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
      stripe_payment_intent_id: paymentIntent,
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

  // A preparing-timeout cancellation as the cron runs it: claim, carrier accepted, refund started.
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
  const claimToken = (claim as { claim_token: string }).claim_token;
  await ok(
    db.rpc('fn_record_shipment_carrier_cancellation', {
      p_shipment_id: shipmentId,
      p_claim_token: claimToken,
      p_outcome: 'accepted',
      p_balance_returned: true,
      p_balance_returned_at: new Date().toISOString(),
    }),
    'carrier outcome',
  );
  await ok(
    db.rpc('fn_start_shipment_cancellation_refund', {
      p_shipment_id: shipmentId,
      p_claim_token: claimToken,
      p_refund_request: {
        payment_intent: paymentIntent,
        amount: refundCents,
        reason: 'requested_by_customer',
        metadata: {
          shipment_id: shipmentId,
          order_id: orderId,
          caller_role: 'system',
          reason: 'preparing_timeout e2e',
          seguro_share_cents: 500,
        },
      },
      p_cancellation_loss_cents: 0,
    }),
    'start refund',
  );
  await ok(
    db.rpc('fn_record_shipment_cancellation_refund', {
      p_shipment_id: shipmentId,
      p_refund_id: 're_e2e_late_activity',
      p_payment_intent_id: paymentIntent,
      p_amount_cents: refundCents,
      p_status: 'pending',
    }),
    'record refund',
  );

  // The carrier reports the package in transit after the refund started.
  await ok(
    db.rpc('fn_record_tracking_event', {
      p_shipment_id: shipmentId,
      p_dispute_id: null,
      p_event_type: 'in_transit',
      p_event_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      p_raw_status: 'e2e in transit',
      p_location: 'CDMX',
      p_status_description: null,
      p_carrier_name: 'Estafeta',
      p_webhook_delivery_id: null,
      p_polling_run_id: null,
      p_transition: 'shipped',
    }),
    'tracking event',
  );
});

test.afterAll(async () => {
  await cleanup();
});

test('admin sees carrier activity after the refund started and marks it reviewed without changing the cancellation', async ({ page }) => {
  const operationBefore = await ok(
    db
      .from('shipment_cancellation_operations')
      .select('source, refund_status, refund_id, external_started_at, late_carrier_activity_at, late_carrier_activity_event_type')
      .eq('shipment_id', shipmentId)
      .single(),
    'operation before',
  );
  expect(operationBefore.late_carrier_activity_event_type).toBe('in_transit');
  // The order status follows its shipments; the acknowledgement must leave both as they are.
  const orderBefore = await ok(db.from('orders').select('status').eq('id', orderId).single(), 'order before');

  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: 'Entrar al Sistema', exact: true }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Envíos', exact: true }).click();
  await expect(page).toHaveURL(/\/shipments$/);
  await expect(page.getByRole('heading', { name: 'Paquetes que se movieron después de cancelar' })).toBeVisible();

  const row = page.getByRole('article').filter({ hasText: trackingNumber });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('En tránsito');
  await expect(row).toContainText('estafeta');
  await expect(row).toContainText('En preparación');
  await expect(row).toContainText('En proceso');
  // The activity time is when the system recorded the scan, not the carrier's event time.
  await expect(row).toContainText('Hace');

  await row.getByRole('button', { name: 'Marcar revisado' }).click();
  await page.getByRole('button', { name: 'Confirmar revisión' }).click();
  await expect(page.getByRole('alert')).toContainText('nota');

  await page.getByLabel('Nota para el registro').fill(note);
  await page.getByRole('button', { name: 'Confirmar revisión' }).click();

  await expect(row).toHaveCount(0, { timeout: 30_000 });

  const operation = await ok(
    db
      .from('shipment_cancellation_operations')
      .select('source, refund_status, refund_id, external_started_at, late_carrier_activity_at, late_carrier_activity_event_type, late_carrier_activity_acknowledged_at, late_carrier_activity_acknowledged_by, late_carrier_activity_acknowledged_note')
      .eq('shipment_id', shipmentId)
      .single(),
    'operation after',
  );
  expect(operation.late_carrier_activity_acknowledged_by).toBe(adminId);
  expect(operation.late_carrier_activity_acknowledged_note).toBe(note);
  expect(operation.late_carrier_activity_acknowledged_at).not.toBeNull();
  // Only the acknowledgement columns changed: the refund and the recorded activity are as they were.
  const { late_carrier_activity_acknowledged_at, late_carrier_activity_acknowledged_by, late_carrier_activity_acknowledged_note, ...unchanged } = operation;
  void late_carrier_activity_acknowledged_at;
  void late_carrier_activity_acknowledged_by;
  void late_carrier_activity_acknowledged_note;
  expect(unchanged).toEqual(operationBefore);

  const shipment = await ok(db.from('shipments').select('status').eq('id', shipmentId).single(), 'shipment');
  expect(shipment.status).toBe('preparing');
  const order = await ok(db.from('orders').select('status').eq('id', orderId).single(), 'order');
  expect(order.status).toBe(orderBefore.status);
});

// Admin "Necesita atención" -> "Reembolsos" against the LOCAL Supabase stack: real login,
// real list-shipment-refund-problems / resolve-shipment-refund functions, real SQL.
//
//   supabase start
//   supabase functions serve --no-verify-jwt --env-file supabase/functions/.env   (other terminal)
//   bun run test:e2e:local
//
// Expects the seeded local database (`supabase db reset`) with no other refund problems.
// Seeded rows are removed in afterAll, also when the test fails.

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { readLocalStack } from './local-stack';

const stack = readLocalStack();
const db = createClient(stack.apiUrl, stack.serviceRoleKey, { auth: { persistSession: false } });

const adminId = '00000000-0000-4000-8000-000000000001';
const sellerId = '00000000-0000-4000-8000-000000000002';
const buyerId = '00000000-0000-4000-8000-000000000003';
const orderId = 'e2e10000-0000-4000-8000-000000000001';
const failed = { shipment: 'e2e10000-0000-4000-8000-0000000000a1', amount: 123456, paymentIntent: 'pi_e2e_failed' };
const escalated = { shipment: 'e2e10000-0000-4000-8000-0000000000a2', amount: 98765, paymentIntent: 'pi_e2e_escalated' };
const shipmentIds = [failed.shipment, escalated.shipment];
const reference = 'SPEI-E2E-0001';

async function ok<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function cleanup() {
  await ok(db.from('notifications').delete().eq('event_payload->>order_id', orderId), 'notifications');
  await ok(db.from('wallet_transactions').delete().in('shipment_id', shipmentIds), 'wallet_transactions');
  await ok(db.from('admin_audit_logs').delete().in('target_id', shipmentIds), 'admin_audit_logs');
  await ok(db.from('shipment_cancellation_operations').delete().in('shipment_id', shipmentIds), 'operations');
  await ok(db.from('shipments').delete().in('id', shipmentIds), 'shipments');
  await ok(db.from('orders').delete().eq('id', orderId), 'orders');
}

async function start(item: typeof failed) {
  const claim = await ok(
    db.rpc('fn_claim_shipment_cancellation', {
      p_shipment_id: item.shipment,
      p_order_id: orderId,
      p_actor_id: buyerId,
      p_source: 'buyer',
      p_reason: 'Changed my mind',
    }),
    'claim',
  );
  const claimToken = (claim as { claim_token: string }).claim_token;
  await ok(
    db.rpc('fn_start_shipment_cancellation_refund', {
      p_shipment_id: item.shipment,
      p_claim_token: claimToken,
      p_refund_request: {
        payment_intent: item.paymentIntent,
        amount: item.amount,
        reason: 'requested_by_customer',
        metadata: { shipment_id: item.shipment, order_id: orderId, caller_role: 'buyer', reason: 'Changed my mind', seguro_share_cents: 500 },
      },
      p_cancellation_loss_cents: 0,
    }),
    'start',
  );
}

test.beforeAll(async () => {
  // Fail fast with a clear message when the functions are not being served.
  const probe = await fetch(`${stack.apiUrl}/functions/v1/list-shipment-refund-problems`, {
    method: 'OPTIONS',
  }).catch(() => null);
  if (!probe || probe.status >= 500 || probe.status === 404) {
    throw new Error('FUNCTIONS_NOT_SERVED: run `supabase functions serve --no-verify-jwt --env-file supabase/functions/.env`.');
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
    db.from('shipments').insert(
      [failed, escalated].map((item) => ({
        id: item.shipment,
        order_id: orderId,
        seller_id: sellerId,
        status: 'paid',
        stripe_payment_intent_id: item.paymentIntent,
      })),
    ),
    'shipments',
  );

  await start(failed);
  const applyArgs = (status: string, reason: string | null) => ({
    p_shipment_id: failed.shipment,
    p_refund_id: 're_e2e_failed',
    p_payment_intent_id: failed.paymentIntent,
    p_amount_cents: failed.amount,
    p_status: status,
    p_failure_reason: reason,
  });
  await ok(db.rpc('fn_apply_shipment_cancellation_refund_event', applyArgs('pending', null)), 'pending');
  await ok(db.rpc('fn_apply_shipment_cancellation_refund_event', applyArgs('failed', 'lost_or_stolen_card')), 'failed');

  await start(escalated);
  await ok(
    db.rpc('fn_escalate_shipment_cancellation', { p_shipment_id: escalated.shipment, p_reason: 'refund_not_found' }),
    'escalate',
  );
});

test.afterAll(async () => {
  await cleanup();
});

test('admin lists both refund problems and resolves one against the local stack', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: 'Entrar al Sistema', exact: true }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/payments');
  await page.getByRole('tab', { name: /Necesita atención/ }).click();
  const chip = (name: RegExp) => page.getByRole('button', { name });
  await expect(chip(/^Reembolsos \(2\)$/)).toBeVisible();
  await chip(/^Reembolsos/).click();

  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(2);
  const failedCard = cards.filter({ hasText: 'Reembolso fallido' });
  const escalatedCard = cards.filter({ hasText: 'Reembolso no encontrado' });
  await expect(failedCard).toContainText('1,234.56');
  await expect(failedCard).toContainText('re_e2e_failed');
  await expect(failedCard).toContainText('lost or stolen card');
  await expect(escalatedCard).toContainText('987.65');

  await failedCard.getByRole('button', { name: 'Marcar resuelto' }).click();
  await page.getByLabel('Referencia del pago externo').fill(reference);
  await page.getByRole('button', { name: 'Confirmar resolución' }).click();

  await expect(chip(/^Reembolsos \(1\)$/)).toBeVisible({ timeout: 30_000 });
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Reembolso no encontrado');

  const operation = await ok(
    db
      .from('shipment_cancellation_operations')
      .select('refund_resolved_at, refund_resolved_by, refund_resolution_reference')
      .eq('shipment_id', failed.shipment)
      .single(),
    'operation',
  );
  expect(operation.refund_resolved_at).not.toBeNull();
  expect(operation.refund_resolved_by).toBe(adminId);
  expect(operation.refund_resolution_reference).toBe(reference);

  const audit = await ok(
    db
      .from('admin_audit_logs')
      .select('admin_id, details')
      .eq('target_id', failed.shipment)
      .eq('action_type', 'SHIPMENT_REFUND_RESOLVED'),
    'audit',
  );
  expect(audit).toHaveLength(1);
  expect(audit[0].admin_id).toBe(adminId);
  expect(audit[0].details).toMatchObject({ reference, amount_owed_cents: failed.amount });

  const shipment = await ok(db.from('shipments').select('status').eq('id', failed.shipment).single(), 'shipment');
  expect(shipment.status).toBe('cancelled');
  const untouched = await ok(db.from('shipments').select('status').eq('id', escalated.shipment).single(), 'escalated');
  expect(untouched.status).toBe('paid');
});

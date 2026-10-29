// Admin "Envíos" -> "Guías que no sabemos si se crearon" against the LOCAL Supabase stack:
// real login, real list-shipment-label-reconciliations / resolve-shipment-label-reconciliation
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
const orderId = 'e2e60000-0000-4000-8000-000000000001';
const shipmentId = 'e2e60000-0000-4000-8000-0000000000b1';
const paymentIntent = 'pi_e2e_label_reconciliation';
const note = 'Revisé el panel de Envía y no hay ninguna guía';

async function ok<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function cleanup() {
  await ok(db.from('shipment_label_events').delete().eq('shipment_id', shipmentId), 'label events');
  await ok(db.from('shipments').delete().eq('id', shipmentId), 'shipments');
  await ok(db.from('orders').delete().eq('id', orderId), 'orders');
}

test.beforeAll(async () => {
  // Fail fast with a clear message when the functions are not being served.
  for (const name of ['list-shipment-label-reconciliations', 'resolve-shipment-label-reconciliation']) {
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
      total_amount: 900,
      shipping_address: { city: 'Guadalajara', zip_code: '44100' },
      status: 'paid',
      stripe_payment_intent_id: paymentIntent,
    }),
    'order',
  );
  // A paid shipment whose label request got no answer from Envia, five days ago.
  await ok(
    db.from('shipments').insert({
      id: shipmentId,
      order_id: orderId,
      seller_id: sellerId,
      status: 'paid',
      stripe_payment_intent_id: paymentIntent,
      label_generation_state: 'orphan_pending',
      claim_token: crypto.randomUUID(),
      origin_address: { city: 'CDMX', zip_code: '06600', street_number: '1' },
      label_quote_carrier: 'paquetexpress',
      label_quote_service: 'ground',
      label_quote_cost_cents: 9100,
      label_quote_rated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    'shipment',
  );
  await ok(
    db.from('shipment_label_events').insert([
      {
        shipment_id: shipmentId,
        event_type: 'claimed',
        actor_id: sellerId,
        metadata: {},
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString(),
      },
      {
        shipment_id: shipmentId,
        event_type: 'orphaned',
        actor_id: null,
        metadata: { errorClass: 'timeout' },
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]),
    'label events',
  );
});

test.afterAll(async () => {
  await cleanup();
});

test('admin sees a shipment stuck in label generation and releases it with "no hay guía"', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: 'Entrar al Sistema', exact: true }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Envíos', exact: true }).click();
  await expect(page).toHaveURL(/\/shipments$/);
  // The stack serves each function call in seconds and the page fires three queries at once.
  await expect(page.getByRole('heading', { name: 'Guías que no sabemos si se crearon' })).toBeVisible();

  const row = page.getByRole('article').filter({ hasText: 'e2e60000' });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row).toContainText('Envía no respondió');
  await expect(row).toContainText('CDMX 06600 → Guadalajara 44100');
  await expect(row).toContainText('paquetexpress · ground · $91');
  await expect(row).toContainText('Hace 5 d');

  await row.getByRole('button', { name: 'No hay guía' }).click();
  await page.getByRole('button', { name: 'Confirmar: no hay guía' }).click();
  await expect(page.getByRole('alert')).toContainText('nota');

  await page.getByLabel('Nota para el registro').fill(note);
  await page.getByRole('button', { name: 'Confirmar: no hay guía' }).click();

  await expect(row).toHaveCount(0, { timeout: 30_000 });

  // Released, not cancelled: the seller can generate again; the buyer's money is untouched.
  const shipment = await ok(
    db.from('shipments').select('status, label_generation_state, claim_token, claim_expires_at').eq('id', shipmentId).single(),
    'shipment after',
  );
  expect(shipment).toEqual({ status: 'paid', label_generation_state: 'unclaimed', claim_token: null, claim_expires_at: null });
  const order = await ok(db.from('orders').select('status').eq('id', orderId).single(), 'order after');
  expect(order.status).toBe('paid');

  const released = await ok(
    db.from('shipment_label_events').select('actor_id, metadata').eq('shipment_id', shipmentId).eq('event_type', 'released'),
    'released event',
  );
  expect(released).toHaveLength(1);
  expect(released[0].actor_id).toBe(adminId);
  expect(released[0].metadata).toEqual({ resolution: 'no_label', from_state: 'orphan_pending', note });
});

// Admin "Disputas" -> dispute detail against the LOCAL Supabase stack: real login, real
// disputes/shipments queries, and real signed URLs from the private `evidence` bucket.
// Pins the `shipments.shipping_evidence` shape `{ images: string[] }` that
// generate-shipping-label writes (#322).
//
//   supabase start
//   bun run test:e2e:local
//
// The page calls no Edge Function, so `bun run functions:serve` is not needed here.
// Expects the seeded local database (`supabase db reset`). Seeded rows and objects are
// removed in afterAll, also when the test fails.

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { readLocalStack } from './local-stack';

const stack = readLocalStack();
const db = createClient(stack.apiUrl, stack.secretKey, {
  auth: { persistSession: false },
});

const sellerId = '00000000-0000-4000-8000-000000000002';
const buyerId = '00000000-0000-4000-8000-000000000003';
const orderId = 'e2e30000-0000-4000-8000-000000000001';
const shipmentId = 'e2e30000-0000-4000-8000-0000000000c1';
const disputeId = 'e2e30000-0000-4000-8000-0000000000d1';
// The object paths generate-shipping-label stores: `shipments/<orderId>/<sellerUid>/<file>`.
const packingPhotos = [1, 2, 3].map(
  (n) => `shipments/${orderId}/${sellerId}/packing-${n}.png`,
);
// A 1x1 PNG, so a loaded image has a natural width.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function ok<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  what: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function cleanup() {
  await ok(db.storage.from('evidence').remove(packingPhotos), 'evidence');
  await ok(
    db.from('notifications').delete().eq('event_payload->>order_id', orderId),
    'notifications',
  );
  await ok(
    db.from('system_logs').delete().eq('metadata->>order_id', orderId),
    'system_logs',
  );
  await ok(db.from('disputes').delete().eq('id', disputeId), 'disputes');
  await ok(db.from('shipments').delete().eq('id', shipmentId), 'shipments');
  await ok(db.from('orders').delete().eq('id', orderId), 'orders');
}

test.beforeAll(async () => {
  await cleanup();
  await ok(
    db.from('orders').insert({
      id: orderId,
      buyer_id: buyerId,
      total_amount_cents: 50000,
      shipping_address: {},
      status: 'paid',
      stripe_payment_intent_id: 'pi_e2e_dispute_order',
      actual_stripe_fee_cents: 500,
    }),
    'order',
  );
  for (const path of packingPhotos) {
    await ok(
      db.storage
        .from('evidence')
        .upload(path, png, { contentType: 'image/png', upsert: false }),
      `upload ${path}`,
    );
  }
  await ok(
    db.from('shipments').insert({
      id: shipmentId,
      order_id: orderId,
      seller_id: sellerId,
      status: 'delivered',
      stripe_payment_intent_id: 'pi_e2e_dispute_shipment',
      label_generation_state: 'generated',
      tracking_number: 'TRK-E2E-D322',
      carrier: 'estafeta',
      shipping_evidence: { images: packingPhotos },
    }),
    'shipment',
  );
  await ok(
    db.from('disputes').insert({
      id: disputeId,
      order_id: orderId,
      shipment_id: shipmentId,
      buyer_id: buyerId,
      seller_id: sellerId,
      reason: 'damaged',
      description: 'Llegó con los pines doblados',
      status: 'open',
    }),
    'dispute',
  );
});

test.afterAll(async () => {
  await cleanup();
});

test('admin sees the seller packing photos through signed evidence URLs against the local stack', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page
    .getByRole('button', { name: 'Entrar al Sistema', exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto(`/disputes/${disputeId}`);
  await expect(page.getByText(`ID: ${disputeId}`)).toBeVisible();

  const photos = page.locator('img[alt^="Vendedor "]');
  await expect(photos).toHaveCount(packingPhotos.length);

  for (const [i, path] of packingPhotos.entries()) {
    const photo = photos.nth(i);
    await expect(photo).toHaveAttribute('alt', `Vendedor ${i}`);
    await expect(photo).toHaveAttribute(
      'src',
      new RegExp(
        `/storage/v1/object/sign/evidence/${path.replace(/[.]/g, '\\.')}\\?token=`,
      ),
    );
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    const src = await photo.getAttribute('src');
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
  }
});

// Admin "Pagos vencidos" against the LOCAL Supabase stack (#549): real login, real
// get-connect-payout-release-queue / record-payout-hold-note / refund-overdue-payout
// functions, real SQL.
//
//   supabase start
//   bun run functions:serve   (other terminal, right before the specs; it exits about 60 s after the last request)
//   bun run test:e2e:local
//
// Seeds an overdue held payout the way bruno/functions/payout-overdue-setup-*.bru does:
// the fixture seller's account is marked `rejected` and one of its shipments was
// completed 40 days ago. The refund reaches Stripe only after the stored status
// passes, so this spec covers its refusal SELLER_ACCOUNT_NOT_REJECTED: the account
// is set back to `pending` after the dialog opened, and the function refuses before
// any Stripe call. Seeded rows are removed and the seller restored in afterAll.

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ownerExec, ownerQuery, readLocalStack, sqlText } from './local-stack';

const stack = readLocalStack();
const db = createClient(stack.apiUrl, stack.secretKey, {
  auth: { persistSession: false },
});

const adminId = '00000000-0000-4000-8000-000000000001';
const sellerId = '00000000-0000-4000-8000-000000000004';
const buyerId = '00000000-0000-4000-8000-000000000005';
const orderId = 'e2e20000-0000-4000-8000-000000000001';
const shipmentId = 'e2e20000-0000-4000-8000-0000000000b1';
const note = 'Stripe rechazó la cuenta; esperamos la apelación del vendedor.';
let sellerBefore: {
  stripe_account_id: string | null;
  stripe_onboarding_status: string | null;
} | null = null;

async function ok<
  R extends { data: unknown; error: { message: string } | null },
>(
  promise: PromiseLike<R>,
  what: string,
): Promise<Extract<R, { error: null }>['data']> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const setSeller = (status: 'rejected' | 'pending') =>
  ok(
    db
      .from('profiles_private')
      .update({
        stripe_account_id: 'acct_local_e2e_overdue',
        stripe_onboarding_status: status,
      })
      .eq('id', sellerId),
    `seller ${status}`,
  );

async function cleanup() {
  await ok(
    db.from('notifications').delete().eq('event_payload->>order_id', orderId),
    'notifications',
  );
  await ok(
    db.from('admin_audit_logs').delete().eq('target_id', shipmentId),
    'admin_audit_logs',
  );
  await ok(
    db
      .from('shipment_payout_hold_notes')
      .delete()
      .eq('shipment_id', shipmentId),
    'hold notes',
  );
  ownerExec(
    stack,
    `DELETE FROM public.shipment_cancellation_operations WHERE shipment_id = ${sqlText(shipmentId)}`,
  );
  await ok(db.from('shipments').delete().eq('id', shipmentId), 'shipments');
  await ok(db.from('orders').delete().eq('id', orderId), 'orders');
}

test.beforeAll(async () => {
  // Fail fast with a clear message when the functions are not being served.
  const probe = await fetch(
    `${stack.apiUrl}/functions/v1/record-payout-hold-note`,
    { method: 'OPTIONS' },
  ).catch(() => null);
  if (!probe || probe.status >= 500 || probe.status === 404) {
    throw new Error('FUNCTIONS_NOT_SERVED: run `bun run functions:serve`.');
  }

  await cleanup();
  sellerBefore = await ok(
    db
      .from('profiles_private')
      .select('stripe_account_id, stripe_onboarding_status')
      .eq('id', sellerId)
      .single(),
    'seller before',
  );
  await setSeller('rejected');
  const completedAt = new Date(
    Date.now() - 40 * 24 * 3600 * 1000,
  ).toISOString();
  await ok(
    db.from('orders').insert({
      id: orderId,
      buyer_id: buyerId,
      total_amount_cents: 10000,
      shipping_address: {
        street: 'Av. Reforma 1',
        city: 'Ciudad de México',
        zip: '06500',
      },
      status: 'completed',
    }),
    'order',
  );
  await ok(
    db.from('shipments').insert({
      id: shipmentId,
      order_id: orderId,
      seller_id: sellerId,
      status: 'completed',
      delivered_at: completedAt,
      completed_at: completedAt,
      stripe_payment_intent_id: 'pi_e2e_payout_overdue',
    }),
    'shipment',
  );
});

test.afterAll(async () => {
  await cleanup();
  if (sellerBefore)
    await ok(
      db.from('profiles_private').update(sellerBefore).eq('id', sellerId),
      'seller restore',
    );
});

test('admin keeps an overdue payout on hold with a note and the refund refuses a seller Stripe did not reject', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page
    .getByRole('button', { name: 'Entrar al Sistema', exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/payments');

  const tab = page.getByRole('tab', { name: /Pagos vencidos/ });
  await expect(tab).toContainText('1');
  await tab.click();
  const card = page.getByRole('article', {
    name: new RegExp(`envío ${shipmentId.slice(0, 8)}$`),
  });
  await expect(card).toContainText('Stripe rechazó el registro del vendedor');
  await expect(card).toContainText(/Retenido hace (39|40) días/);
  await expect(card).toContainText('Sin notas todavía');

  // Hold with a note, end to end.
  await card.getByRole('button', { name: 'Seguir reteniendo' }).click();
  const holdDialog = page.getByRole('dialog', {
    name: 'Seguir reteniendo el pago',
  });
  await holdDialog
    .getByLabel('Nota para seguir reteniendo')
    .fill(`  ${note}  `);
  await holdDialog.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(holdDialog).toHaveCount(0);
  await expect(card).toContainText(note);
  await expect(card).toContainText(adminId.slice(0, 8));

  const notes = await ok(
    db
      .from('shipment_payout_hold_notes')
      .select('admin_id, note')
      .eq('shipment_id', shipmentId),
    'hold notes',
  );
  expect(notes).toEqual([{ admin_id: adminId, note }]);
  const audit = await ok(
    db
      .from('admin_audit_logs')
      .select('admin_id')
      .eq('target_id', shipmentId)
      .eq('action_type', 'PAYOUT_HOLD_NOTED'),
    'audit',
  );
  expect(audit).toEqual([{ admin_id: adminId }]);
  await page.screenshot({
    path: testInfo.outputPath('local-overdue-hold-note.png'),
    fullPage: true,
  });

  // The refund dialog is offered for the rejected account; Stripe lifts nothing
  // here, so the stored status changes before the confirmation to prove the
  // server refuses before calling Stripe.
  await card.getByRole('button', { name: 'Reembolsar al comprador' }).click();
  const refundDialog = page.getByRole('dialog', {
    name: 'Reembolsar al comprador',
  });
  await expect(refundDialog).toContainText('No se puede deshacer.');
  await setSeller('pending');
  await refundDialog
    .getByRole('button', { name: 'Confirmar reembolso' })
    .click();
  await expect(refundDialog.getByRole('alert')).toContainText(
    'Stripe no rechazó la cuenta del vendedor',
  );
  await page.screenshot({
    path: testInfo.outputPath('local-overdue-refund-refused.png'),
    fullPage: true,
  });

  const operations = ownerQuery<{ shipment_id: string }>(
    stack,
    `SELECT shipment_id FROM public.shipment_cancellation_operations WHERE shipment_id = ${sqlText(shipmentId)}`,
  );
  expect(operations).toEqual([]);
  const shipment = await ok(
    db.from('shipments').select('status').eq('id', shipmentId).single(),
    'shipment',
  );
  expect(shipment.status).toBe('completed');
});

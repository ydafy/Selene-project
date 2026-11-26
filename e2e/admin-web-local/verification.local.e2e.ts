// Admin verification screen against the LOCAL Supabase stack (odd/tasks/
// verification-history.md S8): real login, the queue read from
// admin_product_queue_view, the lock from fn_lock_product, the proof signed from
// bucket verification, and the rejection through fn_resolve_product_verdict.
// No Edge Function involved.
//
//   supabase start
//   bun run test:e2e:local
//
// Each run creates its own seller and listing: the listing was rejected once (a
// decided attempt inserted as the database owner) and the seller resubmits it
// through the real fn_submit_product_verification with an uploaded proof.
// afterAll removes everything the run created: the audit logs, the proof rows and
// the attempts (the trigger only blocks UPDATE of a decided attempt; DELETE is
// allowed to the owner and service_role), the storage object, the listing and the
// seller (its notifications cascade with the profile).

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ownerExec, ownerQuery, readLocalStack, sqlText } from './local-stack';

const stack = readLocalStack();
const db = createClient(stack.apiUrl, stack.secretKey, {
  auth: { persistSession: false },
});

const adminId = '00000000-0000-4000-8000-000000000001';
const run = randomUUID().slice(0, 8);
const sellerName = `e2e_ver_${run}`;
const productId = randomUUID();
const productName = `E2E RTX 3080 ${run}`;
const proofPath = `${productId}/physical-${run}.png`;
const previousNote = `La foto del papelito no muestra el usuario ${run}`;
const newNote = `El número de serie no coincide con la caja ${run}`;
// 1x1 PNG: a valid image the browser decodes from the signed URL.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let sellerId = '';
let productCreated = false;
let proofUploaded = false;

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

test.beforeAll(async () => {
  const { user } = await ok(
    db.auth.admin.createUser({
      email: `${sellerName}@example.invalid`,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { username: sellerName },
    }),
    `user ${sellerName}`,
  );
  sellerId = user.id;

  // Publication economics follow validate_product_publication_economics, as
  // the seed computes them.
  ownerExec(
    stack,
    `INSERT INTO public.products (
       id, name, description, price_cents, category, condition, usage, status,
       seller_id, shipping_cost_cents, origin_zip, package_preset,
       publication_shipping_reserve_cents, publication_commission_rate,
       publication_insurance_rate
     )
     SELECT ${sqlText(productId)}::uuid, ${sqlText(productName)},
       'Tarjeta usada para la prueba de verificación.', 750000, 'GPU', 'used',
       'gaming', 'rejected', ${sqlText(sellerId)}::uuid, 18000, '06600', 'gpu_1',
       18000 + s.shipping_buffer_cents + ceil(750000::numeric * s.insurance_rate)::bigint,
       s.service_fee_pct, s.insurance_rate
     FROM public.system_settings s
     WHERE s.id = 1`,
  );
  productCreated = true;

  // The earlier attempt, already rejected with a public note.
  ownerExec(
    stack,
    `INSERT INTO public.product_verifications (
       product_id, submitted_by, submitted_at, decision, decided_by,
       decided_at, public_note
     ) VALUES (
       ${sqlText(productId)}::uuid, ${sqlText(sellerId)}::uuid,
       now() - interval '1 day', 'rejected', ${sqlText(adminId)}::uuid,
       now() - interval '23 hours', ${sqlText(previousNote)}
     )`,
  );

  await ok(
    db.storage
      .from('verification')
      .upload(proofPath, png, { contentType: 'image/png' }),
    'proof upload',
  );
  proofUploaded = true;

  // The seller resubmits through the real RPC: one statement, so the role and
  // the claims hold only for this transaction.
  ownerExec(
    stack,
    `DO $$
     BEGIN
       PERFORM set_config(
         'request.jwt.claims',
         json_build_object('sub', ${sqlText(sellerId)}, 'role', 'authenticated')::text,
         true
       );
       SET LOCAL ROLE authenticated;
       PERFORM public.fn_submit_product_verification(
         ${sqlText(productId)}::uuid,
         ARRAY[${sqlText(proofPath)}]
       );
     END
     $$`,
  );
  const [product] = ownerQuery<{ status: string }>(
    stack,
    `SELECT status FROM public.products WHERE id = ${sqlText(productId)}`,
  );
  expect(product.status).toBe('in_review');
});

test.afterAll(async () => {
  if (productCreated) {
    await ok(
      db.from('admin_audit_logs').delete().eq('target_id', productId),
      'admin_audit_logs',
    );
    ownerExec(
      stack,
      `DELETE FROM public.product_verification_evidence
       WHERE verification_id IN (
         SELECT id FROM public.product_verifications
         WHERE product_id = ${sqlText(productId)}
       )`,
    );
    ownerExec(
      stack,
      `DELETE FROM public.product_verifications WHERE product_id = ${sqlText(productId)}`,
    );
  }
  if (proofUploaded)
    await ok(db.storage.from('verification').remove([proofPath]), 'proof');
  if (productCreated)
    await ok(db.from('products').delete().eq('id', productId), 'product');
  if (sellerId)
    await ok(db.auth.admin.deleteUser(sellerId), `delete user ${sellerId}`);
});

test('admin rejects a resubmitted listing with its previous rejection note and proof against the local stack', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page
    .getByRole('button', { name: 'Entrar al Sistema', exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto('/verify');
  const listItem = page.getByRole('button', { name: new RegExp(productName) });
  await expect(listItem).toBeVisible();
  await listItem.click();

  await expect(page.getByText(productId, { exact: true })).toBeVisible();
  await expect(page.getByText('Motivo de rechazo anterior:')).toBeVisible();
  await expect(
    page.getByText(`"${previousNote}"`, { exact: true }),
  ).toBeVisible();

  const proof = page.getByRole('img', { name: 'Prueba física 1' });
  await expect(proof).toBeVisible();
  await expect(proof).toHaveAttribute(
    'src',
    new RegExp(`/storage/v1/object/sign/verification/${productId}/`),
  );
  await expect
    .poll(() => proof.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await page
    .getByPlaceholder(
      'Escribe aquí el motivo del rechazo o sugerencias de mejora...',
    )
    .fill(newNote);
  await page.getByRole('button', { name: 'Rechazar Producto' }).click();
  await page.getByRole('button', { name: 'Confirmar Rechazo' }).click();
  await expect(page.getByText('Veredicto enviado correctamente')).toBeVisible();
  await expect(listItem).toHaveCount(0);

  const attempts = ownerQuery<{
    decision: string | null;
    decided_by: string | null;
    public_note: string | null;
    locked_by: string | null;
  }>(
    stack,
    `SELECT decision, decided_by, public_note, locked_by
     FROM public.product_verifications
     WHERE product_id = ${sqlText(productId)}
     ORDER BY submitted_at`,
  );
  expect(attempts).toEqual([
    {
      decision: 'rejected',
      decided_by: adminId,
      public_note: previousNote,
      locked_by: null,
    },
    {
      decision: 'rejected',
      decided_by: adminId,
      public_note: newNote,
      locked_by: null,
    },
  ]);
  const [product] = ownerQuery<{ status: string }>(
    stack,
    `SELECT status FROM public.products WHERE id = ${sqlText(productId)}`,
  );
  expect(product.status).toBe('rejected');
});

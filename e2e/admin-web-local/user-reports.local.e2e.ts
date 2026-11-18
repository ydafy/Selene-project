// Admin user detail -> reports against the LOCAL Supabase stack: real login, the real
// `reports` select by target_user_id with the `profiles!reporter_id` embed, under the
// admin RLS policy `reports_select_admin` (#653, S7). No Edge Function involved.
//
//   supabase start
//   bun run test:e2e:local
//
// Expects the seeded local database (`supabase db reset`). Each run creates its own
// reported user and reporters, so the count is exact; afterAll deletes the reports
// first (their foreign keys are ON DELETE RESTRICT) and then the users.

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { readLocalStack } from './local-stack';

const stack = readLocalStack();
const db = createClient(stack.apiUrl, stack.secretKey, {
  auth: { persistSession: false },
});

const adminId = '00000000-0000-4000-8000-000000000001';
const run = randomUUID().slice(0, 8);
const reportedName = `e2e_rep_${run}`;
const openReporterName = `e2e_open_${run}`;
const resolvedReporterName = `e2e_done_${run}`;
const openDetails = `Pidió el pago fuera de la app ${run}`;
const resolvedDetails = `Mensajes insistentes ${run}`;

const userIds: string[] = [];
const reportIds: string[] = [];
let reportedId = '';

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

async function createUser(username: string): Promise<string> {
  const { user } = await ok(
    db.auth.admin.createUser({
      email: `${username}@example.invalid`,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { username },
    }),
    `user ${username}`,
  );
  userIds.push(user.id);
  return user.id;
}

test.beforeAll(async () => {
  reportedId = await createUser(reportedName);
  const openReporterId = await createUser(openReporterName);
  const resolvedReporterId = await createUser(resolvedReporterName);

  // One insert per row: a bulk insert sends NULL for the columns a row omits.
  const open = await ok(
    db
      .from('reports')
      .insert({
        reporter_id: openReporterId,
        target_user_id: reportedId,
        reason: 'fraud',
        details: openDetails,
      })
      .select('id')
      .single(),
    'open report',
  );
  reportIds.push(open.id);
  const resolved = await ok(
    db
      .from('reports')
      .insert({
        reporter_id: resolvedReporterId,
        target_user_id: reportedId,
        reason: 'harassment',
        details: resolvedDetails,
        status: 'resolved',
        resolved_by: adminId,
        resolved_at: new Date().toISOString(),
        outcome: 'warned',
      })
      .select('id')
      .single(),
    'resolved report',
  );
  reportIds.push(resolved.id);
});

test.afterAll(async () => {
  if (reportIds.length > 0)
    await ok(db.from('reports').delete().in('id', reportIds), 'reports');
  for (const id of userIds)
    await ok(db.auth.admin.deleteUser(id), `delete user ${id}`);
});

test('admin sees the reports against a user with reason, details and status against the local stack', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('admin@selene.local');
  await page.locator('input[type="password"]').fill('password123');
  await page
    .getByRole('button', { name: 'Entrar al Sistema', exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto(`/users/${reportedId}`);
  await expect(
    page
      .getByText('Reportes Recibidos', { exact: true })
      .locator('xpath=following-sibling::p[1]'),
  ).toHaveText('2');

  await page.getByRole('button', { name: 'Seguridad y Logs' }).click();
  await expect(page.getByText('Fraude o estafa')).toBeVisible();
  await expect(page.getByText(openDetails)).toBeVisible();
  await expect(page.getByText('Abierta', { exact: true })).toBeVisible();
  await expect(page.getByText(`@${openReporterName}`)).toBeVisible();

  await expect(page.getByText('Acoso', { exact: true })).toBeVisible();
  await expect(page.getByText(resolvedDetails)).toBeVisible();
  await expect(page.getByText('Resuelta: usuario advertido')).toBeVisible();
  await expect(page.getByText(`@${resolvedReporterName}`)).toBeVisible();
});

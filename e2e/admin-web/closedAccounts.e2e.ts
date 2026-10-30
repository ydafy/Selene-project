import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const mockOrigin = 'https://payments-e2e.invalid';
const adminId = '00000000-0000-4000-8000-000000000001';
const closedId = '00000000-0000-4000-8000-000000000003';
const suspendedId = '00000000-0000-4000-8000-000000000004';

const row = (id: string, username: string, role: string, status: string) => ({
  id, role, username, email: `${id}@example.invalid`, avatar_url: null, status,
  is_verified_seller: false, created_at: '2026-01-01T00:00:00.000Z',
  sold_count: 0, verified_count: 0, processed_count: 0,
});
const rows = [
  row(adminId, 'Admin Fixture', 'admin', 'active'),
  row(closedId, 'deleted_0123456789ab', 'user', 'banned'),
  row(suspendedId, 'suspendida', 'user', 'suspended'),
];

// Every backend call is mocked; anything outside the mock origin fails the test.
async function openAdmin(page: Page, context: BrowserContext, baseURL: string, path: string) {
  const unexpected: string[] = [];
  const cors = {
    'access-control-allow-origin': baseURL,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-expose-headers': 'content-range',
    'content-type': 'application/json',
  };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === baseURL && request.method() === 'GET') return route.continue();
    if (url.origin !== mockOrigin) {
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
      return route.abort('blockedbyclient');
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const single = (await request.headerValue('accept'))?.includes('vnd.pgrst.object');
    if (url.pathname === '/rest/v1/admin_user_directory_view') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      const matches = id ? rows.filter((r) => r.id === id) : rows;
      if (single) return route.fulfill({ headers: cors, json: matches[0] ?? null });
      return route.fulfill({
        headers: { ...cors, 'content-range': `0-${matches.length - 1}/${matches.length}` },
        json: matches,
      });
    }
    return route.fulfill({ headers: cors, json: single ? null : [] });
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: adminId, role: 'authenticated', exp: expiresAt })).toString('base64url')}.fake-signature`;
  await context.addInitScript(({ adminId, token, expiresAt }) => {
    localStorage.setItem('sb-payments-e2e-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'fake-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: expiresAt,
      user: { id: adminId, aud: 'authenticated', role: 'authenticated',
        email: 'fixture@example.invalid', app_metadata: {}, user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z' },
    }));
  }, { adminId, token, expiresAt });
  await page.goto(path);
  return { unexpected };
}

test('lists a closed account as deleted, not as banned', async ({ page, context, baseURL }) => {
  const audit = await openAdmin(page, context, baseURL!, '/users');
  const closedCard = page.getByText('@deleted_0123456789ab').locator('xpath=ancestor::div[contains(@class,"group")][1]');
  await expect(closedCard.getByText('Cuenta eliminada')).toBeVisible();
  await expect(closedCard.getByText('banned')).toHaveCount(0);
  await expect(page.getByText('suspended', { exact: true })).toBeVisible();
  expect(audit.unexpected).toEqual([]);
});

test('closed account detail shows the deleted label and no status actions', async ({ page, context, baseURL }) => {
  const audit = await openAdmin(page, context, baseURL!, `/users/${closedId}`);
  await expect(page.getByText('Cuenta eliminada', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('El usuario cerró su cuenta. No se puede reactivar.')).toBeVisible();
  await expect(page.getByText('banned', { exact: true })).toHaveCount(0);
  for (const title of ['Suspender Usuario', 'Reactivar Usuario e Inventario', 'Banear Permanentemente', /Sello de Verificación/]) {
    await expect(page.getByTitle(title)).toHaveCount(0);
  }
  expect(audit.unexpected).toEqual([]);
});

test('suspended account keeps reactivate with copy that does not promise a prior status', async ({ page, context, baseURL }) => {
  const audit = await openAdmin(page, context, baseURL!, `/users/${suspendedId}`);
  await page.getByTitle('Reactivar Usuario e Inventario').click();
  await expect(page.getByText('Sus publicaciones que estaban activas antes de la suspensión vuelven a su estado previo; las demás siguen ocultas hasta revisarlas.')).toBeVisible();
  await expect(page.getByText('regresarán al estado que tenían')).toHaveCount(0);
  expect(audit.unexpected).toEqual([]);
});

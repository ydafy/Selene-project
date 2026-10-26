import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const mockOrigin = 'https://payments-e2e.invalid';
const adminId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
const LEGACY_REQUEST = /wallets|wallet_transactions|payout_requests|seller_bank_accounts|mexico_banks|admin_payments_overview|drain-legacy|fn_request_payout|fn_save_bank_account/;

const profile = (id: string, username: string, role: string) => ({
  id, role, username, email: `${username}@example.invalid`, avatar_url: null,
  status: 'active', is_verified_seller: false, created_at: '2026-01-01T00:00:00.000Z',
  sold_count: 0, verified_count: 0, processed_count: 0,
});

// Every backend call is mocked; requests to legacy wallet resources are recorded and fail the test.
async function openAdmin(page: Page, context: BrowserContext, baseURL: string, path: string) {
  const legacy: string[] = [];
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
    const target = `${url.pathname}${url.search}`;
    if (LEGACY_REQUEST.test(target)) legacy.push(`${request.method()} ${target}`);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/admin_user_directory_view') {
      const single = (await request.headerValue('accept'))?.includes('vnd.pgrst.object');
      const id = url.searchParams.get('id')?.replace('eq.', '');
      const row = id === targetId ? profile(targetId, 'Vendedor Fixture', 'user') : profile(adminId, 'Admin Fixture', 'admin');
      return route.fulfill({ headers: cors, json: single ? row : [row] });
    }
    const single = (await request.headerValue('accept'))?.includes('vnd.pgrst.object');
    if (url.pathname === '/functions/v1/get-connect-payout-release-queue') {
      return route.fulfill({ headers: cors, json: {
        success: true, rows: [], counts: { ready: 0, processing: 0, 'action-required': 0, history: 0 },
        bucket: 'ready', scope: 'page', page: 0, pageSize: 20, totalGroups: 0, totalPages: 1,
        selectedGroupCount: 0, selectionComplete: false,
      } });
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
  return { legacy, unexpected };
}

test('has no legacy drain route or navigation entry, and keeps Connect Earnings', async ({ page, context, baseURL }) => {
  const audit = await openAdmin(page, context, baseURL!, '/');
  await expect(page.getByRole('button', { name: 'Connect Earnings' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Legacy Drain/ })).toHaveCount(0);
  await page.goto('/drain-legacy-wallets');
  await expect(page.getByRole('heading', { name: 'Drain Legacy Wallets' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Execute Drain/ })).toHaveCount(0);
  expect(audit.legacy).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('renders the user detail finance tab without a wallet card or transactions table', async ({ page, context, baseURL }) => {
  const audit = await openAdmin(page, context, baseURL!, `/users/${targetId}`);
  await page.getByRole('button', { name: /Finanzas y Pagos/ }).click();
  await expect(page.getByText('Libro Mayor', { exact: false })).toHaveCount(0);
  await expect(page.getByText(/Saldo Disponible|Saldo Disp/i)).toHaveCount(0);
  await expect(page.getByText(/Transacciones|Movimientos/i)).toHaveCount(0);
  expect(audit.legacy).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('renders the dashboard and payments page without wallet KPIs and keeps the Connect payout UI', async ({ page, context, baseURL }) => {
  const dashboard = await openAdmin(page, context, baseURL!, '/');
  await expect(page.getByText('Por Dispersar (Connect)')).toBeVisible();
  expect(dashboard.legacy).toEqual([]);

  await page.getByRole('button', { name: 'Connect Earnings' }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole('tab', { name: /Por liberar/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Necesita atención/ })).toBeVisible();
  await expect(page.getByText(/Retiros en Proceso|Retiros Fallidos|Total Pendiente/)).toHaveCount(0);
  expect(dashboard.legacy).toEqual([]);
  expect(dashboard.unexpected).toEqual([]);
});

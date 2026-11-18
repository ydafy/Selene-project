import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const mockOrigin = 'https://payments-e2e.invalid';
const adminId = '00000000-0000-4000-8000-000000000001';
const reportedId = '00000000-0000-4000-8000-000000000005';

const profile = (id: string, username: string, role: string) => ({
  id,
  role,
  username,
  email: `${id}@example.invalid`,
  avatar_url: null,
  status: 'active',
  is_verified_seller: false,
  created_at: '2026-01-01T00:00:00.000Z',
  sold_count: 0,
  verified_count: 0,
  processed_count: 0,
});
const profiles = [
  profile(adminId, 'Admin Fixture', 'admin'),
  profile(reportedId, 'vendedor_reportado', 'user'),
];
const reports = [
  {
    id: 'report-open',
    created_at: '2026-11-17T10:00:00.000Z',
    reason: 'fraud',
    details: 'Pidió el pago por transferencia fuera de la app',
    status: 'open',
    outcome: null,
    resolved_at: null,
    reporter: { username: 'compradora' },
  },
  {
    id: 'report-resolved',
    created_at: '2026-11-10T10:00:00.000Z',
    reason: 'harassment',
    details: null,
    status: 'resolved',
    outcome: 'warned',
    resolved_at: '2026-11-12T10:00:00.000Z',
    reporter: { username: 'otro_comprador' },
  },
];

// Every backend call is mocked; anything outside the mock origin fails the test.
async function openAdmin(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  path: string,
) {
  const unexpected: string[] = [];
  const reportRequests: URL[] = [];
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
    if (url.origin === baseURL && request.method() === 'GET')
      return route.continue();
    if (url.origin !== mockOrigin) {
      if (
        !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
      ) {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
      return route.abort('blockedbyclient');
    }
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors });
    const single = (await request.headerValue('accept'))?.includes(
      'vnd.pgrst.object',
    );
    if (url.pathname === '/rest/v1/admin_user_directory_view') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      const matches = id ? profiles.filter((r) => r.id === id) : profiles;
      if (single)
        return route.fulfill({ headers: cors, json: matches[0] ?? null });
      return route.fulfill({
        headers: {
          ...cors,
          'content-range': `0-${matches.length - 1}/${matches.length}`,
        },
        json: matches,
      });
    }
    if (url.pathname === '/rest/v1/reports') {
      reportRequests.push(url);
      // Mirrors PostgREST: only reports whose target_user_id matches.
      const matches =
        url.searchParams.get('target_user_id') === `eq.${reportedId}`
          ? reports
          : [];
      return route.fulfill({
        headers: {
          ...cors,
          'content-range': `0-${matches.length - 1}/${matches.length}`,
        },
        json: matches,
      });
    }
    return route.fulfill({ headers: cors, json: single ? null : [] });
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: adminId, role: 'authenticated', exp: expiresAt })).toString('base64url')}.fake-signature`;
  await context.addInitScript(
    ({ adminId, token, expiresAt }) => {
      localStorage.setItem(
        'sb-payments-e2e-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'fake-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: expiresAt,
          user: {
            id: adminId,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'fixture@example.invalid',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00.000Z',
          },
        }),
      );
    },
    { adminId, token, expiresAt },
  );
  await page.goto(path);
  return { unexpected, reportRequests };
}

test('user detail lists the reports against that user with reason, details and status', async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await openAdmin(
    page,
    context,
    baseURL!,
    `/users/${reportedId}`,
  );

  await expect(
    page
      .getByText('Reportes Recibidos', { exact: true })
      .locator('xpath=following-sibling::p[1]'),
  ).toHaveText('2');

  await page.getByRole('button', { name: 'Seguridad y Logs' }).click();
  await expect(page.getByText('Fraude o estafa')).toBeVisible();
  await expect(
    page.getByText('Pidió el pago por transferencia fuera de la app'),
  ).toBeVisible();
  await expect(page.getByText('Abierta', { exact: true })).toBeVisible();
  await expect(page.getByText('Acoso', { exact: true })).toBeVisible();
  await expect(page.getByText('Resuelta: usuario advertido')).toBeVisible();
  await expect(page.getByText('@compradora')).toBeVisible();
  await expect(page.getByText('fraud', { exact: true })).toHaveCount(0);

  expect(audit.reportRequests).toHaveLength(1);
  const [request] = audit.reportRequests;
  expect(request.searchParams.get('target_user_id')).toBe(`eq.${reportedId}`);
  expect(request.searchParams.has('target_id')).toBe(false);
  expect(request.searchParams.get('select')).not.toContain('*');
  expect(audit.unexpected).toEqual([]);
});

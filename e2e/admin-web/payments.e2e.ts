import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ConnectPayoutReleaseQueueRow } from '../../packages/types/src/index';

const mockOrigin = 'https://payments-e2e.invalid';
const userId = '00000000-0000-4000-8000-000000000001';
const sellerName = (index: number) => `Vendedor ${String(index).padStart(3, '0')}`;

// Two shipments per seller ensure pages count complete groups, not raw rows.
const rows: ConnectPayoutReleaseQueueRow[] = Array.from({ length: 45 }, (_, i) =>
  [1, 2].map((shipment) => ({
    completed_at: '2026-01-01T12:00:00.000Z',
    ineligible_reason: null,
    is_eligible: true,
    is_retryable: false,
    order_id: `order-${i + 1}-${shipment}`,
    payout_run_amount_cents: null,
    payout_run_failed_at: null,
    payout_run_failure_reason: null,
    payout_run_id: null,
    payout_run_paid_at: null,
    payout_run_status: null,
    release_amount_cents: shipment === 1 ? 1000 : 500,
    requires_manual_review: false,
    retry_of_run_id: null,
    seller_id: `seller-${i + 1}`,
    seller_name: sellerName(i + 1),
    shipment_id: `shipment-${i + 1}-${shipment}`,
    status: 'completed' as const,
    stripe_account_id: `acct_fake_${i + 1}`,
    stripe_onboarding_status: 'complete' as const,
    stripe_payment_intent_id: `pi_fake_${i + 1}`,
    stripe_transfer_id: null,
    transfer_group: null,
  })),
).flat();

interface QueueRead {
  bucket: string;
  page: number;
  scope: string;
  search: string;
  groups: number;
}

async function openPayments(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  failSelection = false,
) {
  const reads: QueueRead[] = [];
  const mutations: string[] = [];
  const unexpected: string[] = [];
  const cors = {
    'access-control-allow-origin': baseURL,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json',
  };

  // Install the deny-by-default boundary BEFORE navigation or session setup.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/functions/v1/') &&
      url.pathname !== '/functions/v1/get-connect-payout-release-queue') {
      mutations.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.origin === baseURL && request.method() === 'GET') {
      await route.continue();
      return;
    }
    const profileRead = url.origin === mockOrigin && request.method() === 'GET' &&
      url.pathname === '/rest/v1/admin_user_directory_view';
    const queueRead = url.origin === mockOrigin && request.method() === 'POST' &&
      url.pathname === '/functions/v1/get-connect-payout-release-queue';
    if (url.origin === mockOrigin && request.method() === 'OPTIONS' &&
      ['/rest/v1/admin_user_directory_view', '/functions/v1/get-connect-payout-release-queue'].includes(url.pathname)) {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (profileRead) {
      await route.fulfill({ headers: cors, json: {
        id: userId, role: 'admin', username: 'Browser fixture', email: 'fixture@example.invalid',
        avatar_url: null, status: 'active', is_verified_seller: false,
        created_at: '2026-01-01T00:00:00.000Z', available_balance: 0, pending_balance: 0,
      } });
      return;
    }
    if (queueRead) {
      const body = request.postDataJSON() as { bucket: string; scope: string; page: number; search?: string };
      const search = (body.search ?? '').trim();
      const matched = rows.filter((row) => row.seller_name!.toLowerCase().includes(search.toLowerCase()));
      const matchingIds = [...new Set(matched.map((row) => row.seller_id))];
      const groups = body.bucket === 'ready' ? matchingIds.length : 0;
      const totalPages = Math.max(1, Math.ceil(groups / 20));
      const currentPage = body.scope === 'selection' ? 0 : Math.min(body.page, totalPages - 1);
      const chosenIds = body.scope === 'selection' ? matchingIds : matchingIds.slice(currentPage * 20, (currentPage + 1) * 20);
      reads.push({ bucket: body.bucket, page: body.page, scope: body.scope, search, groups });
      if (failSelection && body.scope === 'selection') {
        await route.fulfill({ status: 502, headers: cors, json: { success: false, error: 'SIMULATED_SELECTION_FAILURE' } });
        return;
      }
      await route.fulfill({ headers: cors, json: {
        success: true,
        rows: body.bucket === 'ready' ? matched.filter((row) => chosenIds.includes(row.seller_id)) : [],
        counts: { ready: matchingIds.length, processing: 0, 'action-required': 0, history: 0 },
        bucket: body.bucket, scope: body.scope, page: currentPage, pageSize: 20,
        totalGroups: groups, totalPages,
        selectedGroupCount: body.scope === 'selection' ? groups : 0,
        selectionComplete: body.scope === 'selection',
      } });
      return;
    }
    // Google Fonts is intentionally unavailable offline; every other unmocked
    // request is also denied and is surfaced as a test failure.
    if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());

  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: expiresAt })).toString('base64url')}.fake-signature`;
  await context.addInitScript(({ userId, token, expiresAt }) => {
    // SupabaseClient derives this project-specific key from its configured host.
    localStorage.setItem('sb-payments-e2e-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'fake-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: expiresAt,
      user: { id: userId, aud: 'authenticated', role: 'authenticated',
        email: 'fixture@example.invalid', app_metadata: {}, user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z' },
    }));
  }, { userId, token, expiresAt });
  await page.goto('/payments');
  await expect(page.getByRole('button', { name: 'Ver detalle de Vendedor 001', exact: true })).toBeVisible();
  return { reads, mutations, unexpected };
}

const sellerCards = (page: Page) => page.getByRole('button', { name: /^Ver detalle de Vendedor / });
const selected = (page: Page, sellers: number, shipments: number) =>
  page.getByText(`${sellers} vendedores · ${shipments} envíos seleccionados`, { exact: true });
const next = (page: Page) => page.getByRole('button', { name: 'Página siguiente de vendedores', exact: true });
const previous = (page: Page) => page.getByRole('button', { name: 'Página anterior de vendedores', exact: true });

test('renders real Payments pages as 20/20/5 complete seller groups', async ({ page, context, baseURL }, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  await expect(sellerCards(page)).toHaveCount(20);
  await expect(page.getByRole('navigation', { name: 'Paginación de vendedores' })).toContainText('Página 1 de 3');
  await expect(previous(page)).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('page-1-20-sellers.png'), fullPage: true });
  await next(page).click();
  await expect(page.getByRole('button', { name: 'Ver detalle de Vendedor 021', exact: true })).toBeVisible();
  await expect(sellerCards(page)).toHaveCount(20);
  await page.screenshot({ path: testInfo.outputPath('page-2-20-sellers.png'), fullPage: true });
  await next(page).click();
  await expect(page.getByRole('button', { name: 'Ver detalle de Vendedor 041', exact: true })).toBeVisible();
  await expect(sellerCards(page)).toHaveCount(5);
  await expect(next(page)).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('page-3-5-sellers.png'), fullPage: true });
  expect(audit.reads.filter((read) => read.scope === 'page').map((read) => read.page)).toEqual([0, 1, 2]);
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('selects all 45 unloaded groups, retains selection and supports deselection/clear', async ({ page, context, baseURL }, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  await page.getByRole('button', { name: 'Seleccionar todos los elegibles', exact: true }).click();
  await expect(selected(page, 45, 90)).toBeVisible();
  expect(audit.reads.some((read) => read.scope === 'page' && read.page > 0)).toBe(false);
  expect(audit.reads.some((read) => read.scope === 'selection' && read.groups === 45)).toBe(true);
  await selected(page, 45, 90).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('all-45-selected.png'), fullPage: true });
  await next(page).click();
  await expect(page.getByRole('button', { name: 'Ver detalle de Vendedor 021', exact: true })).toBeVisible();
  await expect(selected(page, 45, 90)).toBeVisible();
  await page.getByRole('button', { name: 'Ver detalle de Vendedor 021', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /^Seleccionar envío shipment-21-/ })).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Seleccionar envío shipment-21-1', exact: true }).uncheck();
  await expect(selected(page, 45, 89)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Seleccionar envío shipment-21-2', exact: true }).uncheck();
  await expect(selected(page, 44, 88)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await previous(page).click();
  await expect(page.getByRole('button', { name: 'Ver detalle de Vendedor 001', exact: true })).toBeVisible();
  await expect(selected(page, 44, 88)).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar selección', exact: true }).click();
  await expect(selected(page, 0, 0)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Liberar', exact: true })).toBeDisabled();
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('search resets page and selection and keeps the active query scope', async ({ page, context, baseURL }) => {
  const audit = await openPayments(page, context, baseURL!);
  await page.getByRole('button', { name: 'Seleccionar todos los elegibles', exact: true }).click();
  await expect(selected(page, 45, 90)).toBeVisible();
  await next(page).click();
  await expect(page.getByRole('button', { name: 'Ver detalle de Vendedor 021', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar vendedor en dispersiones', exact: true }).fill('Vendedor 04');
  await expect(sellerCards(page)).toHaveCount(6);
  await expect(selected(page, 0, 0)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Paginación de vendedores' })).toContainText('Página 1 de 1');
  await page.getByRole('button', { name: 'Seleccionar todos los elegibles', exact: true }).click();
  await expect(selected(page, 6, 12)).toBeVisible();
  expect(audit.reads.some((read) => read.scope === 'selection' && read.search === 'Vendedor 04' && read.groups === 6)).toBe(true);
  await page.getByRole('button', { name: 'Limpiar búsqueda', exact: true }).click();
  await expect(sellerCards(page)).toHaveCount(20);
  await expect(selected(page, 0, 0)).toBeVisible();
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('failed complete selection cannot install a partial selection', async ({ page, context, baseURL }) => {
  const audit = await openPayments(page, context, baseURL!, true);
  await page.getByRole('button', { name: 'Seleccionar todos los elegibles', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(selected(page, 0, 0)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Liberar', exact: true })).toBeDisabled();
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('labels the current query time and counter units without claiming Stripe freshness', async ({ page, context, baseURL }, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  await page.getByRole('searchbox', { name: 'Buscar vendedor en dispersiones', exact: true }).fill('Vendedor 045');
  await expect(sellerCards(page)).toHaveCount(1);
  await expect(page.getByText('Última consulta exitosa de esta página:', { exact: false })).toBeVisible();
  const timestamp = await page.locator('time[datetime]').getAttribute('datetime');
  expect(Number.isFinite(Date.parse(timestamp!))).toBe(true);
  await expect(page.getByText('No indica sincronización con Stripe.', { exact: false })).toBeVisible();
  const counterScope = page.getByText('Contadores de la consulta actual, no totales globales:', { exact: false });
  await expect(counterScope).toContainText('vendedores en Por liberar; ejecuciones en las demás pestañas.');
  await counterScope.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('query-status-and-count-units.png'), fullPage: true });
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('financial requests are denied before any connection, even when explicitly attempted', async ({ page, context, baseURL }) => {
  const audit = await openPayments(page, context, baseURL!);
  const result = await page.evaluate(async (url) => {
    try { await fetch(url, { method: 'POST' }); return 'unexpected-success'; }
    catch { return 'blocked'; }
  }, `${mockOrigin}/functions/v1/release-connect-payout`);
  expect(result).toBe('blocked');
  expect(audit.mutations).toEqual(['POST /functions/v1/release-connect-payout']);
  expect(audit.unexpected).toEqual([]);
});

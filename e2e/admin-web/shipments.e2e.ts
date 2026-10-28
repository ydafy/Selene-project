import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const mockOrigin = 'https://payments-e2e.invalid';
const userId = '00000000-0000-4000-8000-000000000001';
const listPath = '/functions/v1/list-shipment-operation-reviews';
const resolvePath = '/functions/v1/resolve-shipment-operation-review';
const lateListPath = '/functions/v1/list-shipment-late-carrier-activity';
const acknowledgePath = '/functions/v1/acknowledge-shipment-late-carrier-activity';

const review = (n: number, overrides: Record<string, unknown> = {}) => ({
  shipment_id: `1111111${n}-aaaa-4bbb-8ccc-000000000001`,
  order_id: `2222222${n}-aaaa-4bbb-8ccc-000000000001`,
  seller_id: `3333333${n}-aaaa-4bbb-8ccc-000000000001`,
  tracking_number: `TRK-00${n}`,
  carrier: 'fedex',
  label_provider_cost_cents: 123456,
  review_reason: 'carrier_refused',
  carrier_cancellation_outcome: 'refused',
  review_required_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

const lateCase = (n: number, overrides: Record<string, unknown> = {}) => ({
  shipment_id: `4444444${n}-aaaa-4bbb-8ccc-000000000001`,
  order_id: `5555555${n}-aaaa-4bbb-8ccc-000000000001`,
  seller_id: `6666666${n}-aaaa-4bbb-8ccc-000000000001`,
  tracking_number: `LATE-00${n}`,
  carrier: 'estafeta',
  shipment_status: 'cancelled',
  source: 'preparing_timeout',
  refund_status: 'succeeded',
  late_carrier_activity_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  late_carrier_activity_event_type: 'delivered',
  ...overrides,
});

interface Mock {
  pending: Array<ReturnType<typeof review>>;
  resolveStatus: number;
  resolveBodies: unknown[];
  unexpected: string[];
  late?: Array<ReturnType<typeof lateCase>>;
  lateListStatus?: number;
  acknowledgeStatus?: number;
  acknowledgeBodies?: unknown[];
}

// Deny-by-default boundary installed BEFORE navigation or session setup.
async function openShipments(page: Page, context: BrowserContext, baseURL: string, mock: Mock) {
  const cors = {
    'access-control-allow-origin': baseURL,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json',
  };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === baseURL && request.method() === 'GET') {
      await route.continue();
      return;
    }
    const isMock = url.origin === mockOrigin;
    if (isMock && request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (isMock && request.method() === 'GET' && url.pathname === '/rest/v1/admin_user_directory_view') {
      await route.fulfill({ headers: cors, json: {
        id: userId, role: 'admin', username: 'Browser fixture', email: 'fixture@example.invalid',
        avatar_url: null, status: 'active', is_verified_seller: false,
        created_at: '2026-01-01T00:00:00.000Z', available_balance: 0, pending_balance: 0,
      } });
      return;
    }
    if (isMock && url.pathname === listPath) {
      await route.fulfill({ headers: cors, json: { reviews: mock.pending } });
      return;
    }
    if (isMock && url.pathname === lateListPath) {
      if (mock.lateListStatus && mock.lateListStatus !== 200) {
        await route.fulfill({ status: mock.lateListStatus, headers: cors, json: { error: 'INTERNAL_ERROR' } });
        return;
      }
      await route.fulfill({ headers: cors, json: { late_carrier_activity: mock.late ?? [] } });
      return;
    }
    if (isMock && request.method() === 'POST' && url.pathname === acknowledgePath) {
      const body = request.postDataJSON() as { shipment_id: string; note: string };
      mock.acknowledgeBodies?.push(body);
      if (mock.acknowledgeStatus && mock.acknowledgeStatus !== 200) {
        await route.fulfill({ status: mock.acknowledgeStatus, headers: cors, json: { error: 'LATE_CARRIER_ACTIVITY_NOT_FOUND' } });
        return;
      }
      mock.late = (mock.late ?? []).filter((item) => item.shipment_id !== body.shipment_id);
      await route.fulfill({ headers: cors, json: {
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userId,
        acknowledged_note: body.note,
        already_acknowledged: false,
      } });
      return;
    }
    if (isMock && request.method() === 'POST' && url.pathname === resolvePath) {
      const body = request.postDataJSON() as { shipment_id: string; resolution: string; note: string };
      mock.resolveBodies.push(body);
      if (mock.resolveStatus !== 200) {
        await route.fulfill({ status: mock.resolveStatus, headers: cors, json: { error: 'CARRIER_REVIEW_NOT_PENDING' } });
        return;
      }
      mock.pending = mock.pending.filter((item) => item.shipment_id !== body.shipment_id);
      await route.fulfill({ headers: cors, json: {
        review_resolution: body.resolution,
        review_resolved_at: new Date().toISOString(),
        review_resolved_by: userId,
        review_resolution_note: body.note,
        label_cost_loss_cents: null,
      } });
      return;
    }
    // Google Fonts is intentionally unavailable offline; every other unmocked
    // request is also denied and is surfaced as a test failure.
    if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
      mock.unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
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
  await page.goto('/shipments');
}

test('Envíos lists carrier cancellations under an active sidebar entry and a closed review leaves the list', async ({ page, context, baseURL }) => {
  const mock: Mock = {
    pending: [review(1), review(2, { review_reason: 'tracking_unknown', tracking_number: null, label_provider_cost_cents: null })],
    resolveStatus: 200,
    resolveBodies: [],
    unexpected: [],
  };
  await openShipments(page, context, baseURL!, mock);

  const nav = page.getByRole('button', { name: 'Envíos', exact: true });
  await expect(nav).toBeVisible();
  await expect(nav).toHaveClass(/bg-lion/);
  await expect(page.getByRole('heading', { name: 'Envíos', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cancelaciones con el carrier' })).toBeVisible();

  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(2);
  const refused = cards.filter({ hasText: 'TRK-001' });
  await expect(refused).toContainText('El carrier rechazó la cancelación');
  await expect(refused).toContainText('1,234.56');
  await expect(refused).toContainText('Esperando: 3 h');
  const unknown = cards.filter({ hasText: 'No pudimos confirmar el tracking' });
  await expect(unknown).toContainText('Sin tracking');
  await expect(unknown).toContainText('Sin dato');

  await refused.getByRole('button', { name: 'Cerrar sin reembolso' }).click();
  await expect(page.getByText('no se reembolsará', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(page.getByRole('alert')).toContainText('nota');
  expect(mock.resolveBodies).toEqual([]);

  await page.getByLabel('Nota para el registro').fill('  Paquete en tránsito  ');
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();

  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('No pudimos confirmar el tracking');
  expect(mock.resolveBodies).toEqual([
    { shipment_id: review(1).shipment_id, resolution: 'closed_no_refund', note: 'Paquete en tránsito' },
  ]);
  expect(mock.unexpected).toEqual([]);
});

test('a stale review shows the mapped Spanish error and keeps the confirmation open', async ({ page, context, baseURL }) => {
  const mock: Mock = { pending: [review(1)], resolveStatus: 409, resolveBodies: [], unexpected: [] };
  await openShipments(page, context, baseURL!, mock);

  await page.getByRole('button', { name: 'Reembolsar al comprador' }).click();
  await expect(page.getByText('próximo ciclo automático', { exact: false })).toBeVisible();
  await page.getByLabel('Nota para el registro').fill('Aprobado');
  await page.getByRole('button', { name: 'Confirmar reembolso' }).click();

  await expect(page.getByRole('alert')).toContainText('Esta revisión ya no está pendiente');
  await expect(page.getByLabel('Nota para el registro')).toHaveValue('Aprobado');
  expect(mock.resolveBodies).toEqual([
    { shipment_id: review(1).shipment_id, resolution: 'refund_approved', note: 'Aprobado' },
  ]);
  expect(mock.unexpected).toEqual([]);
});

test('Envíos lists carrier activity after the cancellation refund started and a reviewed case leaves the list', async ({ page, context, baseURL }) => {
  const mock: Mock = {
    pending: [],
    resolveStatus: 200,
    resolveBodies: [],
    unexpected: [],
    late: [lateCase(1), lateCase(2, { tracking_number: null, carrier: null, refund_status: null, late_carrier_activity_event_type: 'in_transit' })],
    acknowledgeBodies: [],
  };
  await openShipments(page, context, baseURL!, mock);

  await expect(page.getByRole('heading', { name: 'Paquetes que se movieron después de cancelar' })).toBeVisible();
  await expect(page.getByTestId('late-carrier-activity-count')).toHaveText('2');
  await expect(page.getByText('ya iniciamos el reembolso al comprador', { exact: false })).toBeVisible();

  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(2);
  const delivered = cards.filter({ hasText: 'LATE-001' });
  await expect(delivered).toContainText('Entregado');
  await expect(delivered).toContainText('estafeta');
  await expect(delivered).toContainText('Cancelado');
  await expect(delivered).toContainText('Reembolsado');
  await expect(delivered).toContainText('Hace 2 h');
  const sparse = cards.filter({ hasText: 'En tránsito' });
  await expect(sparse).toContainText('Sin tracking');
  await expect(sparse).toContainText('Sin dato');

  await delivered.getByRole('button', { name: 'Marcar revisado' }).click();
  await page.getByRole('button', { name: 'Confirmar revisión' }).click();
  await expect(page.getByRole('alert')).toContainText('nota');
  expect(mock.acknowledgeBodies).toEqual([]);

  await page.getByLabel('Nota para el registro').fill('  Hablé con el vendedor  ');
  await page.getByRole('button', { name: 'Confirmar revisión' }).click();

  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('En tránsito');
  await expect(page.getByTestId('late-carrier-activity-count')).toHaveText('1');
  expect(mock.acknowledgeBodies).toEqual([
    { shipment_id: lateCase(1).shipment_id, note: 'Hablé con el vendedor' },
  ]);
  expect(mock.unexpected).toEqual([]);
});

test('a case that is gone shows the mapped Spanish error and keeps the form open', async ({ page, context, baseURL }) => {
  const mock: Mock = {
    pending: [], resolveStatus: 200, resolveBodies: [], unexpected: [],
    late: [lateCase(1)], acknowledgeStatus: 404, acknowledgeBodies: [],
  };
  await openShipments(page, context, baseURL!, mock);

  await page.getByRole('button', { name: 'Marcar revisado' }).click();
  await page.getByLabel('Nota para el registro').fill('Revisado');
  await page.getByRole('button', { name: 'Confirmar revisión' }).click();

  await expect(page.getByRole('alert')).toContainText('Este caso ya no está en la lista');
  await expect(page.getByLabel('Nota para el registro')).toHaveValue('Revisado');
  expect(mock.acknowledgeBodies).toEqual([{ shipment_id: lateCase(1).shipment_id, note: 'Revisado' }]);
  expect(mock.unexpected).toEqual([]);
});

test('the carrier activity bucket shows a dash and an error, never an empty state, when the list fails', async ({ page, context, baseURL }) => {
  const mock: Mock = { pending: [], resolveStatus: 200, resolveBodies: [], unexpected: [], lateListStatus: 500 };
  await openShipments(page, context, baseURL!, mock);

  await expect(page.getByText('Error al cargar la actividad del carrier')).toBeVisible();
  await expect(page.getByTestId('late-carrier-activity-count')).toHaveText('—');
  await expect(page.getByText('Ningún caso pendiente')).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test('the carrier activity bucket shows its empty state with a zero count', async ({ page, context, baseURL }) => {
  const mock: Mock = { pending: [], resolveStatus: 200, resolveBodies: [], unexpected: [], late: [] };
  await openShipments(page, context, baseURL!, mock);

  await expect(page.getByText('Ningún caso pendiente')).toBeVisible();
  await expect(page.getByTestId('late-carrier-activity-count')).toHaveText('0');
  expect(mock.unexpected).toEqual([]);
});

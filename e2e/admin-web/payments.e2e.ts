import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ConnectPayoutReleaseQueueRow } from '../../packages/types/src/index';

const mockOrigin = 'https://payments-e2e.invalid';
const userId = '00000000-0000-4000-8000-000000000001';
const sellerName = (index: number) =>
  `Vendedor ${String(index).padStart(3, '0')}`;

// Two shipments per seller ensure pages count complete groups, not raw rows.
// Vendedor 001's Stripe account has payouts disabled; the account gate does not
// change eligibility, so its shipments stay selectable.
const rows: ConnectPayoutReleaseQueueRow[] = Array.from(
  { length: 45 },
  (_, i) =>
    [1, 2].map((shipment) => ({
      completed_at: '2026-01-01T12:00:00.000Z',
      days_since_completed: i === 0 ? (shipment === 1 ? 5 : 1) : 3,
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
      seller_payout_block_reason: i === 0 ? 'payouts_disabled' : null,
      is_payout_overdue: false,
      latest_hold_note: null,
      latest_hold_noted_at: null,
      latest_hold_noted_by: null,
      shipment_id: `shipment-${i + 1}-${shipment}`,
      status: 'completed' as const,
      stripe_account_id: `acct_fake_${i + 1}`,
      stripe_onboarding_status: 'complete' as const,
      stripe_payment_intent_id: `pi_fake_${i + 1}`,
      stripe_transfer_id: null,
      transfer_group: null,
    })),
).flat();

// Overdue held payouts (#549): Vendedor 046's account was rejected by Stripe, so
// only its shipment offers the refund; Vendedor 047's payouts are disabled and it
// already has a hold note.
const overdueRow = (
  seller: number,
  reason: string,
  note: string | null,
): ConnectPayoutReleaseQueueRow => ({
  ...rows[0],
  completed_at: '2026-10-01T12:00:00.000Z',
  days_since_completed: seller === 46 ? 44 : 31,
  ineligible_reason: 'seller_onboarding_incomplete',
  is_eligible: false,
  order_id: `order-${seller}-1`,
  release_amount_cents: seller === 46 ? 251000 : 98000,
  seller_id: `seller-${seller}`,
  seller_name: sellerName(seller),
  seller_payout_block_reason: reason,
  is_payout_overdue: true,
  latest_hold_note: note,
  latest_hold_noted_at: note ? '2026-11-10T15:00:00.000Z' : null,
  latest_hold_noted_by: note ? userId : null,
  shipment_id: `shipment-${seller}-1`,
  stripe_onboarding_status: seller === 46 ? 'rejected' : 'complete',
});
const overdueRows = () => [
  overdueRow(46, 'onboarding_rejected', null),
  overdueRow(47, 'payouts_disabled', 'Stripe sigue revisando la cuenta.'),
];

type StubbedAnswer = { status: number; json: Record<string, unknown> };
interface OverdueStub {
  holdNote?: (body: Record<string, unknown>) => StubbedAnswer;
  refund?: (body: Record<string, unknown>) => StubbedAnswer;
}
const OVERDUE_ACTIONS = {
  '/functions/v1/record-payout-hold-note': 'holdNote',
  '/functions/v1/refund-overdue-payout': 'refund',
} as const;

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
  overdue: OverdueStub = {},
) {
  const reads: QueueRead[] = [];
  const mutations: string[] = [];
  const unexpected: string[] = [];
  const actions: Array<{ path: string; body: Record<string, unknown> }> = [];
  const overdueQueue = overdueRows();
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
    const action =
      url.origin === mockOrigin
        ? OVERDUE_ACTIONS[url.pathname as keyof typeof OVERDUE_ACTIONS]
        : undefined;
    const answer = action ? overdue[action] : undefined;
    if (answer && request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (answer && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      actions.push({ path: url.pathname, body });
      const { status, json } = answer(body);
      if (action === 'holdNote' && status === 200) {
        const row = overdueQueue.find(
          (r) => r.shipment_id === body.shipment_id,
        );
        if (row) {
          row.latest_hold_note = String(json.note);
          row.latest_hold_noted_at = String(json.noted_at);
          row.latest_hold_noted_by = String(json.noted_by);
        }
      }
      if (action === 'refund' && status === 200) {
        overdueQueue.splice(
          overdueQueue.findIndex((r) => r.shipment_id === body.shipment_id),
          1,
        );
      }
      await route.fulfill({ status, headers: cors, json });
      return;
    }
    if (
      url.pathname.startsWith('/functions/v1/') &&
      url.pathname !== '/functions/v1/get-connect-payout-release-queue'
    ) {
      mutations.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.origin === baseURL && request.method() === 'GET') {
      await route.continue();
      return;
    }
    const profileRead =
      url.origin === mockOrigin &&
      request.method() === 'GET' &&
      url.pathname === '/rest/v1/admin_user_directory_view';
    const queueRead =
      url.origin === mockOrigin &&
      request.method() === 'POST' &&
      url.pathname === '/functions/v1/get-connect-payout-release-queue';
    if (
      url.origin === mockOrigin &&
      request.method() === 'OPTIONS' &&
      [
        '/rest/v1/admin_user_directory_view',
        '/functions/v1/get-connect-payout-release-queue',
      ].includes(url.pathname)
    ) {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (profileRead) {
      await route.fulfill({
        headers: cors,
        json: {
          id: userId,
          role: 'admin',
          username: 'Browser fixture',
          email: 'fixture@example.invalid',
          avatar_url: null,
          status: 'active',
          is_verified_seller: false,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      });
      return;
    }
    if (queueRead) {
      const body = request.postDataJSON() as {
        bucket: string;
        scope: string;
        page: number;
        search?: string;
      };
      const search = (body.search ?? '').trim();
      const matched = rows.filter((row) =>
        row.seller_name!.toLowerCase().includes(search.toLowerCase()),
      );
      const matchingIds = [...new Set(matched.map((row) => row.seller_id))];
      const overdueMatched = overdueQueue.filter((row) =>
        row.seller_name!.toLowerCase().includes(search.toLowerCase()),
      );
      const overdueIds = [
        ...new Set(overdueMatched.map((row) => row.seller_id)),
      ];
      const groups =
        body.bucket === 'ready'
          ? matchingIds.length
          : body.bucket === 'overdue'
            ? overdueIds.length
            : 0;
      const totalPages = Math.max(1, Math.ceil(groups / 20));
      const currentPage =
        body.scope === 'selection' ? 0 : Math.min(body.page, totalPages - 1);
      const chosenIds =
        body.scope === 'selection'
          ? matchingIds
          : matchingIds.slice(currentPage * 20, (currentPage + 1) * 20);
      reads.push({
        bucket: body.bucket,
        page: body.page,
        scope: body.scope,
        search,
        groups,
      });
      if (failSelection && body.scope === 'selection') {
        await route.fulfill({
          status: 502,
          headers: cors,
          json: { success: false, error: 'SIMULATED_SELECTION_FAILURE' },
        });
        return;
      }
      await route.fulfill({
        headers: cors,
        json: {
          success: true,
          rows:
            body.bucket === 'ready'
              ? matched.filter((row) => chosenIds.includes(row.seller_id))
              : body.bucket === 'overdue'
                ? overdueMatched
                : [],
          counts: {
            ready: matchingIds.length,
            overdue: overdueIds.length,
            processing: 0,
            'action-required': 0,
            history: 0,
          },
          bucket: body.bucket,
          scope: body.scope,
          page: currentPage,
          pageSize: 20,
          totalGroups: groups,
          totalPages,
          selectedGroupCount: body.scope === 'selection' ? groups : 0,
          selectionComplete: body.scope === 'selection',
        },
      });
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
  await context.addInitScript(
    ({ userId, token, expiresAt }) => {
      // SupabaseClient derives this project-specific key from its configured host.
      localStorage.setItem(
        'sb-payments-e2e-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'fake-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: expiresAt,
          user: {
            id: userId,
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
    { userId, token, expiresAt },
  );
  await page.goto('/payments');
  await expect(
    page.getByRole('button', {
      name: 'Ver detalle de Vendedor 001',
      exact: true,
    }),
  ).toBeVisible();
  return { reads, mutations, unexpected, actions };
}

const sellerCards = (page: Page) =>
  page.getByRole('button', { name: /^Ver detalle de Vendedor / });
const selected = (page: Page, sellers: number, shipments: number) =>
  page.getByText(`${sellers} vendedores · ${shipments} envíos seleccionados`, {
    exact: true,
  });
const next = (page: Page) =>
  page.getByRole('button', {
    name: 'Página siguiente de vendedores',
    exact: true,
  });
const previous = (page: Page) =>
  page.getByRole('button', {
    name: 'Página anterior de vendedores',
    exact: true,
  });

test('renders real Payments pages as 20/20/5 complete seller groups', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  await expect(sellerCards(page)).toHaveCount(20);
  await expect(
    page.getByRole('navigation', { name: 'Paginación de vendedores' }),
  ).toContainText('Página 1 de 3');
  await expect(previous(page)).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('page-1-20-sellers.png'),
    fullPage: true,
  });
  await next(page).click();
  await expect(
    page.getByRole('button', {
      name: 'Ver detalle de Vendedor 021',
      exact: true,
    }),
  ).toBeVisible();
  await expect(sellerCards(page)).toHaveCount(20);
  await page.screenshot({
    path: testInfo.outputPath('page-2-20-sellers.png'),
    fullPage: true,
  });
  await next(page).click();
  await expect(
    page.getByRole('button', {
      name: 'Ver detalle de Vendedor 041',
      exact: true,
    }),
  ).toBeVisible();
  await expect(sellerCards(page)).toHaveCount(5);
  await expect(next(page)).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('page-3-5-sellers.png'),
    fullPage: true,
  });
  expect(
    audit.reads
      .filter((read) => read.scope === 'page')
      .map((read) => read.page),
  ).toEqual([0, 1, 2]);
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('selects all 45 unloaded groups, retains selection and supports deselection/clear', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  await page
    .getByRole('button', {
      name: 'Seleccionar todos los elegibles',
      exact: true,
    })
    .click();
  await expect(selected(page, 45, 90)).toBeVisible();
  expect(
    audit.reads.some((read) => read.scope === 'page' && read.page > 0),
  ).toBe(false);
  expect(
    audit.reads.some(
      (read) => read.scope === 'selection' && read.groups === 45,
    ),
  ).toBe(true);
  await selected(page, 45, 90).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('all-45-selected.png'),
    fullPage: true,
  });
  await next(page).click();
  await expect(
    page.getByRole('button', {
      name: 'Ver detalle de Vendedor 021',
      exact: true,
    }),
  ).toBeVisible();
  await expect(selected(page, 45, 90)).toBeVisible();
  await page
    .getByRole('button', { name: 'Ver detalle de Vendedor 021', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /^Seleccionar envío shipment-21-/ }),
  ).toHaveCount(2);
  await page
    .getByRole('checkbox', {
      name: 'Seleccionar envío shipment-21-1',
      exact: true,
    })
    .uncheck();
  await expect(selected(page, 45, 89)).toBeVisible();
  await page
    .getByRole('checkbox', {
      name: 'Seleccionar envío shipment-21-2',
      exact: true,
    })
    .uncheck();
  await expect(selected(page, 44, 88)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await previous(page).click();
  await expect(
    page.getByRole('button', {
      name: 'Ver detalle de Vendedor 001',
      exact: true,
    }),
  ).toBeVisible();
  await expect(selected(page, 44, 88)).toBeVisible();
  await page
    .getByRole('button', { name: 'Limpiar selección', exact: true })
    .click();
  await expect(selected(page, 0, 0)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Liberar', exact: true }),
  ).toBeDisabled();
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('search resets page and selection and keeps the active query scope', async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await openPayments(page, context, baseURL!);
  await page
    .getByRole('button', {
      name: 'Seleccionar todos los elegibles',
      exact: true,
    })
    .click();
  await expect(selected(page, 45, 90)).toBeVisible();
  await next(page).click();
  await expect(
    page.getByRole('button', {
      name: 'Ver detalle de Vendedor 021',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('searchbox', {
      name: 'Buscar vendedor en dispersiones',
      exact: true,
    })
    .fill('Vendedor 04');
  await expect(sellerCards(page)).toHaveCount(6);
  await expect(selected(page, 0, 0)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Paginación de vendedores' }),
  ).toContainText('Página 1 de 1');
  await page
    .getByRole('button', {
      name: 'Seleccionar todos los elegibles',
      exact: true,
    })
    .click();
  await expect(selected(page, 6, 12)).toBeVisible();
  expect(
    audit.reads.some(
      (read) =>
        read.scope === 'selection' &&
        read.search === 'Vendedor 04' &&
        read.groups === 6,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Limpiar búsqueda', exact: true })
    .click();
  await expect(sellerCards(page)).toHaveCount(20);
  await expect(selected(page, 0, 0)).toBeVisible();
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('failed complete selection cannot install a partial selection', async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await openPayments(page, context, baseURL!, true);
  await page
    .getByRole('button', {
      name: 'Seleccionar todos los elegibles',
      exact: true,
    })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(selected(page, 0, 0)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Liberar', exact: true }),
  ).toBeDisabled();
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('labels the current query time and counter units without claiming Stripe freshness', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  await page
    .getByRole('searchbox', {
      name: 'Buscar vendedor en dispersiones',
      exact: true,
    })
    .fill('Vendedor 045');
  await expect(sellerCards(page)).toHaveCount(1);
  await expect(
    page.getByText('Última consulta exitosa de esta página:', { exact: false }),
  ).toBeVisible();
  const timestamp = await page
    .locator('time[datetime]')
    .getAttribute('datetime');
  expect(Number.isFinite(Date.parse(timestamp!))).toBe(true);
  await expect(
    page.getByText('No indica sincronización con Stripe.', { exact: false }),
  ).toBeVisible();
  const counterScope = page.getByText(
    'Contadores de la consulta actual, no totales globales:',
    { exact: false },
  );
  await expect(counterScope).toContainText(
    'vendedores en Por liberar y Pagos vencidos; ejecuciones en las demás pestañas.',
  );
  await counterScope.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('query-status-and-count-units.png'),
    fullPage: true,
  });
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('financial requests are denied before any connection, even when explicitly attempted', async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await openPayments(page, context, baseURL!);
  const result = await page.evaluate(async (url) => {
    try {
      await fetch(url, { method: 'POST' });
      return 'unexpected-success';
    } catch {
      return 'blocked';
    }
  }, `${mockOrigin}/functions/v1/release-connect-payout`);
  expect(result).toBe('blocked');
  expect(audit.mutations).toEqual([
    'POST /functions/v1/release-connect-payout',
  ]);
  expect(audit.unexpected).toEqual([]);
});

test('shows why a seller cannot be paid and how long each payout is held', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  const blockedSeller = page.getByRole('button', {
    name: 'Ver detalle de Vendedor 001',
    exact: true,
  });
  await expect(blockedSeller).toContainText('Stripe deshabilitó los pagos');
  await expect(
    page.getByRole('button', {
      name: 'Ver detalle de Vendedor 002',
      exact: true,
    }),
  ).not.toContainText('Stripe deshabilitó los pagos');
  await blockedSeller.click();
  const detail = page.getByRole('region', { name: 'Detalle de liberación' });
  await expect(detail).toBeVisible();
  await expect(
    detail.getByText('Cuenta del vendedor: Stripe deshabilitó los pagos'),
  ).toHaveCount(2);
  await expect(
    detail.locator('code', { hasText: 'payouts_disabled' }),
  ).toHaveCount(2);
  await expect(
    detail.getByText('Retenido hace 5 días', { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText('Retenido hace 1 día', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('seller-block-reason-and-days-held.png'),
    fullPage: true,
  });
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

const overdueTab = (page: Page) =>
  page.getByRole('tab', { name: /Pagos vencidos/ });
const overdueCard = (page: Page, seller: number) =>
  page.getByRole('article', {
    name: new RegExp(`^Pago vencido de @Vendedor 0${seller},`),
  });
const refunded = (shipmentId: string) => ({
  status: 200,
  json: {
    status: 'refunded',
    shipment_id: shipmentId,
    refund_id: 're_e2e',
    amount_cents: 10600,
  },
});

test('shows overdue held payouts apart, with reason, days, amount and latest note', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!);
  await expect(
    page.getByRole('button', { name: 'Ver detalle de Vendedor 046' }),
  ).toHaveCount(0);
  await expect(overdueTab(page)).toContainText('2');
  await overdueTab(page).click();
  await expect(
    page.getByRole('heading', { name: 'Pagos vencidos', exact: true }),
  ).toBeVisible();
  const rejected = overdueCard(page, 46);
  await expect(rejected).toContainText('@Vendedor 046');
  await expect(rejected).toContainText(
    'Stripe rechazó el registro del vendedor',
  );
  await expect(rejected).toContainText('Retenido hace 44 días');
  await expect(rejected).toContainText('$2,510');
  await expect(rejected).toContainText('Sin notas todavía');
  await expect(
    rejected.getByRole('button', { name: 'Reembolsar al comprador' }),
  ).toBeVisible();
  const disabled = overdueCard(page, 47);
  await expect(disabled).toContainText('Stripe deshabilitó los pagos');
  await expect(disabled).toContainText('Stripe sigue revisando la cuenta.');
  await expect(disabled).toContainText('Retenido hace 31 días');
  // The refund is offered only when Stripe rejected the account.
  await expect(
    disabled.getByRole('button', { name: 'Reembolsar al comprador' }),
  ).toHaveCount(0);
  await expect(
    disabled.getByRole('button', { name: 'Seguir reteniendo' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('overdue-section.png'),
    fullPage: true,
  });
  expect(
    audit.reads.some(
      (read) => read.bucket === 'overdue' && read.scope === 'page',
    ),
  ).toBe(true);
  expect(audit.reads.some((read) => read.scope === 'selection')).toBe(false);
  expect(audit.actions).toEqual([]);
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('keeps holding with a required note and shows it after the refresh', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!, false, {
    holdNote: (body) => ({
      status: 200,
      json: {
        id: '9c000000-0000-4000-8000-000000000001',
        shipment_id: body.shipment_id,
        note: body.note,
        noted_at: '2026-11-14T18:00:00.000Z',
        noted_by: userId,
      },
    }),
  });
  await overdueTab(page).click();
  await overdueCard(page, 46)
    .getByRole('button', { name: 'Seguir reteniendo' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Seguir reteniendo el pago',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('0/1000');
  await dialog.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Escribe una nota de entre 1 y 1000 caracteres.',
  );
  const noteField = dialog.getByLabel('Nota para seguir reteniendo');
  await expect(noteField).toHaveAttribute('aria-invalid', 'true');
  await expect(noteField).toBeFocused();
  expect(audit.actions).toEqual([]);
  await noteField.fill('  Esperamos la revisión de Stripe.  ');
  await expect(noteField).not.toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('32/1000');
  await page.screenshot({
    path: testInfo.outputPath('hold-note-dialog.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(overdueCard(page, 46)).toContainText(
    'Esperamos la revisión de Stripe.',
  );
  expect(audit.actions).toEqual([
    {
      path: '/functions/v1/record-payout-hold-note',
      body: {
        shipment_id: 'shipment-46-1',
        note: 'Esperamos la revisión de Stripe.',
      },
    },
  ]);
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('explains a refused hold note and keeps the dialog open', async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await openPayments(page, context, baseURL!, false, {
    holdNote: () => ({ status: 409, json: { error: 'PAYOUT_NOT_OVERDUE' } }),
  });
  await overdueTab(page).click();
  await overdueCard(page, 47)
    .getByRole('button', { name: 'Seguir reteniendo' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Seguir reteniendo el pago',
  });
  await dialog.getByLabel('Nota para seguir reteniendo').fill('Nota');
  await dialog.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Este pago ya no está vencido',
  );
  expect(audit.actions).toHaveLength(1);
  expect(audit.mutations).toEqual([]);
});

test('refunds the buyer of a rejected seller once, sending only the shipment id', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!, false, {
    refund: (body) => refunded(String(body.shipment_id)),
  });
  await overdueTab(page).click();
  await overdueCard(page, 46)
    .getByRole('button', { name: 'Reembolsar al comprador' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Reembolsar al comprador' });
  await expect(dialog).toContainText('lo que pagó por este envío');
  await expect(dialog).toContainText(
    'Selene absorbe el envío que ya pagó y la comisión de Stripe.',
  );
  await expect(dialog).toContainText('No se puede deshacer.');
  await expect(dialog).toContainText('El servidor calcula el monto');
  await page.screenshot({
    path: testInfo.outputPath('refund-confirmation.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Confirmar reembolso' }).dblclick();
  await expect(dialog.getByRole('status')).toContainText(
    'Reembolso hecho: $106 MXN',
  );
  await expect(
    dialog.getByRole('button', { name: 'Confirmar reembolso' }),
  ).toHaveCount(0);
  expect(audit.actions).toEqual([
    {
      path: '/functions/v1/refund-overdue-payout',
      body: { shipment_id: 'shipment-46-1' },
    },
  ]);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(overdueCard(page, 46)).toHaveCount(0);
  await expect(overdueTab(page)).toContainText('1');
  expect(audit.mutations).toEqual([]);
  expect(audit.unexpected).toEqual([]);
});

test('shows a 202 refund as pending in Stripe', async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await openPayments(page, context, baseURL!, false, {
    refund: (body) => ({
      ...refunded(String(body.shipment_id)),
      status: 202,
      json: { ...refunded(String(body.shipment_id)).json, status: 'pending' },
    }),
  });
  await overdueTab(page).click();
  await overdueCard(page, 46)
    .getByRole('button', { name: 'Reembolsar al comprador' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Reembolsar al comprador' });
  await dialog.getByRole('button', { name: 'Confirmar reembolso' }).click();
  await expect(dialog.getByRole('status')).toContainText('pendiente en Stripe');
  await expect(dialog).not.toContainText('Reembolso hecho');
  await expect(
    dialog.getByRole('button', { name: 'Confirmar reembolso' }),
  ).toHaveCount(0);
  expect(audit.actions).toHaveLength(1);
  expect(audit.mutations).toEqual([]);
});

test('points a failed Stripe refund to the manual repayment and offers no retry', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const audit = await openPayments(page, context, baseURL!, false, {
    refund: () => ({ status: 409, json: { error: 'REFUND_FAILED' } }),
  });
  await overdueTab(page).click();
  await overdueCard(page, 46)
    .getByRole('button', { name: 'Reembolsar al comprador' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Reembolsar al comprador' });
  await dialog.getByRole('button', { name: 'Confirmar reembolso' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Reembolsos con problemas',
  );
  await expect(
    dialog.getByRole('button', { name: 'Confirmar reembolso' }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('refund-failed.png'),
    fullPage: true,
  });
  expect(audit.actions).toHaveLength(1);
  expect(audit.mutations).toEqual([]);
});

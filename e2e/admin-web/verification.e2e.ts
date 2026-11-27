// Admin verification screen against a mocked backend (odd/tasks/verification-history.md
// S4, S8): the queue reads the open attempts from admin_product_queue_view,
// selecting a listing takes the lock on the attempt it shows, the detail shows the
// previous rejection note and the proofs of the open attempt, and a rejection of
// that attempt goes through fn_resolve_product_verdict.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const mockOrigin = 'https://payments-e2e.invalid';
const adminId = '00000000-0000-4000-8000-000000000001';
const sellerId = '00000000-0000-4000-8000-000000000005';
const productId = '00000000-0000-4000-8000-0000000000a1';
const verificationId = '00000000-0000-4000-8000-0000000000b1';
const productName = 'RTX 3080 Fixture Verificación';
const physicalPath = `${productId}/physical-1.png`;
const performancePath = `${productId}/benchmark-1.png`;
const benchmarkScore = 18234;
const previousNote = 'La foto del papelito no muestra tu usuario completo';
const newNote = 'El benchmark no corresponde al modelo publicado';
// 1x1 PNG so each signed proof URL loads a real image.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const adminProfile = {
  id: adminId,
  role: 'admin',
  username: 'Admin Fixture',
  email: 'fixture@example.invalid',
  avatar_url: null,
  status: 'active',
  is_verified_seller: false,
  created_at: '2026-01-01T00:00:00.000Z',
  sold_count: 0,
  verified_count: 0,
  processed_count: 0,
};
const queueRow = {
  id: productId,
  name: productName,
  price_cents: 1250000,
  category: 'GPU',
  condition: 'Usado - Como nuevo',
  images: [],
  description: 'Tarjeta de video de prueba',
  specifications: {},
  status: 'in_review',
  created_at: '2026-11-20T10:00:00.000Z',
  seller_id: sellerId,
  aspect_ratio: 1,
  views: 0,
  verification_id: verificationId,
  submitted_at: '2026-11-24T10:00:00.000Z',
  benchmark_score: benchmarkScore,
  locked_by: null,
  locked_at: null,
  last_rejection_note: previousNote,
  evidence: [
    { kind: 'performance', storage_path: performancePath },
    { kind: 'physical', storage_path: physicalPath },
  ],
  seller: {
    id: sellerId,
    username: 'vendedor_fixture',
    avatar_url: null,
    is_verified_seller: false,
  },
};

interface Recorded {
  unexpected: string[];
  forbidden: string[];
  queueRequests: URL[];
  lockBodies: unknown[];
  verdictBodies: unknown[];
  signRequests: { path: string; body: unknown }[];
}

// Every backend call is mocked; anything outside the mock origin fails the test.
async function openAdmin(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  path: string,
): Promise<Recorded> {
  const recorded: Recorded = {
    unexpected: [],
    forbidden: [],
    queueRequests: [],
    lockBodies: [],
    verdictBodies: [],
    signRequests: [],
  };
  let decided = false;
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
        recorded.unexpected.push(
          `${request.method()} ${url.origin}${url.pathname}`,
        );
      }
      return route.abort('blockedbyclient');
    }
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors });
    // The verification screen reads attempts from the queue view; the old
    // products columns and the audit log are not its sources any more.
    if (
      url.pathname === '/rest/v1/products' ||
      url.pathname === '/rest/v1/admin_audit_logs'
    ) {
      recorded.forbidden.push(`${request.method()} ${url.pathname}`);
    }
    const single = (await request.headerValue('accept'))?.includes(
      'vnd.pgrst.object',
    );
    if (url.pathname === '/rest/v1/admin_user_directory_view') {
      if (single) return route.fulfill({ headers: cors, json: adminProfile });
      return route.fulfill({
        headers: { ...cors, 'content-range': '0-0/1' },
        json: [adminProfile],
      });
    }
    if (url.pathname === '/rest/v1/admin_product_queue_view') {
      recorded.queueRequests.push(url);
      // Mirrors the view: a decided attempt leaves the queue.
      const rows = decided ? [] : [queueRow];
      return route.fulfill({
        headers: {
          ...cors,
          'content-range': rows.length ? '0-0/1' : '*/0',
        },
        json: rows,
      });
    }
    if (url.pathname === '/rest/v1/rpc/fn_lock_product') {
      recorded.lockBodies.push(request.postDataJSON());
      return route.fulfill({
        headers: cors,
        json: [{ success: true, locked_by_username: null, locked_at: null }],
      });
    }
    if (url.pathname === '/rest/v1/rpc/fn_resolve_product_verdict') {
      recorded.verdictBodies.push(request.postDataJSON());
      decided = true;
      return route.fulfill({ headers: cors, json: true });
    }
    if (
      request.method() === 'GET' &&
      url.pathname.startsWith('/storage/v1/object/sign/')
    ) {
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      const objectPath = url.pathname.slice('/storage/v1'.length);
      recorded.signRequests.push({
        path: decodeURIComponent(objectPath),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        headers: cors,
        json: { signedURL: `${objectPath}?token=e2e-signed-token` },
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
  return recorded;
}

test('verification queue shows the open attempt, its proofs and the previous rejection, and rejects through the verdict RPC', async ({
  page,
  context,
  baseURL,
}) => {
  const recorded = await openAdmin(page, context, baseURL!, '/verify');

  const listItem = page.getByRole('button', { name: new RegExp(productName) });
  await expect(listItem).toBeVisible();
  const select = recorded.queueRequests[0].searchParams.get('select') ?? '';
  for (const column of ['evidence', 'last_rejection_note', 'locked_by'])
    expect(select).toContain(column);
  for (const column of ['verification_data', 'rejection_reason'])
    expect(select).not.toContain(column);

  await listItem.click();
  await expect(page.getByText('Detalles de Verificación')).toBeVisible();
  expect(recorded.lockBodies).toEqual([
    { p_product_id: productId, p_verification_id: verificationId },
  ]);

  await expect(page.getByText('Motivo de rechazo anterior:')).toBeVisible();
  await expect(
    page.getByText(`"${previousNote}"`, { exact: true }),
  ).toBeVisible();

  const physical = page.getByRole('img', { name: 'Prueba física 1' });
  const benchmark = page.getByRole('img', { name: 'Benchmark 1' });
  await expect(physical).toBeVisible();
  await expect(benchmark).toBeVisible();
  // Each labeled image shows the proof of its own kind.
  expect(await physical.getAttribute('src')).toContain(physicalPath);
  expect(await benchmark.getAttribute('src')).toContain(performancePath);
  await expect
    .poll(() => physical.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(() => benchmark.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText(`Score: ${benchmarkScore}`)).toBeVisible();
  await expect(page.getByRole('img', { name: /Prueba física/ })).toHaveCount(1);
  await expect(page.getByRole('img', { name: /Benchmark/ })).toHaveCount(1);
  // React StrictMode runs the signing effect twice in development, so the
  // check is on the distinct objects signed in bucket verification.
  const verificationSigns = recorded.signRequests.filter((r) =>
    r.path.startsWith('/object/sign/verification/'),
  );
  expect([...new Set(verificationSigns.map((r) => r.path))].sort()).toEqual(
    [
      `/object/sign/verification/${performancePath}`,
      `/object/sign/verification/${physicalPath}`,
    ].sort(),
  );
  for (const sign of verificationSigns)
    expect(sign.body).toEqual({ expiresIn: 3600 });

  // The UI trims the public note before sending it.
  await page
    .getByPlaceholder(
      'Escribe aquí el motivo del rechazo o sugerencias de mejora...',
    )
    .fill(`  ${newNote}  `);
  await page.getByRole('button', { name: 'Rechazar Producto' }).click();
  await page.getByRole('button', { name: 'Confirmar Rechazo' }).click();

  await expect(page.getByText('Veredicto enviado correctamente')).toBeVisible();
  expect(recorded.verdictBodies).toEqual([
    {
      p_product_id: productId,
      p_verification_id: verificationId,
      p_verdict: 'REJECT',
      p_public_note: newNote,
    },
  ]);
  await expect(page.getByText('¡Todo al día en Moderación!')).toBeVisible();

  expect(recorded.forbidden).toEqual([]);
  expect(recorded.unexpected).toEqual([]);
});

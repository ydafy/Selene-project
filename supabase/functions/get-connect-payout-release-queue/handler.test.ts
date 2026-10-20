import { expect, test } from 'bun:test';
import { createQueueHandler } from './handler';

test('legacy JSON null preserves the native error without queue reads', async () => {
  let baselineMessage = '';
  try {
    const body = JSON.parse('null') as { search?: unknown };
    const search = typeof body.search === 'string' ? body.search.trim() : '';
    void search;
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    baselineMessage = (error as TypeError).message;
  }
  expect(baselineMessage.length).toBeGreaterThan(0);
  const { request, calls } = setup();
  const response = await request(null);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ success: false, error: baselineMessage });
  expect(calls).toEqual(['auth', 'profile']);
});

const queueRow = (seller_id = 'seller-1') => Object.fromEntries(['completed_at', 'ineligible_reason', 'order_id', 'payout_run_failed_at', 'payout_run_failure_reason', 'payout_run_id', 'payout_run_paid_at', 'payout_run_status', 'retry_of_run_id', 'seller_name', 'shipment_id', 'status', 'stripe_account_id', 'stripe_onboarding_status', 'stripe_payment_intent_id', 'stripe_transfer_id', 'transfer_group', 'is_eligible', 'is_retryable', 'requires_manual_review', 'payout_run_amount_cents', 'release_amount_cents'].map(key => [key, null]).concat([['seller_id', seller_id]]));
const result = (scope = 'page') => ({ rows: Array.from({ length: 20 }, (_, i) => queueRow(`s${i}`)), counts: { ready: 21, processing: 0, 'action-required': 0, history: 0 }, bucket: 'ready', scope, page: 0, pageSize: 20, totalGroups: 21, totalPages: 2, selectedGroupCount: scope === 'selection' ? 21 : 0, selectionComplete: scope === 'selection' });
function setup(options: { role?: string; auth?: boolean; data?: unknown; error?: boolean } = {}) {
  const calls: unknown[] = [];
  const handler = createQueueHandler({
    getUser: async () => { calls.push('auth'); return options.auth === false ? null : { id: 'admin' }; },
    getProfile: async () => { calls.push('profile'); return { role: options.role ?? 'admin' }; },
    legacy: async (search) => { calls.push(['legacy', search]); return []; },
    rpc: async (args) => { calls.push(['rpc', args]); if (options.error) throw Error('RPC broke'); return options.data === undefined ? result() : options.data; },
  });
  const request = (body: unknown, bearer = true) => handler(new Request('http://localhost', { method: 'POST', headers: bearer ? { Authorization: 'Bearer token' } : {}, body: JSON.stringify(body) }));
  return { calls, request };
}
test('new mode defaults and exact passthrough after authorization', async () => {
  const { calls, request } = setup(); const response = await request({ bucket: 'ready', search: ' Ada ' });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, ...result() });
  expect(calls).toEqual(['auth', 'profile', ['rpc', { p_search: 'Ada', p_bucket: 'ready', p_page: 0, p_scope: 'page' }]]);
});
test('selection passes all 21 groups without page slicing', async () => {
  const data = { ...result('selection'), rows: Array.from({ length: 21 }, (_, i) => queueRow(`s${i}`)) };
  const { request, calls } = setup({ data }); const response = await request({ bucket: 'ready', scope: 'selection', page: 2147483647 });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, ...data }); expect(calls.length).toBe(3);
});
for (const body of [{ bucket: null }, { bucket: 'bad' }, { bucket: 'ready', search: null }, { bucket: 'ready', scope: null }, ...[-1, 0.5, 2147483648, null, '0'].map(page => ({ bucket: 'ready', page })), { bucket: 'history', scope: 'selection' }, { bucket: 'processing', scope: 'selection' }]) {
  test(`rejects explicit invalid fields ${JSON.stringify(body)}`, async () => { const { request, calls } = setup(); const response = await request(body); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, error: expect.any(String) }); expect(calls).toEqual(['auth', 'profile']); });
}
for (const options of [{ role: 'user' }, { auth: false }]) test(`authorization blocks reads ${JSON.stringify(options)}`, async () => { const { request, calls } = setup(options); const response = await request({ bucket: 'ready' }); expect(response.status).toBe(options.auth === false ? 401 : 403); expect(await response.json()).toEqual({ success: false, error: options.auth === false ? 'AUTH_REQUIRED' : 'ADMIN_REQUIRED' }); expect(calls).toEqual(options.auth === false ? ['auth'] : ['auth', 'profile']); });
test('missing bearer never calls dependencies', async () => { const { request, calls } = setup(); expect((await request({}, false)).status).toBe(401); expect(calls).toEqual([]); });
for (const data of [null, {}, { ...result('selection'), selectionComplete: false }, { ...result(), rows: [null] }, { ...result(), totalPages: 1 }]) test(`malformed RPC fails closed ${JSON.stringify(data)}`, async () => { const { request, calls } = setup({ data }); const response = await request({ bucket: 'ready', scope: data && 'scope' in data ? data.scope : 'page' }); expect(response.status).toBe(502); expect(await response.json()).toEqual({ success: false, error: 'INVALID_QUEUE_RESPONSE' }); expect(calls.length).toBe(3); });
test('RPC failure has no legacy fallback', async () => { const { request, calls } = setup({ error: true }); const response = await request({ bucket: 'ready' }); expect(response.status).toBe(502); expect(await response.json()).toEqual({ success: false, error: 'QUEUE_RPC_FAILED' }); expect(calls.length).toBe(3); });
test('legacy search-only body remains unchanged', async () => { const { request, calls } = setup(); const response = await request({ search: ' Ada% ' }); expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, eligibleBatches: [], rejected: [], rows: [] }); expect(calls).toEqual(['auth', 'profile', ['legacy', 'Ada%']]); });

import { describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createCancelOrderHandler } from './handler';

interface InvokeOptions {
  busy?: boolean;
  providerError?: string;
  refundStatus?: string;
  recordError?: string;
  claimError?: string;
  startError?: string;
  /** Claim answers `recovery_required` and the recovery read returns this operation. */
  recovery?: {
    refundId?: string;
    refundStatus?: string;
    escalated?: boolean;
    hoursSinceStart?: number;
  };
  recoveryError?: string;
  listError?: string;
  /** Refunds the recovery list returns. */
  listed?: unknown[];
  retrieveError?: string;
  escalateResult?: unknown;
  escalateError?: string;
  /** `null` sends no Authorization header. */
  authorization?: string | null;
  /** What `auth.getUser` resolves; `null` is no user. */
  user?: { id: string } | null;
  authError?: string;
  /** `auth.getUser` throws a plain Error with this message. */
  getUserThrows?: string;
  settings?: { is_maintenance: boolean } | null;
  supabaseSecretKey?: string;
  stripeSecret?: string;
  order?: Record<string, unknown> | null;
  shipment?: Record<string, unknown> | null;
  items?: Record<string, unknown>[];
  itemsError?: string;
  charge?: Record<string, unknown>;
  chargeError?: string;
  feeUpdateError?: string;
  cancelResult?: unknown;
  cancelError?: string;
  body?: unknown;
}

const SUPABASE_URL = 'http://supabase.test';

// Run the handler with fake Supabase and Stripe clients and the real domain helpers.
async function invoke(options: InvokeOptions = {}) {
  const business = {
    order:
      options.order === null
        ? null
        : {
            buyer_id: 'buyer',
            total_amount: 110,
            actual_stripe_fee_cents: 500,
            stripe_charge_id: null,
            ...options.order,
          },
    shipment:
      options.shipment === null
        ? null
        : {
            id: 'target',
            order_id: 'order',
            seller_id: 'seller',
            status: 'paid',
            stripe_payment_intent_id: 'pi_target',
            stripe_transfer_id: null,
            ...options.shipment,
          },
    items: options.items ?? [
      { shipment_id: 'target', price_at_purchase: 100, shipping_amount: 900 },
    ],
    products: [{ id: 'product', status: 'SOLD', reserved: true }],
    notifications: [],
  };
  const hash = () =>
    createHash('sha256').update(JSON.stringify(business)).digest('hex');
  const before = hash();
  // Tables and RPC names, in call order.
  const events: string[] = [];
  // Every client, auth, database and Stripe call, in order.
  const calls: string[] = [];
  const queries: { table: string; ops: unknown[][] }[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const stripeCalls: unknown[][] = [];
  const refunds: unknown[][] = [];
  const claims: unknown[] = [];
  const starts: unknown[] = [];
  const completions: unknown[] = [];
  const recordings: unknown[] = [];
  const escalations: unknown[] = [];
  const reports: { message: string; options: unknown }[] = [];
  const stripeLookups: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const tokens: string[] = [];
  const clientArgs: unknown[][] = [];
  const stripeSecrets: string[] = [];

  const tableResult = (table: string, ops: unknown[][]) => {
    if (table === 'system_settings') {
      const settings =
        options.settings === undefined
          ? { is_maintenance: false }
          : options.settings;
      return settings
        ? { data: settings, error: null }
        : { data: null, error: { message: 'no settings' } };
    }
    if (table === 'orders') {
      if (ops.some(([op]) => op === 'update')) {
        return {
          error: options.feeUpdateError
            ? { message: options.feeUpdateError }
            : null,
        };
      }
      return business.order
        ? { data: structuredClone(business.order), error: null }
        : { data: null, error: { message: 'no order' } };
    }
    if (table === 'shipments') {
      return business.shipment
        ? { data: structuredClone(business.shipment), error: null }
        : { data: null, error: { message: 'no shipment' } };
    }
    if (table === 'order_items') {
      return options.itemsError
        ? { data: null, error: { message: options.itemsError } }
        : { data: structuredClone(business.items), error: null };
    }
    throw new Error(`Unexpected table: ${table}`);
  };

  const supabase = {
    auth: {
      getUser: async (token: string) => {
        calls.push('getUser');
        tokens.push(token);
        if (options.getUserThrows) throw new Error(options.getUserThrows);
        return {
          data: {
            user: options.user === undefined ? { id: 'buyer' } : options.user,
          },
          error: options.authError ? { message: options.authError } : null,
        };
      },
    },
    from(table: string) {
      events.push(table);
      calls.push('from:' + table);
      const ops: unknown[][] = [];
      queries.push({ table, ops });
      const query = {
        select: (...args: unknown[]) => (ops.push(['select', ...args]), query),
        eq: (...args: unknown[]) => (ops.push(['eq', ...args]), query),
        is: (...args: unknown[]) => (ops.push(['is', ...args]), query),
        update: (...args: unknown[]) => (ops.push(['update', ...args]), query),
        single: async () => tableResult(table, ops),
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(tableResult(table, ops)).then(resolve, reject),
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      events.push(name);
      calls.push('rpc:' + name);
      rpcs.push({ name, args });
      if (name === 'fn_claim_shipment_cancellation') {
        claims.push(args);
        if (options.claimError)
          return { error: { message: options.claimError } };
        return {
          data: options.recovery
            ? { status: 'recovery_required' }
            : options.busy
              ? { status: 'busy' }
              : {
                  status: 'claimed',
                  source: args.p_source,
                  actor_id: args.p_actor_id,
                  reason: args.p_reason,
                  operation_key: `cancel_shipment_${args.p_shipment_id}`,
                  claim_token: 'token',
                },
        };
      }
      if (name === 'fn_start_shipment_cancellation_refund') {
        starts.push(args);
        if (options.startError)
          return { error: { message: options.startError } };
        return {
          data: {
            operation_key: 'cancel_shipment_target',
            refund_request: structuredClone(args.p_refund_request),
            cancellation_loss_cents: args.p_cancellation_loss_cents,
          },
        };
      }
      if (name === 'fn_get_shipment_cancellation_recovery') {
        if (options.recoveryError)
          return { error: { message: options.recoveryError } };
        const recovery = options.recovery ?? {};
        return {
          data: {
            operation_key: 'cancel_shipment_target',
            order_id: 'order',
            source: 'buyer',
            actor_id: 'buyer',
            reason: 'Stored reason',
            refund_request: {
              payment_intent: 'pi_target',
              amount: 11000,
              reason: 'requested_by_customer',
              metadata: {
                shipment_id: 'target',
                order_id: 'order',
                caller_role: 'buyer',
                reason: 'Stored reason',
                seguro_share_cents: 1000,
              },
            },
            cancellation_loss_cents: 500,
            refund_id: recovery.refundId ?? null,
            refund_status: recovery.refundStatus ?? null,
            external_started_at: new Date(
              Date.now() - (recovery.hoursSinceStart ?? 1) * 60 * 60 * 1000,
            ).toISOString(),
            recovery_escalated_at: recovery.escalated
              ? new Date().toISOString()
              : null,
          },
        };
      }
      if (name === 'fn_escalate_shipment_cancellation') {
        escalations.push(args);
        if (options.escalateError)
          return { error: { message: options.escalateError } };
        return { data: options.escalateResult ?? { escalated: true } };
      }
      if (name === 'fn_record_shipment_cancellation_refund') {
        recordings.push(args);
        if (options.recordError)
          return { error: { message: options.recordError } };
        return {
          data: {
            refund_id: args.p_refund_id,
            refund_status: args.p_status,
            refund_failure_reason: args.p_failure_reason,
            changed: true,
          },
        };
      }
      if (name === 'fn_cancel_shipment') {
        completions.push(args);
        if (options.cancelError)
          return { data: null, error: { message: options.cancelError } };
        return { data: options.cancelResult ?? [{ success: true }] };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  const stripe = {
    charges: {
      retrieve: async (...args: unknown[]) => {
        calls.push('stripe:charges.retrieve');
        stripeCalls.push(['charges.retrieve', ...args]);
        if (options.chargeError) throw new Error(options.chargeError);
        return structuredClone(options.charge);
      },
    },
    refunds: {
      list: (...args: unknown[]) => {
        calls.push('stripe:refunds.list');
        stripeCalls.push(['refunds.list', ...args]);
        return {
          autoPagingToArray: async (...pageArgs: unknown[]) => {
            stripeLookups.push('list');
            stripeCalls.push(['autoPagingToArray', ...pageArgs]);
            if (options.listError) throw new Error(options.listError);
            return structuredClone(options.listed ?? []);
          },
        };
      },
      retrieve: async (...args: unknown[]) => {
        calls.push('stripe:refunds.retrieve');
        stripeLookups.push('retrieve');
        stripeCalls.push(['refunds.retrieve', ...args]);
        throw new Error(options.retrieveError ?? 'unexpected retrieve');
      },
      create: async (...args: unknown[]) => {
        calls.push('stripe:refunds.create');
        refunds.push(args);
        if (options.providerError) throw new Error(options.providerError);
        return {
          id: 're_target',
          payment_intent: 'pi_target',
          amount: 11000,
          status: options.refundStatus ?? 'succeeded',
          failure_reason: null,
          metadata: (args[0] as { metadata?: unknown } | undefined)?.metadata,
        };
      },
    },
  };

  const env: Record<string, string | undefined> = {
    SUPABASE_URL,
    STRIPE_SECRET_KEY:
      'stripeSecret' in options ? options.stripeSecret : 'sk_test_fake',
  };
  const handler = createCancelOrderHandler({
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () =>
      'supabaseSecretKey' in options
        ? options.supabaseSecretKey
        : 'sb_secret_fake',
    createSupabaseAdmin: (url, key) => {
      calls.push('createSupabaseAdmin');
      clientArgs.push([url, key]);
      return supabase as never;
    },
    createStripe: (secret) => {
      calls.push('createStripe');
      stripeSecrets.push(secret);
      return stripe as never;
    },
    reportMessage: async (message, reportOptions) => {
      reports.push({ message, options: reportOptions });
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const authorization =
    options.authorization === undefined
      ? 'Bearer user-token'
      : options.authorization;
  if (authorization !== null) headers.Authorization = authorization;
  const log = spyOn(console, 'log').mockImplementation((value: unknown) => {
    logs.push(JSON.parse(String(value)));
  });
  let response: Response;
  try {
    response = await handler(
      new Request('https://test.invalid/cancel-order', {
        method: 'POST',
        headers,
        body:
          typeof options.body === 'string'
            ? options.body
            : JSON.stringify(
                options.body ?? {
                  orderId: 'order',
                  shipmentId: 'target',
                  reason: 'Current reason',
                },
              ),
      }),
    );
  } finally {
    log.mockRestore();
  }
  return {
    response,
    body: await response.text(),
    events,
    calls,
    queries,
    rpcs,
    stripeCalls,
    refunds,
    claims,
    starts,
    completions,
    recordings,
    escalations,
    reports,
    stripeLookups,
    logs,
    tokens,
    clientArgs,
    stripeSecrets,
    before,
    after: hash(),
  };
}

const opsOf = (
  result: Awaited<ReturnType<typeof invoke>>,
  table: string,
): unknown[][][] =>
  result.queries
    .filter((query) => query.table === table)
    .map((query) => query.ops);

describe('manual cancellation HTTP preservation', () => {
  test('generic provider failure preserves HTTP 500, exact message and logging without completion', async () => {
    const result = await invoke({ providerError: 'provider unavailable' });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"CANCELLATION_REFUND_PROVIDER_FAILED"}');
    expect(result.body).not.toContain('provider unavailable');
    expect(result.refunds).toEqual([
      [
        {
          payment_intent: 'pi_target',
          amount: 11000,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: 'target',
            order_id: 'order',
            caller_role: 'buyer',
            reason: 'Current reason',
            seguro_share_cents: 1000,
          },
        },
        { idempotencyKey: 'cancel_shipment_target' },
      ],
    ]);
    expect(result.events).toContain('fn_start_shipment_cancellation_refund');
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
    expect(result.logs).toEqual([
      expect.objectContaining({
        level: 'ERROR',
        msg: 'Stripe refund failed',
        shipmentId: 'target',
        error: 'provider unavailable',
      }),
      expect.objectContaining({
        level: 'ERROR',
        msg: 'Fallo en proceso de cancelación',
        error: 'CANCELLATION_REFUND_PROVIDER_FAILED',
      }),
    ]);
  });
  test('a claim RPC error returns a stable 409 and keeps the RPC text in the logs only', async () => {
    const result = await invoke({
      claimError: 'claim secret detail p_actor_id',
    });
    expect(result.response.status).toBe(409);
    expect(result.body).toBe('{"error":"CANCELLATION_CLAIM_FAILED"}');
    expect(result.body).not.toContain('claim secret detail');
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'ERROR',
        error: 'claim secret detail p_actor_id',
      }),
    );
    expect(result.refunds).toEqual([]);
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
  });
  test('a start RPC error returns a stable 409 and keeps the RPC text in the logs only', async () => {
    const result = await invoke({
      startError: 'start secret detail p_claim_token',
    });
    expect(result.response.status).toBe(409);
    expect(result.body).toBe('{"error":"CANCELLATION_START_FAILED"}');
    expect(result.body).not.toContain('start secret detail');
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'ERROR',
        error: 'start secret detail p_claim_token',
      }),
    );
    expect(result.refunds).toEqual([]);
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
  });
  test('busy returns exact 409 without reconstruction, provider or business effects', async () => {
    const result = await invoke({ busy: true });
    expect(result.response.status).toBe(409);
    expect(result.body).toBe('{"error":"CANCELLATION_BUSY"}');
    expect(result.events).toEqual([
      'system_settings',
      'orders',
      'shipments',
      'fn_claim_shipment_cancellation',
    ]);
    expect(result.refunds).toEqual([]);
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
  });
  for (const options of [
    { providerError: 'charge_already_refunded' },
    { refundStatus: 'pending' },
  ]) {
    test(`unconfirmed provider outcome cannot complete: ${JSON.stringify(options)}`, async () => {
      const result = await invoke(options);
      expect(result.response.status).toBe(options.providerError ? 500 : 409);
      expect(result.body).toBe(
        options.providerError
          ? '{"error":"CANCELLATION_REFUND_PROVIDER_FAILED"}'
          : '{"error":"CANCELLATION_REFUND_UNCONFIRMED"}',
      );
      expect(result.refunds).toHaveLength(1);
      expect(result.recordings).toHaveLength(options.providerError ? 0 : 1);
      expect(result.completions).toEqual([]);
      expect(result.after).toBe(result.before);
    });
  }
  test('a record RPC error returns a stable 500 and never leaks the RPC text', async () => {
    const result = await invoke({
      recordError: 'secret rpc detail p_refund_id',
    });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"CANCELLATION_REFUND_RECORD_FAILED"}');
    expect(result.body).not.toContain('secret rpc detail');
    expect(result.completions).toEqual([]);
    expect(result.refunds).toHaveLength(1);
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'ERROR',
        error: 'secret rpc detail p_refund_id',
      }),
    );
    expect(result.after).toBe(result.before);
  });
  describe('recovery errors (B2.2.1)', () => {
    test('an unreadable recovery operation returns CANCELLATION_RECOVERY_UNAVAILABLE and leaks no RPC text', async () => {
      const result = await invoke({
        recovery: {},
        recoveryError: 'recovery secret detail',
      });
      expect(result.response.status).toBe(500);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_UNAVAILABLE"}');
      expect(result.body).not.toContain('recovery secret detail');
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: 'Cancellation recovery lookup failed',
          error: 'recovery secret detail',
        }),
      );
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
      expect(result.after).toBe(result.before);
    });
    test.each([
      [
        'list',
        { recovery: {}, listError: 'stripe list secret' },
        'stripe list secret',
      ],
      [
        'retrieve',
        {
          recovery: { refundId: 're_target', refundStatus: 'pending' },
          retrieveError: 'stripe retrieve secret',
        },
        'stripe retrieve secret',
      ],
    ])(
      'a Stripe %s failure returns CANCELLATION_REFUND_LOOKUP_FAILED and leaks no Stripe text',
      async (action, options, raw) => {
        const result = await invoke(options);
        expect(result.response.status).toBe(500);
        expect(result.body).toBe(
          '{"error":"CANCELLATION_REFUND_LOOKUP_FAILED"}',
        );
        expect(result.body).not.toContain(raw);
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'ERROR',
            msg: 'Stripe refund lookup failed',
            action,
            error: raw,
          }),
        );
        expect(result.stripeLookups).toEqual([action]);
        expect(result.refunds).toEqual([]);
        expect(result.completions).toEqual([]);
        expect(result.after).toBe(result.before);
      },
    );
    test('a Stripe error during a recovery replay returns CANCELLATION_REFUND_PROVIDER_FAILED', async () => {
      const result = await invoke({
        recovery: {},
        providerError: 'replay provider secret',
      });
      expect(result.response.status).toBe(500);
      expect(result.body).toBe(
        '{"error":"CANCELLATION_REFUND_PROVIDER_FAILED"}',
      );
      expect(result.body).not.toContain('replay provider secret');
      expect(result.refunds).toHaveLength(1);
      expect((result.refunds[0] as unknown[])[1]).toEqual({
        idempotencyKey: 'cancel_shipment_target',
      });
      expect(result.completions).toEqual([]);
    });
  });
  describe('escalation (B2.2.1)', () => {
    test('a refund missing after 24 h escalates once, alerts, and creates nothing', async () => {
      const result = await invoke({ recovery: { hoursSinceStart: 24 } });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.escalations).toEqual([
        { p_shipment_id: 'target', p_reason: 'refund_not_found' },
      ]);
      expect(result.reports).toEqual([
        expect.objectContaining({
          message: 'cancel-order CANCELLATION_REFUND_NOT_FOUND',
        }),
      ]);
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
      expect(result.after).toBe(result.before);
    });
    test('a repeated escalation (already recorded) does not alert again', async () => {
      const result = await invoke({
        recovery: { hoursSinceStart: 24 },
        escalateResult: { escalated: false },
      });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.escalations).toHaveLength(1);
      expect(result.reports).toEqual([]);
      expect(result.logs.filter((entry) => entry.level === 'CRITICAL')).toEqual(
        [],
      );
    });
    test('an escalated operation stops before any Stripe call, escalation or alert', async () => {
      const result = await invoke({
        recovery: { hoursSinceStart: 48, escalated: true },
      });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.stripeLookups).toEqual([]);
      expect(result.escalations).toEqual([]);
      expect(result.reports).toEqual([]);
      expect(result.refunds).toEqual([]);
    });
    test('an escalation RPC error still needs an admin, still alerts, and leaks no RPC text', async () => {
      const result = await invoke({
        recovery: { hoursSinceStart: 24 },
        escalateError: 'escalate secret detail',
      });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.body).not.toContain('escalate secret detail');
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: 'Cancellation escalation failed',
          error: 'escalate secret detail',
        }),
      );
      expect(result.reports).toHaveLength(1);
      expect(result.refunds).toEqual([]);
    });
  });
  test('succeeded refund retains the existing HTTP success contract', async () => {
    const result = await invoke();
    expect(result.response.status).toBe(200);
    expect(result.body).toBe(
      '{"success":true,"message":"Shipment canceled and refund processed"}',
    );
    expect(result.refunds).toHaveLength(1);
    expect(result.recordings).toEqual([
      {
        p_shipment_id: 'target',
        p_refund_id: 're_target',
        p_payment_intent_id: 'pi_target',
        p_amount_cents: 11000,
        p_status: 'succeeded',
        p_failure_reason: null,
      },
    ]);
    expect(
      result.events.indexOf('fn_record_shipment_cancellation_refund'),
    ).toBeGreaterThan(
      result.events.indexOf('fn_start_shipment_cancellation_refund'),
    );
    expect(result.events.indexOf('fn_cancel_shipment')).toBeGreaterThan(
      result.events.indexOf('fn_record_shipment_cancellation_refund'),
    );
    expect(result.completions).toEqual([
      {
        p_shipment_id: 'target',
        p_cancelled_by_role: 'buyer',
        p_reason: 'Current reason',
        p_cancellation_loss_cents: 500,
      },
    ]);
  });
});

const REQUEST_ONLY = ['createSupabaseAdmin', 'getUser'];
const AFTER_SHIPMENT_READ = [
  'from:system_settings',
  'createStripe',
  'from:orders',
  'from:shipments',
];
const touchesDataOrStripe = (call: string) =>
  call.startsWith('from:') ||
  call.startsWith('rpc:') ||
  call.startsWith('stripe:') ||
  call === 'createStripe';

describe('cancel-order handler wiring', () => {
  test('builds one service client per request from SUPABASE_URL and the secret key', async () => {
    const result = await invoke();
    expect(result.response.status).toBe(200);
    expect(result.clientArgs).toEqual([[SUPABASE_URL, 'sb_secret_fake']]);
    expect(result.tokens).toEqual(['user-token']);
    expect(result.stripeSecrets).toEqual(['sk_test_fake']);
  });

  test('a missing secret key still builds the client with an empty key, as before', async () => {
    const result = await invoke({ supabaseSecretKey: undefined, user: null });
    expect(result.clientArgs).toEqual([[SUPABASE_URL, '']]);
    expect(result.response.status).toBe(401);
  });

  test.each([
    ['no order id', { shipmentId: 'target' }, 'ORDER_ID_REQUIRED'],
    ['no shipment id', { orderId: 'order' }, 'SHIPMENT_ID_REQUIRED'],
    ['a body that is not JSON', 'not json', 'ORDER_ID_REQUIRED'],
  ])(
    '%s answers 422 before any client is built',
    async (_label, body, code) => {
      const result = await invoke({ body });
      expect(result.response.status).toBe(422);
      expect(result.body).toBe(JSON.stringify({ error: code }));
      expect(result.calls).toEqual([]);
    },
  );

  test.each([
    [
      'no Authorization header',
      { authorization: null },
      ['createSupabaseAdmin'],
    ],
    ['no user for the token', { user: null }, REQUEST_ONLY],
    [
      'an auth error that comes with a user',
      { authError: 'jwt expired', user: { id: 'buyer' } },
      REQUEST_ONLY,
    ],
  ])(
    '%s answers 401 AUTH_REQUIRED before any table, RPC or Stripe call',
    async (_label, options, calls) => {
      const result = await invoke(options as InvokeOptions);
      expect(result.response.status).toBe(401);
      expect(result.body).toBe('{"error":"AUTH_REQUIRED"}');
      expect(result.calls).toEqual(calls);
      expect(result.calls.filter(touchesDataOrStripe)).toEqual([]);
    },
  );

  test('strips the Bearer prefix before verifying the token', async () => {
    const result = await invoke({ authorization: 'Bearer abc.def' });
    expect(result.tokens).toEqual(['abc.def']);
  });

  test('reads maintenance from system_settings row 1 and stops before Stripe or the order', async () => {
    const result = await invoke({ settings: { is_maintenance: true } });
    expect(result.response.status).toBe(503);
    expect(result.body).toBe('{"error":"MAINTENANCE_MODE"}');
    expect(opsOf(result, 'system_settings')).toEqual([
      [
        ['select', 'is_maintenance'],
        ['eq', 'id', 1],
      ],
    ]);
    expect(result.calls).toEqual([...REQUEST_ONLY, 'from:system_settings']);
  });

  test('missing system settings answer 500 before Stripe or the order', async () => {
    const result = await invoke({ settings: null });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"SYSTEM_SETTINGS_NOT_FOUND"}');
    expect(result.calls).toEqual([...REQUEST_ONLY, 'from:system_settings']);
  });

  test('a missing Stripe secret answers 500 before the order is read', async () => {
    const result = await invoke({ stripeSecret: undefined });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"MISSING_STRIPE_SECRET_KEY"}');
    expect(result.calls).toEqual([...REQUEST_ONLY, 'from:system_settings']);
  });

  test('reads the order and the shipment of that order by id', async () => {
    const result = await invoke({ busy: true });
    expect(opsOf(result, 'orders')).toEqual([
      [
        [
          'select',
          'buyer_id, total_amount, stripe_charge_id, actual_stripe_fee_cents, stripe_fee_reconciled_at',
        ],
        ['eq', 'id', 'order'],
      ],
    ]);
    expect(opsOf(result, 'shipments')).toEqual([
      [
        [
          'select',
          'id, order_id, seller_id, status, stripe_payment_intent_id, stripe_transfer_id',
        ],
        ['eq', 'id', 'target'],
        ['eq', 'order_id', 'order'],
      ],
    ]);
  });

  test.each([
    [
      'an unknown order',
      { order: null },
      422,
      'ORDER_NOT_FOUND',
      AFTER_SHIPMENT_READ.slice(0, 3),
    ],
    [
      'a shipment of another order',
      { shipment: null },
      422,
      'SHIPMENT_ORDER_MISMATCH',
      AFTER_SHIPMENT_READ,
    ],
    [
      'a caller who is neither the buyer nor the seller',
      { user: { id: 'stranger' } },
      403,
      'UNAUTHORIZED',
      AFTER_SHIPMENT_READ,
    ],
    [
      'a buyer of an order without a buyer id',
      { order: { buyer_id: null } },
      403,
      'UNAUTHORIZED',
      AFTER_SHIPMENT_READ,
    ],
    [
      'a shipment that is not paid',
      { shipment: { status: 'preparing' } },
      422,
      'SHIPMENT_NOT_CANCELABLE',
      AFTER_SHIPMENT_READ,
    ],
    [
      'a shipment whose funds were released',
      { shipment: { stripe_transfer_id: 'tr_1' } },
      409,
      'STRIPE_TRANSFER_ALREADY_RELEASED',
      AFTER_SHIPMENT_READ,
    ],
    [
      'a shipment without a PaymentIntent',
      { shipment: { stripe_payment_intent_id: null } },
      500,
      'PAYMENT_INTENT_NOT_FOUND',
      AFTER_SHIPMENT_READ,
    ],
  ])(
    '%s is refused before any claim, item read or Stripe call',
    async (_label, options, status, code, after) => {
      const result = await invoke(options as InvokeOptions);
      expect(result.response.status).toBe(status);
      expect(result.body).toBe(JSON.stringify({ error: code }));
      expect(result.calls).toEqual([...REQUEST_ONLY, ...after]);
    },
  );

  test('a released transfer logs CRITICAL with its transfer id', async () => {
    const result = await invoke({ shipment: { stripe_transfer_id: 'tr_1' } });
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'CRITICAL',
        msg: 'CRITICAL_TRANSFER_BLOCKED',
        orderId: 'order',
        shipmentId: 'target',
        stripeTransferId: 'tr_1',
      }),
    );
  });

  test('claims as the verified buyer, ignoring actor fields in the body', async () => {
    const result = await invoke({
      body: {
        orderId: 'order',
        shipmentId: 'target',
        reason: '  Current reason  ',
        actorId: 'seller',
        source: 'seller',
        buyerId: 'attacker',
      },
    });
    expect(result.response.status).toBe(200);
    expect(result.claims).toEqual([
      {
        p_order_id: 'order',
        p_shipment_id: 'target',
        p_actor_id: 'buyer',
        p_source: 'buyer',
        p_reason: 'Current reason',
      },
    ]);
  });

  test('a verified seller cancels as seller in the claim, refund and cancellation', async () => {
    const result = await invoke({ user: { id: 'seller' } });
    expect(result.response.status).toBe(200);
    expect(result.claims).toEqual([
      expect.objectContaining({ p_actor_id: 'seller', p_source: 'seller' }),
    ]);
    expect(result.refunds[0]?.[0]).toMatchObject({
      metadata: { caller_role: 'seller' },
    });
    expect(result.completions).toEqual([
      expect.objectContaining({ p_cancelled_by_role: 'seller' }),
    ]);
  });

  test('a blank reason falls back to the default reason', async () => {
    const result = await invoke({
      body: { orderId: 'order', shipmentId: 'target', reason: '   ' },
    });
    expect(result.claims).toEqual([
      expect.objectContaining({
        p_reason: 'Cancelación solicitada por el usuario',
      }),
    ]);
  });

  test('refunds only the target shipment, from server amounts, ignoring amounts in the body', async () => {
    const result = await invoke({
      order: { total_amount: 440, actual_stripe_fee_cents: 500 },
      items: [
        { shipment_id: 'target', price_at_purchase: 100, shipping_amount: 90 },
        { shipment_id: 'other', price_at_purchase: 300, shipping_amount: 90 },
      ],
      body: {
        orderId: 'order',
        shipmentId: 'target',
        reason: 'Current reason',
        amount: 1,
        amountCents: 1,
      },
    });
    expect(result.response.status).toBe(200);
    expect(opsOf(result, 'order_items')).toEqual([
      [
        ['select', 'price_at_purchase, shipping_amount, shipment_id'],
        ['eq', 'order_id', 'order'],
      ],
    ]);
    const refundRequest = {
      payment_intent: 'pi_target',
      amount: 11000,
      reason: 'requested_by_customer',
      metadata: {
        shipment_id: 'target',
        order_id: 'order',
        caller_role: 'buyer',
        reason: 'Current reason',
        seguro_share_cents: 1000,
      },
    };
    expect(result.starts).toEqual([
      {
        p_shipment_id: 'target',
        p_claim_token: 'token',
        p_refund_request: refundRequest,
        p_cancellation_loss_cents: 125,
      },
    ]);
    expect(result.refunds).toEqual([
      [refundRequest, { idempotencyKey: 'cancel_shipment_target' }],
    ]);
    expect(result.completions).toEqual([
      {
        p_shipment_id: 'target',
        p_cancelled_by_role: 'buyer',
        p_reason: 'Current reason',
        p_cancellation_loss_cents: 125,
      },
    ]);
  });

  test('refunds before recording and records before cancelling the shipment', async () => {
    const result = await invoke();
    expect(result.calls).toEqual([
      ...REQUEST_ONLY,
      ...AFTER_SHIPMENT_READ,
      'rpc:fn_claim_shipment_cancellation',
      'from:order_items',
      'rpc:fn_start_shipment_cancellation_refund',
      'stripe:refunds.create',
      'rpc:fn_record_shipment_cancellation_refund',
      'rpc:fn_cancel_shipment',
    ]);
  });

  test.each(['failed', 'canceled', 'requires_action'])(
    'a %s refund is recorded and the shipment stays uncancelled',
    async (refundStatus) => {
      const result = await invoke({ refundStatus });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_REFUND_UNCONFIRMED"}');
      expect(result.recordings).toEqual([
        expect.objectContaining({ p_status: refundStatus }),
      ]);
      expect(result.completions).toEqual([]);
    },
  );

  test('an item read error answers 500 before the refund starts', async () => {
    const result = await invoke({ itemsError: 'items detail' });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"ORDER_ITEMS_NOT_FOUND"}');
    expect(result.starts).toEqual([]);
    expect(result.refunds).toEqual([]);
  });

  test('reads the charge after the claim, persists its actual fee and allocates it as the loss', async () => {
    const result = await invoke({
      order: {
        total_amount: 999,
        stripe_charge_id: 'ch_1',
        actual_stripe_fee_cents: null,
      },
      charge: {
        amount: 11000,
        amount_refunded: 0,
        balance_transaction: { fee: 420 },
      },
    });
    expect(result.response.status).toBe(200);
    expect(result.stripeCalls[0]).toEqual([
      'charges.retrieve',
      'ch_1',
      { expand: ['balance_transaction'] },
    ]);
    expect(result.calls.indexOf('stripe:charges.retrieve')).toBeGreaterThan(
      result.calls.indexOf('rpc:fn_claim_shipment_cancellation'),
    );
    const update = opsOf(result, 'orders')[1] ?? [];
    expect(update).toHaveLength(3);
    const [op, payload] = update[0] as [string, Record<string, unknown>];
    expect(op).toBe('update');
    expect(payload.actual_stripe_fee_cents).toBe(420);
    expect(typeof payload.stripe_fee_reconciled_at).toBe('string');
    expect(payload.updated_at).toBe(payload.stripe_fee_reconciled_at);
    expect(update.slice(1)).toEqual([
      ['eq', 'id', 'order'],
      ['is', 'actual_stripe_fee_cents', null],
    ]);
    // The charge amount, not total_amount, is the refund basis.
    expect(result.starts).toEqual([
      expect.objectContaining({
        p_refund_request: expect.objectContaining({ amount: 11000 }),
        p_cancellation_loss_cents: 420,
      }),
    ]);
    expect(result.completions).toEqual([
      expect.objectContaining({ p_cancellation_loss_cents: 420 }),
    ]);
  });

  test('a failed fee write is logged and the cancellation continues with the fee', async () => {
    const result = await invoke({
      order: { stripe_charge_id: 'ch_1', actual_stripe_fee_cents: null },
      charge: {
        amount: 11000,
        amount_refunded: 0,
        balance_transaction: { fee: 420 },
      },
      feeUpdateError: 'fee write detail',
    });
    expect(result.response.status).toBe(200);
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'WARN',
        msg: 'Could not persist on-demand Stripe fee reconciliation',
        orderId: 'order',
        error: 'fee write detail',
      }),
    );
    expect(result.completions).toEqual([
      expect.objectContaining({ p_cancellation_loss_cents: 420 }),
    ]);
  });

  test('a charge without a balance transaction leaves the fee unknown and writes nothing', async () => {
    const result = await invoke({
      order: { stripe_charge_id: 'ch_1', actual_stripe_fee_cents: null },
      charge: { amount: 11000, amount_refunded: 0, balance_transaction: 'txn' },
    });
    expect(result.response.status).toBe(200);
    expect(opsOf(result, 'orders')).toHaveLength(1);
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'WARN',
        msg: 'Stripe fee reconciliation unavailable during cancel',
        chargeId: 'ch_1',
      }),
    );
    expect(result.completions).toEqual([
      expect.objectContaining({ p_cancellation_loss_cents: null }),
    ]);
  });

  test('a stored fee is not reconciled again', async () => {
    const result = await invoke({
      order: { stripe_charge_id: 'ch_1', actual_stripe_fee_cents: 500 },
      charge: {
        amount: 11000,
        amount_refunded: 0,
        balance_transaction: { fee: 420 },
      },
    });
    expect(result.response.status).toBe(200);
    expect(opsOf(result, 'orders')).toHaveLength(1);
    expect(result.completions).toEqual([
      expect.objectContaining({ p_cancellation_loss_cents: 500 }),
    ]);
  });

  test('an earlier partial refund caps the refund and stops before it starts', async () => {
    const result = await invoke({
      order: { stripe_charge_id: 'ch_1' },
      charge: {
        amount: 11000,
        amount_refunded: 5000,
        balance_transaction: { fee: 420 },
      },
    });
    expect(result.response.status).toBe(422);
    expect(result.body).toBe('{"error":"REFUND_AMOUNT_EXCEEDS_CAP"}');
    expect(result.starts).toEqual([]);
    expect(result.refunds).toEqual([]);
  });

  test('an unreadable charge answers 500 before the refund starts', async () => {
    const result = await invoke({
      order: { stripe_charge_id: 'ch_1' },
      chargeError: 'stripe charge detail',
    });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"STRIPE_CHARGE_NOT_FOUND"}');
    expect(result.starts).toEqual([]);
    expect(result.refunds).toEqual([]);
  });

  test('a recorded succeeded refund completes with the stored winner and moves no money', async () => {
    const result = await invoke({
      recovery: { refundId: 're_target', refundStatus: 'succeeded' },
    });
    expect(result.response.status).toBe(200);
    expect(result.refunds).toEqual([]);
    expect(result.stripeLookups).toEqual([]);
    expect(result.completions).toEqual([
      {
        p_shipment_id: 'target',
        p_cancelled_by_role: 'buyer',
        p_reason: 'Stored reason',
        p_cancellation_loss_cents: 500,
      },
    ]);
    expect(result.rpcs).toContainEqual({
      name: 'fn_get_shipment_cancellation_recovery',
      args: { p_shipment_id: 'target' },
    });
  });

  test('recovery lists the refunds of the PaymentIntent and retrieves a recorded one by id', async () => {
    const listed = await invoke({ recovery: {}, listError: 'list detail' });
    expect(listed.stripeCalls).toEqual([
      ['refunds.list', { payment_intent: 'pi_target', limit: 100 }],
      ['autoPagingToArray', { limit: 1000 }],
    ]);
    const retrieved = await invoke({
      recovery: { refundId: 're_target', refundStatus: 'pending' },
      retrieveError: 'retrieve detail',
    });
    expect(retrieved.stripeCalls).toEqual([['refunds.retrieve', 're_target']]);
  });

  test('two refunds of the shipment at Stripe escalate as ambiguous and move no money', async () => {
    const refund = (id: string) => ({
      id,
      payment_intent: 'pi_target',
      amount: 11000,
      status: 'succeeded',
      metadata: { shipment_id: 'target' },
    });
    const result = await invoke({
      recovery: {},
      listed: [refund('re_1'), refund('re_2')],
    });
    expect(result.response.status).toBe(409);
    expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
    expect(result.escalations).toEqual([
      { p_shipment_id: 'target', p_reason: 'refund_ambiguous' },
    ]);
    expect(result.reports).toEqual([
      expect.objectContaining({
        message: 'cancel-order CANCELLATION_REFUND_AMBIGUOUS',
      }),
    ]);
    expect(result.refunds).toEqual([]);
    expect(result.completions).toEqual([]);
  });

  test('an unexpected error answers 400 and is logged', async () => {
    const result = await invoke({ getUserThrows: 'network down' });
    expect(result.response.status).toBe(400);
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'ERROR',
        msg: 'Fallo en proceso de cancelación',
        error: 'network down',
      }),
    );
    expect(result.calls.filter(touchesDataOrStripe)).toEqual([]);
  });

  test('a recovery replay sends the frozen request with the same key and completes', async () => {
    const result = await invoke({ recovery: {} });
    expect(result.response.status).toBe(200);
    expect(result.refunds).toEqual([
      [
        {
          payment_intent: 'pi_target',
          amount: 11000,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: 'target',
            order_id: 'order',
            caller_role: 'buyer',
            reason: 'Stored reason',
            seguro_share_cents: 1000,
          },
        },
        { idempotencyKey: 'cancel_shipment_target' },
      ],
    ]);
  });

  test.each([
    ['an RPC error', { cancelError: 'cancel detail' }, 'cancel detail'],
    [
      'an unsuccessful result',
      {
        cancelResult: [
          { success: false, error_message: 'CANNOT_CANCEL_IN_THIS_STATUS' },
        ],
      },
      'CANNOT_CANCEL_IN_THIS_STATUS',
    ],
  ])(
    'a refunded shipment whose cancel RPC fails with %s alerts and answers 500',
    async (_label, options, dbError) => {
      const result = await invoke(options);
      expect(result.response.status).toBe(500);
      expect(result.body).toBe(
        JSON.stringify({
          error:
            'Dinero devuelto, pero error al actualizar inventario. Soporte técnico ha sido notificado.',
        }),
      );
      expect(result.reports).toEqual([
        {
          message:
            'cancel-order Refund processed but shipment cancel RPC failed',
          options: {
            fingerprint: [
              'shipment-cancellation',
              'cancel-order',
              'Refund processed but shipment cancel RPC failed',
            ],
            tags: { edge_function: 'cancel-order', shipment_id: 'target' },
          },
        },
      ]);
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'CRITICAL',
          msg: 'Refund processed but shipment cancel RPC failed',
          orderId: 'order',
          shipmentId: 'target',
          dbError,
        }),
      );
    },
  );
});

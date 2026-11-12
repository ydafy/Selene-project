import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  type CheckoutRecoveryStripeClient,
  type CheckoutRecoveryWorkerDependencies,
  createCheckoutRecoveryWorkerHandler,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };

const CRON_SECRET = 'cron-secret-value';
const ENV: Record<string, string> = {
  CRON_SECRET,
  SUPABASE_URL: 'http://127.0.0.1:54321',
};
const SECRET_KEY = 'sb_secret_recovery';
const LEASE_ID = '00000000-0000-4000-8000-00000000aa01';

interface Claim {
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
}

interface Charge {
  transfer?: string | null;
}

// Every RPC and Stripe call the worker makes is recorded in `calls`, in order. `rpc` overrides
// answer one RPC by name; the defaults acquire the lease, claim nothing and succeed.
function harness(
  input: {
    env?: Record<string, string | undefined>;
    secretKey?: string;
    orderClaims?: Claim[];
    standaloneClaims?: Claim[];
    rpc?: Record<string, (args: Row) => RpcResult>;
    intents?: Record<string, Row>;
    charges?: Record<string, Charge>;
    refundStatus?: string;
  } = {},
) {
  const env = input.env ?? ENV;
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const stripeCalls: Array<{ method: string; args: unknown[] }> = [];
  const clients: Array<{ url: string; key: string }> = [];
  const reports: Array<{ message: string; options: unknown }> = [];

  const defaults: Record<string, (args: Row) => RpcResult> = {
    fn_acquire_cron_lease: () => ({
      data: [{ acquired: true, lease_id: LEASE_ID }],
      error: null,
    }),
    fn_release_cron_lease: () => ({ data: true, error: null }),
    fn_claim_checkout_recovery_shells: (args) => ({
      data:
        args.p_claim_scope === 'order'
          ? (input.orderClaims ?? [])
          : (input.standaloneClaims ?? []),
      error: null,
    }),
    fn_set_checkout_recovery_charge_evidence: (args) => ({
      data: args.p_stripe_charge_id,
      error: null,
    }),
    fn_mark_checkout_recovery_reconciliation_needed: () => ({
      data: null,
      error: null,
    }),
    fn_finalize_checkout_recovery: () => ({ data: null, error: null }),
    fn_mark_checkout_recovery_retry: () => ({ data: null, error: null }),
  };

  const supabase = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      throw new Error(`unexpected table read: ${table}`);
    },
    rpc: async (name: string, args: Row) => {
      calls.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      const answer = input.rpc?.[name] ?? defaults[name];
      if (!answer) throw new Error(`unexpected rpc: ${name}`);
      return answer(args);
    },
  };

  const stripe = {
    paymentIntents: {
      retrieve: async (id: string, options: unknown) => {
        calls.push(`stripe:paymentIntents.retrieve:${id}`);
        stripeCalls.push({
          method: 'paymentIntents.retrieve',
          args: [id, options],
        });
        return { id, ...(input.intents?.[id] ?? {}) };
      },
    },
    charges: {
      retrieve: async (id: string) => {
        calls.push(`stripe:charges.retrieve:${id}`);
        stripeCalls.push({ method: 'charges.retrieve', args: [id] });
        return { id, ...(input.charges?.[id] ?? {}) };
      },
    },
    refunds: {
      create: async (params: Row, options: Row) => {
        calls.push(`stripe:refunds.create:${String(params.payment_intent)}`);
        stripeCalls.push({ method: 'refunds.create', args: [params, options] });
        return {
          id: `re_${String(params.payment_intent)}`,
          status: input.refundStatus ?? 'succeeded',
        };
      },
    },
  };

  const deps: CheckoutRecoveryWorkerDependencies = {
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () =>
      'secretKey' in input ? input.secretKey : SECRET_KEY,
    reportMessage: (message, options) => {
      reports.push({ message, options });
    },
    createSupabaseAdmin: (url, key) => {
      calls.push('client');
      clients.push({ url, key });
      return supabase as unknown as SupabaseAdminClient;
    },
    stripe: stripe as unknown as CheckoutRecoveryStripeClient,
  };

  return {
    handler: createCheckoutRecoveryWorkerHandler(deps),
    calls,
    rpcCalls,
    stripeCalls,
    clients,
    reports,
    rpcArgs: (name: string) =>
      rpcCalls.filter((call) => call.name === name).map((call) => call.args),
  };
}

const request = (
  headers: Record<string, string> = { 'x-cron-secret': CRON_SECRET },
) =>
  new Request('https://example.test/functions/v1/checkout-recovery-worker', {
    method: 'POST',
    headers,
  });

const LEASE_RPCS = {
  acquire: 'rpc:fn_acquire_cron_lease',
  claim: 'rpc:fn_claim_checkout_recovery_shells',
  release: 'rpc:fn_release_cron_lease',
};

let warnings: string[] = [];

describe('checkout-recovery-worker handler', () => {
  beforeEach(() => {
    warnings = [];
    spyOn(console, 'warn').mockImplementation((line: unknown) => {
      warnings.push(String(line));
    });
  });
  afterEach(() => {
    (console.warn as unknown as { mockRestore: () => void }).mockRestore();
  });

  describe('authorization', () => {
    it.each([
      ['no x-cron-secret header', {}],
      [
        'a Bearer token instead of the cron secret',
        { Authorization: 'Bearer service-role-jwt' },
      ],
      ['an empty x-cron-secret', { 'x-cron-secret': '' }],
    ])(
      'answers 401 for %s without reporting or creating a client',
      async (_label, headers) => {
        const h = harness();

        const response = await h.handler(request(headers));

        expect(response.status).toBe(401);
        expect(await response.text()).toBe('Unauthorized');
        expect(h.calls).toEqual([]);
        expect(h.reports).toEqual([]);
      },
    );

    it('answers 401 for a wrong cron secret and reports the mismatch before any client or call', async () => {
      const h = harness();

      const response = await h.handler(
        request({ 'x-cron-secret': 'stale-secret' }),
      );

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Unauthorized');
      expect(h.reports).toEqual([
        {
          message: 'checkout-recovery-worker cron secret mismatch',
          options: {
            fingerprint: ['cron-secret-mismatch', 'checkout-recovery-worker'],
            tags: { edge_function: 'checkout-recovery-worker' },
          },
        },
      ]);
      expect(h.calls).toEqual([]);
      expect(h.stripeCalls).toEqual([]);
    });

    it('answers 401 when CRON_SECRET is not configured, whatever the header says', async () => {
      const h = harness({ env: { ...ENV, CRON_SECRET: undefined } });

      expect((await h.handler(request({ 'x-cron-secret': '' }))).status).toBe(
        401,
      );
      expect(
        (await h.handler(request({ 'x-cron-secret': 'anything' }))).status,
      ).toBe(401);
      expect(h.calls).toEqual([]);
    });
  });

  describe('server configuration', () => {
    it.each([
      [
        'SUPABASE_URL is missing',
        { ...ENV, SUPABASE_URL: undefined },
        SECRET_KEY,
      ],
      ['SUPABASE_URL is blank', { ...ENV, SUPABASE_URL: '   ' }, SECRET_KEY],
      ['the secret key is missing', ENV, undefined],
    ])(
      'answers 500 after authorization when %s, before any client',
      async (_label, env, secretKey) => {
        const h = harness({ env, secretKey });

        const response = await h.handler(request());

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('Server configuration unavailable');
        expect(h.calls).toEqual([]);
      },
    );

    it('builds the admin client from the trimmed SUPABASE_URL and the secret key', async () => {
      const h = harness({
        env: { ...ENV, SUPABASE_URL: ' http://127.0.0.1:54321 ' },
      });

      await h.handler(request());

      expect(h.clients).toEqual([
        { url: 'http://127.0.0.1:54321', key: SECRET_KEY },
      ]);
    });
  });

  describe('lease', () => {
    it('skips the run without claiming when the lease is not acquired, and releases nothing', async () => {
      const h = harness({
        rpc: {
          fn_acquire_cron_lease: () => ({
            data: [{ acquired: false, lease_id: null }],
            error: null,
          }),
        },
      });

      const response = await h.handler(request());

      expect(await response.json()).toEqual({ received: true, skipped: true });
      expect(h.calls).toEqual(['client', LEASE_RPCS.acquire]);
      expect(h.rpcArgs('fn_acquire_cron_lease')).toEqual([
        { p_job: 'checkout_recovery' },
      ]);
    });

    it('claims twelve order shells then thirteen standalone shells under the lease, then releases it', async () => {
      const h = harness();

      const response = await h.handler(request());

      expect(await response.json()).toEqual({
        received: true,
        processed: 0,
        results: [],
      });
      expect(h.calls).toEqual([
        'client',
        LEASE_RPCS.acquire,
        LEASE_RPCS.claim,
        LEASE_RPCS.claim,
        LEASE_RPCS.release,
      ]);
      expect(h.rpcArgs('fn_claim_checkout_recovery_shells')).toEqual([
        {
          p_limit: 12,
          p_stripe_payment_intent_id: null,
          p_claim_scope: 'order',
        },
        {
          p_limit: 13,
          p_stripe_payment_intent_id: null,
          p_claim_scope: 'standalone',
        },
      ]);
      expect(h.rpcArgs('fn_release_cron_lease')).toEqual([
        { p_job: 'checkout_recovery', p_lease_id: LEASE_ID },
      ]);
      expect(warnings).toEqual([]);
    });

    it('releases the lease in finally when a claim fails, and does no Stripe work', async () => {
      const h = harness({
        rpc: {
          fn_claim_checkout_recovery_shells: (args) =>
            args.p_claim_scope === 'standalone'
              ? { data: null, error: { message: 'claim boom' } }
              : {
                  data: [
                    {
                      stripe_payment_intent_id: 'pi_1',
                      stripe_charge_id: 'ch_1',
                    },
                  ],
                  error: null,
                },
        },
      });

      await expect(h.handler(request())).rejects.toThrow(
        'CHECKOUT_RECOVERY_CLAIM_FAILED: claim boom',
      );
      expect(h.calls.at(-1)).toBe(LEASE_RPCS.release);
      expect(h.rpcArgs('fn_release_cron_lease')).toEqual([
        { p_job: 'checkout_recovery', p_lease_id: LEASE_ID },
      ]);
      expect(h.stripeCalls).toEqual([]);
    });

    it('warns instead of failing when this run no longer holds the lease', async () => {
      const h = harness({
        rpc: {
          fn_release_cron_lease: () => ({
            data: false,
            error: null,
          }),
        },
      });

      expect((await h.handler(request())).status).toBe(200);
      expect(warnings.map((line) => JSON.parse(line))).toEqual([
        {
          level: 'WARN',
          msg: 'Checkout recovery lease not released; it expires on its own',
          leaseId: LEASE_ID,
          reason: 'NOT_HOLDER',
        },
      ]);
    });
  });

  describe('refunds', () => {
    it('refunds a claim with stored charge evidence, reversing a destination transfer, then finalizes it', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' },
        ],
        charges: { ch_1: { transfer: 'tr_1' } },
      });

      const response = await h.handler(request());

      expect(await response.json()).toEqual({
        received: true,
        processed: 1,
        results: [{ kind: 'refunded', refundId: 're_pi_1' }],
      });
      expect(h.stripeCalls).toEqual([
        { method: 'charges.retrieve', args: ['ch_1'] },
        {
          method: 'refunds.create',
          args: [
            { payment_intent: 'pi_1', reverse_transfer: true },
            { idempotencyKey: 'pi_pi_1_recovery' },
          ],
        },
      ]);
      expect(h.rpcArgs('fn_finalize_checkout_recovery')).toEqual([
        { p_stripe_payment_intent_id: 'pi_1', p_stripe_refund_id: 're_pi_1' },
      ]);
      expect(h.rpcArgs('fn_set_checkout_recovery_charge_evidence')).toEqual([]);
    });

    it('refunds without reverse_transfer when the charge has no destination transfer', async () => {
      const h = harness({
        standaloneClaims: [
          { stripe_payment_intent_id: 'pi_2', stripe_charge_id: 'ch_2' },
        ],
        charges: { ch_2: { transfer: null } },
      });

      await h.handler(request());

      expect(
        h.stripeCalls.find((call) => call.method === 'refunds.create')?.args,
      ).toEqual([
        { payment_intent: 'pi_2' },
        { idempotencyKey: 'pi_pi_2_recovery' },
      ]);
    });

    it('derives missing charge evidence from the expanded PaymentIntent and refunds the charge the RPC persisted', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_3', stripe_charge_id: null },
        ],
        intents: { pi_3: { latest_charge: { id: 'ch_derived' } } },
        rpc: {
          fn_set_checkout_recovery_charge_evidence: () => ({
            data: 'ch_persisted',
            error: null,
          }),
        },
      });

      const response = await h.handler(request());

      expect((await response.json()).results).toEqual([
        { kind: 'refunded', refundId: 're_pi_3' },
      ]);
      expect(h.stripeCalls.slice(0, 2)).toEqual([
        {
          method: 'paymentIntents.retrieve',
          args: ['pi_3', { expand: ['latest_charge'] }],
        },
        { method: 'charges.retrieve', args: ['ch_persisted'] },
      ]);
      expect(h.rpcArgs('fn_set_checkout_recovery_charge_evidence')).toEqual([
        {
          p_stripe_payment_intent_id: 'pi_3',
          p_stripe_charge_id: 'ch_derived',
        },
      ]);
      expect(
        h.calls.indexOf('rpc:fn_set_checkout_recovery_charge_evidence'),
      ).toBeLessThan(h.calls.indexOf('stripe:refunds.create:pi_3'));
    });

    it.each([
      [
        'an empty charge id',
        { data: '', error: null },
        'CHECKOUT_RECOVERY_EVIDENCE_PERSIST_EMPTY',
      ],
      [
        'no charge id',
        { data: null, error: null },
        'CHECKOUT_RECOVERY_EVIDENCE_PERSIST_EMPTY',
      ],
      [
        'an error',
        { data: null, error: { message: 'write failed' } },
        'CHECKOUT_RECOVERY_EVIDENCE_PERSIST_FAILED: write failed',
      ],
    ])(
      'checks the evidence RPC result with RecoveryChargeEvidenceSchema: %s stops the run before any refund',
      async (_label, evidence, message) => {
        const h = harness({
          orderClaims: [
            { stripe_payment_intent_id: 'pi_4', stripe_charge_id: null },
          ],
          intents: { pi_4: { latest_charge: 'ch_4' } },
          rpc: { fn_set_checkout_recovery_charge_evidence: () => evidence },
        });

        await expect(h.handler(request())).rejects.toThrow(message);
        expect(h.stripeCalls.map((call) => call.method)).toEqual([
          'paymentIntents.retrieve',
        ]);
        expect(h.calls.at(-1)).toBe(LEASE_RPCS.release);
      },
    );

    it('marks a claim without any charge evidence for reconciliation and never refunds it', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_5', stripe_charge_id: null },
        ],
        intents: { pi_5: { latest_charge: null } },
      });

      const response = await h.handler(request());

      expect((await response.json()).results).toEqual([
        { kind: 'reconciliation_needed', reason: 'missing_charge_evidence' },
      ]);
      expect(
        h.rpcArgs('fn_mark_checkout_recovery_reconciliation_needed'),
      ).toEqual([
        {
          p_stripe_payment_intent_id: 'pi_5',
          p_error: 'STANDALONE_CHARGE_EVIDENCE_MISSING',
        },
      ]);
      expect(h.stripeCalls.map((call) => call.method)).toEqual([
        'paymentIntents.retrieve',
      ]);
      expect(h.rpcArgs('fn_finalize_checkout_recovery')).toEqual([]);
    });

    it('stops the run when the reconciliation mark fails', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_6', stripe_charge_id: null },
        ],
        rpc: {
          fn_mark_checkout_recovery_reconciliation_needed: () => ({
            data: null,
            error: { message: 'mark failed' },
          }),
        },
      });

      await expect(h.handler(request())).rejects.toThrow(
        'CHECKOUT_RECOVERY_RECONCILIATION_MARK_FAILED: mark failed',
      );
    });

    it('queues a retry without finalizing when Stripe does not confirm the refund', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_7', stripe_charge_id: 'ch_7' },
        ],
        refundStatus: 'pending',
      });

      const response = await h.handler(request());

      expect((await response.json()).results).toEqual([
        { kind: 'retry_queued' },
      ]);
      expect(h.rpcArgs('fn_mark_checkout_recovery_retry')).toEqual([
        {
          p_stripe_payment_intent_id: 'pi_7',
          p_error: 'STRIPE_REFUND_NOT_CONFIRMED:pending',
        },
      ]);
      expect(h.rpcArgs('fn_finalize_checkout_recovery')).toEqual([]);
    });

    it('queues a retry when finalizing fails after the refund', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_8', stripe_charge_id: 'ch_8' },
        ],
        rpc: {
          fn_finalize_checkout_recovery: () => ({
            data: null,
            error: { message: 'finalize failed' },
          }),
        },
      });

      const response = await h.handler(request());

      expect((await response.json()).results).toEqual([
        { kind: 'retry_queued' },
      ]);
      expect(h.rpcArgs('fn_mark_checkout_recovery_retry')).toEqual([
        {
          p_stripe_payment_intent_id: 'pi_8',
          p_error: 'CHECKOUT_RECOVERY_FINALIZE_FAILED: finalize failed',
        },
      ]);
    });

    it('stops the run when queueing the retry fails', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_9', stripe_charge_id: 'ch_9' },
        ],
        refundStatus: 'failed',
        rpc: {
          fn_mark_checkout_recovery_retry: () => ({
            data: null,
            error: { message: 'queue failed' },
          }),
        },
      });

      await expect(h.handler(request())).rejects.toThrow(
        'CHECKOUT_RECOVERY_RETRY_QUEUE_FAILED: queue failed',
      );
    });

    it('finishes each claim before starting the next, order claims first', async () => {
      const h = harness({
        orderClaims: [
          { stripe_payment_intent_id: 'pi_a', stripe_charge_id: 'ch_a' },
        ],
        standaloneClaims: [
          { stripe_payment_intent_id: 'pi_b', stripe_charge_id: 'ch_b' },
        ],
      });

      const response = await h.handler(request());

      expect((await response.json()).processed).toBe(2);
      expect(h.calls).toEqual([
        'client',
        LEASE_RPCS.acquire,
        LEASE_RPCS.claim,
        LEASE_RPCS.claim,
        'stripe:charges.retrieve:ch_a',
        'stripe:refunds.create:pi_a',
        'rpc:fn_finalize_checkout_recovery',
        'stripe:charges.retrieve:ch_b',
        'stripe:refunds.create:pi_b',
        'rpc:fn_finalize_checkout_recovery',
        LEASE_RPCS.release,
      ]);
    });
  });
});

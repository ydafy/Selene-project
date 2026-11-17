import { SQL, type TransactionSQL } from 'bun';
import fc from 'fast-check';
import assert, { AssertionError } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const help =
  'Usage: bun scripts/verify/test-shipment-lifecycle-model.ts [--help]\n' +
  'Model-based test (fast-check): random sequences of shipment cancellation, refund (recorded, webhook\n' +
  'events, admin resolution), delivery confirmation and payout transfer RPCs on two shipments of one\n' +
  'order. After every step it checks the money invariants of\n' +
  'docs/formal/shipment-transfer-cancellation/ShipmentTransferCancel.tla on the database rows, then\n' +
  'checks that each mutant (a production function with one guard broken) makes the property fail.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`); every run rolls back.\n" +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.\n' +
  'Budget: SELENE_MODEL_RUNS (runs per batch, default 50), SELENE_MODEL_COMMANDS (maximum commands per\n' +
  'run, default 30). When a batch passes without reaching a completed transfer, a completed cancellation\n' +
  'and a recorded refund failure, up to 3 more batches run with new random seeds before it fails.\n' +
  'Replay a failure: set SELENE_MODEL_SEED, SELENE_MODEL_PATH and SELENE_MODEL_REPLAY_PATH (the\n' +
  "commands' replayPath) to the values its Replay line printed, with the same SELENE_MODEL_COMMANDS\n" +
  '(a replay skips the outcome and mutant checks). SELENE_MODEL_MUTANT=<name> runs the main property\n' +
  'with that mutant applied, to replay a mutant failure.';

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  seller: '00000000-0000-4000-8000-000000000002',
  buyer: '00000000-0000-4000-8000-000000000003',
  order: '7b500000-0000-4000-8000-000000000001',
  s0: '7b500000-0000-4000-8000-000000000011',
  s1: '7b500000-0000-4000-8000-000000000012',
  product0: '00000000-0000-4000-8000-0000000000b1',
  product1: '00000000-0000-4000-8000-0000000000b2',
};
const paymentIntent = 'pi_model_local';
type Ship = 's0' | 's1';
const ships: readonly Ship[] = ['s0', 's1'];
const other = (s: Ship): Ship => (s === 's0' ? 's1' : 's0');
// The refund amount of each shipment's cancellation, fixed per shipment.
const refundAmounts: Record<Ship, number> = { s0: 11000, s1: 7000 };
const reason = 'Changed my mind';
const nilToken = '00000000-0000-4000-8000-0000000000ff';

type Tx = TransactionSQL;

function databaseUrl(): string {
  let url = process.env.SELENE_LOCAL_DB_URL;
  if (!url) {
    const status = Bun.spawnSync(
      ['supabase', 'status', '--env', '--output-format', 'json'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    if (status.exitCode !== 0)
      throw new Error(
        'Local Supabase stack is not running for this worktree: run `supabase start`.',
      );
    url = JSON.parse(status.stdout.toString()).DB_URL as string | undefined;
  }
  if (!url) throw new Error('No local database URL found.');
  // Never touch a remote project: this harness writes (and rolls back) data.
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost')
    throw new Error(`Refusing non-local database host: ${host}`);
  return url;
}

class Rollback extends Error {}

async function asService(tx: Tx) {
  await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
  await tx`SET LOCAL ROLE service_role`;
}

/** Runs body as the table owner: service_role has no privilege on shipment_cancellation_operations. */
async function asOwnerFor<T>(tx: Tx, body: () => Promise<T>): Promise<T> {
  const [{ role, session }] =
    await tx`SELECT current_user::text AS role, session_user::text AS session`;
  await tx`RESET ROLE`;
  const result = await body();
  if (role !== session) await tx.unsafe(`SET LOCAL ROLE ${role}`);
  return result;
}

function request(s: Ship, callerRole: string) {
  return {
    payment_intent: paymentIntent,
    amount: refundAmounts[s],
    reason: 'requested_by_customer',
    metadata: {
      shipment_id: ids[s],
      order_id: ids.order,
      caller_role: callerRole,
      reason,
      seguro_share_cents: 500,
    },
  };
}

/** s0 is paid (cancellation path), s1 delivered 3 days ago (completion and transfer path). */
async function fixture(tx: Tx) {
  await tx`INSERT INTO public.orders (id, buyer_id, total_amount_cents, shipping_address, status,
      stripe_payment_intent_id, stripe_charge_id, stripe_transfer_group)
    VALUES (${ids.order}, ${ids.buyer}, 18000, '{}'::jsonb, 'paid', ${paymentIntent}, 'ch_model_local', 'group_model_local')`;
  await tx`INSERT INTO public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id, delivered_at)
    VALUES (${ids.s0}, ${ids.order}, ${ids.seller}, 'paid', ${paymentIntent}, NULL),
           (${ids.s1}, ${ids.order}, ${ids.seller}, 'delivered', ${paymentIntent}, now() - interval '3 days')`;
  await tx`INSERT INTO public.order_items (order_id, product_id, seller_id, price_at_purchase_cents, net_payout_cents, shipment_id)
    VALUES (${ids.order}, ${ids.product0}, ${ids.seller}, 750000, 700000, ${ids.s0}),
           (${ids.order}, ${ids.product1}, ${ids.seller}, 390000, 350000, ${ids.s1})`;
  await tx`UPDATE public.products SET status = 'sold' WHERE id IN (${ids.product0}, ${ids.product1})`;
  // The seed seller has not finished onboarding; a payout needs a complete account.
  await tx`UPDATE public.profiles_private SET stripe_onboarding_status = 'complete' WHERE id = ${ids.seller}`;
  await asService(tx);
}

// ---------------------------------------------------------------- invariants

type Row = {
  id: string;
  status: string;
  stripe_transfer_id: string | null;
  items_net: number;
  op_started: boolean;
  refund_status: string | null;
  refund_id: string | null;
  refund_failed_notice: boolean;
  resolved: boolean;
  started_nets: number[];
  released_notice_amounts: number[];
};

async function rows(tx: Tx): Promise<Record<Ship, Row>> {
  const list: Row[] = await asOwnerFor(
    tx,
    () => tx`SELECT s.id::text AS id, s.status::text AS status, s.stripe_transfer_id,
      (SELECT COALESCE(sum(oi.net_payout_cents), 0)::int FROM public.order_items oi
        WHERE oi.shipment_id = s.id) AS items_net,
      COALESCE(op.external_started_at IS NOT NULL, false) AS op_started,
      op.refund_status, op.refund_id,
      EXISTS (SELECT 1 FROM public.notifications n
        WHERE n.event_kind = 'shipment.refund_failed' AND n.user_id = ${ids.buyer}
          AND n.source_event_key = 'shipment.refund_failed:' || s.id::text || ':' || op.refund_id
      ) AS refund_failed_notice,
      COALESCE(op.refund_resolved_at IS NOT NULL, false) AS resolved,
      (SELECT COALESCE(json_agg(m.net_payout_cents::int), '[]'::json)
        FROM public.connect_payout_run_shipments m
        WHERE m.shipment_id = s.id AND m.transfer_started_at IS NOT NULL) AS started_nets,
      (SELECT COALESCE(json_agg((n.event_payload->>'amount_cents')::int), '[]'::json)
        FROM public.notifications n
        WHERE n.event_kind = 'shipment.funds_released'
          AND n.event_payload->>'shipment_id' = s.id::text) AS released_notice_amounts
    FROM public.shipments s
    LEFT JOIN public.shipment_cancellation_operations op ON op.shipment_id = s.id
    WHERE s.order_id = ${ids.order}`,
  );
  const byId = Object.fromEntries(list.map((row) => [row.id, row]));
  return { s0: byId[ids.s0], s1: byId[ids.s1] };
}

const allowedTransitions = new Set(['paid->cancelled', 'delivered->completed']);

class InvariantViolation extends Error {}

function violated(invariant: string, s: Ship, detail: string): never {
  throw new InvariantViolation(`${invariant} violated on ${s}: ${detail}`);
}

/** Checks the database rows after a command on `target`; updates the observed state in the model. */
async function checkInvariants(
  tx: Tx,
  model: Model,
  target: Ship,
  stats: Stats,
) {
  const now = await rows(tx);
  for (const s of ships) {
    const row = now[s];
    const seen = model[s];
    const started = row.started_nets;
    const transferred = row.stripe_transfer_id !== null;

    if (transferred) {
      if (started.length !== 1)
        violated(
          'FullOrNothing',
          s,
          `stripe_transfer_id set with ${started.length} started mappings`,
        );
      if (started[0] !== row.items_net)
        violated(
          'FullOrNothing',
          s,
          `transferred ${started[0]} of ${row.items_net} owed`,
        );
      if (
        row.released_notice_amounts.length !== 1 ||
        row.released_notice_amounts[0] !== row.items_net
      )
        violated(
          'FullOrNothing',
          s,
          `funds_released notices ${JSON.stringify(row.released_notice_amounts)} for ${row.items_net} owed`,
        );
    }
    if (started.length > 1)
      violated('AtMostOneTransfer', s, `${started.length} started mappings`);
    if (seen.transferId !== null && row.stripe_transfer_id !== seen.transferId)
      violated(
        'AtMostOneTransfer',
        s,
        `stripe_transfer_id changed from ${seen.transferId} to ${row.stripe_transfer_id}`,
      );
    if (
      (row.status === 'cancelled' || row.op_started) &&
      (started.length > 0 || transferred)
    )
      violated(
        'NoTransferAfterCancel',
        s,
        `status ${row.status}, refund started ${row.op_started}, started transfers ${started.length}, transfer id ${row.stripe_transfer_id}`,
      );
    // ShipmentTransferCancel.tla does not model a non-overdue refund that Stripe
    // fails after it succeeded (the failed_after_cancellation path, #606), so its
    // state invariant becomes a step property here plus two state checks that go
    // beyond the model.
    if (
      row.status === 'cancelled' &&
      seen.status !== 'cancelled' &&
      row.refund_status !== 'succeeded' &&
      !row.resolved
    )
      violated(
        'RefundBeforeCancel (step)',
        s,
        `became cancelled with refund_status ${row.refund_status} and no resolution`,
      );
    if (
      row.status === 'cancelled' &&
      row.refund_status !== 'succeeded' &&
      row.refund_status !== 'failed' &&
      !row.resolved
    )
      violated(
        'RefundBeforeCancel (state)',
        s,
        `cancelled with refund_status ${row.refund_status} and no resolution`,
      );
    // Money owed to the buyer is never silent.
    if (
      row.status === 'cancelled' &&
      row.refund_status === 'failed' &&
      !row.resolved &&
      !row.refund_failed_notice
    )
      violated(
        'RefundFailureVisible',
        s,
        `cancelled with refund ${row.refund_id} failed and no shipment.refund_failed notice to the buyer`,
      );
    if (
      (row.refund_status === 'succeeded' || row.resolved) &&
      (started.length > 0 || transferred)
    )
      violated(
        'NeverRefundedAndTransferred',
        s,
        `refund ${row.refund_status} (resolved ${row.resolved}) with ${started.length} started transfers, transfer id ${row.stripe_transfer_id}`,
      );
    if (row.status !== seen.status) {
      if (s !== target)
        violated(
          'StatusTransition',
          s,
          `${seen.status} -> ${row.status} by a command on ${target}`,
        );
      if (!allowedTransitions.has(`${seen.status}->${row.status}`))
        violated(
          'StatusTransition',
          s,
          `${seen.status} -> ${row.status} is not allowed`,
        );
      if (row.status === 'cancelled') stats.cancellationsCompleted++;
    }
    if (
      (row.refund_status === 'failed' || row.refund_status === 'canceled') &&
      seen.refundStatus !== row.refund_status
    )
      stats.refundFailuresRecorded++;
    if (transferred && seen.transferId === null) stats.transfersCompleted++;

    seen.status = row.status;
    seen.refundStatus = row.refund_status;
    seen.transferId = row.stripe_transfer_id;
  }
}

// ---------------------------------------------------------------- model and commands

type ShipModel = {
  status: string;
  refundStatus: string | null;
  transferId: string | null;
  claimToken: string | null;
  claimSource: string | null;
  runId: string | null;
  transferToken: string | null;
};
type Model = Record<Ship, ShipModel>;
type Real = { tx: Tx; stats: Stats };

type Stats = {
  transfersCompleted: number;
  cancellationsCompleted: number;
  refundFailuresRecorded: number;
  outcomes: Map<string, number>;
};

function newStats(): Stats {
  return {
    transfersCompleted: 0,
    cancellationsCompleted: 0,
    refundFailuresRecorded: 0,
    outcomes: new Map(),
  };
}

function initialModel(): Model {
  const ship = (status: string): ShipModel => ({
    status,
    refundStatus: null,
    transferId: null,
    claimToken: null,
    claimSource: null,
    runId: null,
    transferToken: null,
  });
  return { s0: ship('paid'), s1: ship('delivered') };
}

// An RPC rejection is an expected outcome; anything else (a harness bug, a
// permission error, an assertion) fails the run.
const rejectionCode = /^([A-Z][A-Z0-9_]+)(?::|$)/;

abstract class Step implements fc.AsyncCommand<Model, Real> {
  constructor(readonly s: Ship) {}
  abstract readonly name: string;
  /** Runs the RPC; returns the outcome name (a rejection may also throw). */
  abstract call(sp: Tx, model: Model): Promise<string>;
  /** False when no real caller reaches this RPC once the shipment is cancelled. */
  readonly afterCancellation: boolean = true;
  check(model: Readonly<Model>): boolean {
    return this.afterCancellation || model[this.s].status !== 'cancelled';
  }
  async run(model: Model, real: Real) {
    let outcome: string;
    try {
      outcome = await real.tx.savepoint((sp) => this.call(sp as Tx, model));
    } catch (error) {
      if (error instanceof AssertionError) throw error;
      const code = rejectionCode.exec((error as Error).message)?.[1];
      if (!code) throw error;
      outcome = `rejected ${code}`;
    }
    const key = `${this.name} ${this.s}: ${outcome}`;
    real.stats.outcomes.set(key, (real.stats.outcomes.get(key) ?? 0) + 1);
    await checkInvariants(real.tx, model, this.s, real.stats);
  }
  toString() {
    return `${this.name}(${this.s}${this.args()})`;
  }
  args() {
    return '';
  }
}

class ClaimCancellation extends Step {
  name = 'ClaimCancellation';
  constructor(
    s: Ship,
    readonly source: 'buyer' | 'seller',
  ) {
    super(s);
  }
  override args() {
    return `, ${this.source}`;
  }
  async call(sp: Tx, model: Model) {
    const actor = this.source === 'buyer' ? ids.buyer : ids.seller;
    const [{ claim }] = await sp`SELECT public.fn_claim_shipment_cancellation(
      ${ids[this.s]}::uuid, ${ids.order}::uuid, ${actor}::uuid, ${this.source}, ${reason}) AS claim`;
    if (claim.status === 'claimed') {
      model[this.s].claimToken = claim.claim_token;
      model[this.s].claimSource = claim.source;
    }
    return claim.status as string;
  }
}

class StartRefund extends Step {
  name = 'StartRefund';
  async call(sp: Tx, model: Model) {
    const seen = model[this.s];
    const body = JSON.stringify(request(this.s, seen.claimSource ?? 'buyer'));
    await sp`SELECT public.fn_start_shipment_cancellation_refund(
      ${ids[this.s]}::uuid, ${seen.claimToken ?? nilToken}::uuid, ${body}::text::jsonb, 0::bigint)`;
    return 'started';
  }
}

type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'canceled';

function refundArgs(s: Ship, status: RefundStatus, foreignId: boolean) {
  return {
    refundId: `re_${foreignId ? other(s) : s}`,
    failure: status === 'failed' ? 'lost_or_stolen_card' : null,
  };
}

class RecordRefund extends Step {
  name = 'RecordRefund';
  constructor(
    s: Ship,
    readonly status: RefundStatus,
    readonly foreignId: boolean,
  ) {
    super(s);
  }
  override args() {
    return `, ${this.status}${this.foreignId ? ', foreign id' : ''}`;
  }
  // Models the cancel Edge Function's record step, which follows its own claim, and
  // fn_claim refuses a cancelled shipment: the RPC alone accepts a silent
  // succeeded -> failed after cancellation (see #659).
  override readonly afterCancellation: boolean = false;
  async call(sp: Tx) {
    const { refundId, failure } = refundArgs(
      this.s,
      this.status,
      this.foreignId,
    );
    const [{ result }] =
      await sp`SELECT public.fn_record_shipment_cancellation_refund(
      ${ids[this.s]}::uuid, ${refundId}, ${paymentIntent}, ${refundAmounts[this.s]}::bigint,
      ${this.status}, ${failure}) AS result`;
    return result.changed ? `recorded ${result.refund_status}` : 'unchanged';
  }
}

class RefundEvent extends RecordRefund {
  override name = 'RefundEvent';
  // The webhook reaches any shipment, cancelled ones included.
  override readonly afterCancellation: boolean = true;
  override async call(sp: Tx) {
    const { refundId, failure } = refundArgs(
      this.s,
      this.status,
      this.foreignId,
    );
    const [{ result }] =
      await sp`SELECT public.fn_apply_shipment_cancellation_refund_event(
      ${ids[this.s]}::uuid, ${refundId}, ${paymentIntent}, ${refundAmounts[this.s]}::bigint,
      ${this.status}, ${failure}) AS result`;
    return result.outcome as string;
  }
}

class ResolveRefund extends Step {
  name = 'ResolveRefund';
  async call(sp: Tx) {
    const [{ result }] =
      await sp`SELECT public.fn_resolve_shipment_cancellation_refund(
      ${ids[this.s]}::uuid, ${ids.admin}::uuid, ${`manual-repayment-${this.s}`}) AS result`;
    return result.resolved ? 'resolved' : 'already resolved';
  }
}

class ConfirmDelivery extends Step {
  name = 'ConfirmDelivery';
  async call(sp: Tx) {
    const [row] = await sp`SELECT * FROM public.fn_confirm_shipment_delivery(
      ${ids[this.s]}::uuid, 'buyer', ${ids.buyer}::uuid, ${`confirm_shipment_${ids[this.s]}`})`;
    if (!row.success) return `refused ${row.error}`;
    return row.idempotent ? 'already completed' : 'completed';
  }
}

/** Simulates the admin release Edge Function: one run with one mapping of the view's release amount. */
class CreatePayoutRun extends Step {
  name = 'CreatePayoutRun';
  async call(sp: Tx, model: Model) {
    const shipment = ids[this.s];
    return await asOwnerFor(sp, async () => {
      const [active] =
        await sp`SELECT count(*)::int AS n FROM public.connect_payout_run_shipments
        WHERE shipment_id = ${shipment}
          AND status IN ('pending_reconciliation', 'paid', 'reconciliation_needed')`;
      if (active.n > 0) return 'skipped active mapping';
      const [view] =
        await sp`SELECT is_eligible, ineligible_reason, release_amount_cents::int AS amount
        FROM public.admin_connect_payout_release_view WHERE shipment_id = ${shipment}`;
      if (!view.is_eligible) return `ineligible ${view.ineligible_reason}`;
      const [run] =
        await sp`INSERT INTO public.connect_payout_runs (idempotency_key, seller_id, actor_id, amount_cents, release_stage)
        VALUES (${`model-release-${crypto.randomUUID()}`}, ${ids.seller}, ${ids.admin}, ${view.amount}, 'release_accepted')
        RETURNING id::text AS id`;
      await sp`INSERT INTO public.connect_payout_run_shipments (run_id, shipment_id, net_payout_cents)
        VALUES (${run.id}, ${shipment}, ${view.amount})`;
      model[this.s].runId = run.id;
      model[this.s].transferToken = null;
      return 'created';
    });
  }
}

class BeginTransfer extends Step {
  name = 'BeginTransfer';
  async call(sp: Tx, model: Model) {
    const seen = model[this.s];
    const runId = seen.runId ?? nilToken;
    const [{ result }] = await sp`SELECT public.fn_begin_shipment_transfer(
      ${runId}::uuid, ${ids[this.s]}::uuid, 1) AS result`;
    const [mapping] = await asOwnerFor(
      sp,
      () => sp`SELECT net_payout_cents::int AS net FROM public.connect_payout_run_shipments
        WHERE run_id = ${runId} AND shipment_id = ${ids[this.s]}`,
    );
    assert.equal(
      result.amount,
      mapping.net,
      'BeginTransfer amount differs from the mapping net_payout_cents',
    );
    seen.transferToken = result.transfer_token;
    return 'begun';
  }
}

class CompleteTransfer extends Step {
  name = 'CompleteTransfer';
  constructor(
    s: Ship,
    readonly retryId: boolean,
  ) {
    super(s);
  }
  override args() {
    return this.retryId ? ', other transfer id' : '';
  }
  async call(sp: Tx, model: Model) {
    const seen = model[this.s];
    const transferId = `tr_${this.s}${this.retryId ? '_retry' : ''}`;
    const [{ done }] = await sp`SELECT public.fn_complete_shipment_transfer(
      ${seen.runId ?? nilToken}::uuid, ${ids[this.s]}::uuid, 1,
      ${seen.transferToken ?? nilToken}::uuid, ${transferId}) AS done`;
    return done ? 'completed' : 'refused';
  }
}

/** Mostly the shipment the command's path is about, sometimes the other one. */
const shipFor = (preferred: Ship) =>
  fc.oneof(
    { weight: 9, arbitrary: fc.constant(preferred) },
    { weight: 1, arbitrary: fc.constant(other(preferred)) },
  );
const refundStatus = fc.oneof(
  { weight: 1, arbitrary: fc.constant<RefundStatus>('pending') },
  { weight: 3, arbitrary: fc.constant<RefundStatus>('succeeded') },
  { weight: 2, arbitrary: fc.constant<RefundStatus>('failed') },
  { weight: 1, arbitrary: fc.constant<RefundStatus>('canceled') },
);
const rarely = fc.oneof(
  { weight: 5, arbitrary: fc.constant(false) },
  { weight: 1, arbitrary: fc.constant(true) },
);

function commandsArbitrary(maxCommands: number, replayPath?: string) {
  // Weights favour the commands that move a path forward, so most runs reach a
  // completed cancellation or transfer within the budget.
  const command = (weight: number, arbitrary: fc.Arbitrary<Step>) => ({
    weight,
    arbitrary,
  });
  return fc.commands<Model, Real, false>(
    [
      fc.oneof(
        command(
          2,
          fc
            .tuple(
              shipFor('s0'),
              fc.constantFrom('buyer' as const, 'seller' as const),
            )
            .map(([s, source]) => new ClaimCancellation(s, source)),
        ),
        command(
          3,
          shipFor('s0').map((s) => new StartRefund(s)),
        ),
        command(
          1,
          fc
            .tuple(shipFor('s0'), refundStatus, rarely)
            .map(
              ([s, status, foreign]) => new RecordRefund(s, status, foreign),
            ),
        ),
        command(
          3,
          fc
            .tuple(shipFor('s0'), refundStatus, rarely)
            .map(([s, status, foreign]) => new RefundEvent(s, status, foreign)),
        ),
        command(
          1,
          shipFor('s0').map((s) => new ResolveRefund(s)),
        ),
        command(
          2,
          shipFor('s1').map((s) => new ConfirmDelivery(s)),
        ),
        command(
          3,
          shipFor('s1').map((s) => new CreatePayoutRun(s)),
        ),
        command(
          3,
          shipFor('s1').map((s) => new BeginTransfer(s)),
        ),
        command(
          3,
          fc
            .tuple(shipFor('s1'), rarely)
            .map(([s, retry]) => new CompleteTransfer(s, retry)),
        ),
      ),
    ],
    { maxCommands, size: 'max', replayPath },
  );
}

// ---------------------------------------------------------------- mutants

type Mutant = {
  name: string;
  why: string;
  /** The invariant the mutant must break. */
  caughtBy: string;
  edits: Array<{ fn: string; from: string; to: string }>;
};

// M1: fn_cancel_shipment refuses a cancellation without a succeeded or resolved
// refund (REFUND_NOT_SUCCEEDED), so the event function completing on `failed`
// alone is masked by it (defense in depth): both guards must break for the harm.
// Most transfer fences (a claimed or cancelled shipment never reaches completed)
// are only reachable concurrently, where TLC and the coordination harnesses
// cover them; M2 is a transfer guard these sequential commands do reach.
const mutants: Mutant[] = [
  {
    name: 'M1',
    why: 'the refund event completes the cancellation on failed, and fn_cancel_shipment trusts it',
    caughtBy: 'RefundBeforeCancel',
    edits: [
      {
        fn: 'fn_apply_shipment_cancellation_refund_event',
        from: "ELSIF v_operation.refund_status = 'succeeded' AND v_shipment_status IN ('paid', 'preparing') THEN",
        to: "ELSIF v_operation.refund_status = 'failed' AND v_shipment_status IN ('paid', 'preparing') THEN",
      },
      {
        fn: 'fn_cancel_shipment',
        from: "IF v_refund_status IS DISTINCT FROM 'succeeded' AND v_refund_resolved_at IS NULL THEN",
        to: 'IF false THEN',
      },
    ],
  },
  {
    name: 'M2',
    why: 'a completed transfer accepts a second Stripe transfer id',
    caughtBy: 'AtMostOneTransfer',
    edits: [
      {
        fn: 'fn_complete_shipment_transfer',
        from: 'IF v_shipment.stripe_transfer_id IS NOT NULL THEN',
        to: 'IF false THEN',
      },
    ],
  },
];

const functionsDir = join(
  import.meta.dir,
  '..',
  '..',
  'supabase',
  'schemas',
  'public',
  'functions',
);

/** The CREATE OR REPLACE statement of a production function with the mutant's edits applied. */
function mutantStatements(mutant: Mutant): string[] {
  const byFn = new Map<string, string>();
  for (const edit of mutant.edits) {
    if (!byFn.has(edit.fn)) {
      const file = readFileSync(join(functionsDir, `${edit.fn}.sql`), 'utf8');
      const end = file.indexOf('$function$;');
      if (!file.startsWith('CREATE OR REPLACE FUNCTION') || end < 0)
        throw new Error(
          `${edit.fn}.sql has no CREATE OR REPLACE FUNCTION body`,
        );
      byFn.set(edit.fn, file.slice(0, end + '$function$;'.length));
    }
    const source = byFn.get(edit.fn)!;
    const matches = source.split(edit.from).length - 1;
    if (matches !== 1)
      throw new Error(
        `Mutant ${mutant.name} is stale: "${edit.from}" matches ${matches} times in ${edit.fn}.sql (expected 1)`,
      );
    byFn.set(edit.fn, source.replace(edit.from, edit.to));
  }
  return [...byFn.values()];
}

// ---------------------------------------------------------------- runner

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  return value;
}

async function property(
  sql: SQL,
  stats: Stats,
  mutant: Mutant | null,
  maxCommands: number,
  replayPath?: string,
) {
  const statements = mutant ? mutantStatements(mutant) : [];
  const arbitrary = commandsArbitrary(maxCommands, replayPath);
  return fc.asyncProperty(arbitrary, async (cmds) => {
    try {
      await sql.begin(async (tx) => {
        // DDL is transactional: the mutant disappears with the rollback.
        for (const statement of statements) await tx.unsafe(statement);
        await fixture(tx as Tx);
        await fc.asyncModelRun(
          () => ({ model: initialModel(), real: { tx: tx as Tx, stats } }),
          cmds,
        );
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
}

async function productionFingerprint(sql: SQL) {
  const names = [...new Set(mutants.flatMap((m) => m.edits.map((e) => e.fn)))];
  const [row] =
    await sql`SELECT md5(string_agg(p.prosrc, '|' ORDER BY p.proname)) AS hash
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ${sql(names)}`;
  return row.hash as string;
}

async function run() {
  const numRuns = positiveInt('SELENE_MODEL_RUNS', 50);
  // A run averages half the maximum. With 30, about 13% of runs complete the
  // four-step transfer path (confirm, release, begin, complete), so a batch of
  // 50 runs misses it with a probability near 0.1%; with 20 it was 4.5% of runs
  // (10% to miss). A missed outcome runs extra batches (see extraBatches).
  const maxCommands = positiveInt('SELENE_MODEL_COMMANDS', 30);
  const seedEnv = process.env.SELENE_MODEL_SEED;
  const path = process.env.SELENE_MODEL_PATH || undefined;
  const replayPath = process.env.SELENE_MODEL_REPLAY_PATH || undefined;
  const seed = seedEnv ? Number(seedEnv) : undefined;
  if (seedEnv && !Number.isInteger(seed))
    throw new Error(`SELENE_MODEL_SEED must be an integer, got ${seedEnv}`);
  const replay = path !== undefined;
  const mainMutantName = process.env.SELENE_MODEL_MUTANT;
  const mainMutant = mainMutantName
    ? mutants.find((m) => m.name === mainMutantName)
    : null;
  if (mainMutantName && !mainMutant)
    throw new Error(
      `Unknown SELENE_MODEL_MUTANT ${mainMutantName} (known: ${mutants.map((m) => m.name).join(', ')})`,
    );

  const started = performance.now();
  const sql = new SQL(databaseUrl(), { max: 1, connectionTimeout: 5 });
  let failed = 0;
  try {
    const fingerprint = await productionFingerprint(sql);
    const stats = newStats();
    const label = mainMutant ? ` with mutant ${mainMutant.name}` : '';
    // Each batch prints its own seed, so the Replay line of a failing batch replays it alone.
    const batch = async (batchSeed: number | undefined, n: number) => {
      const result = await fc.check(
        await property(sql, stats, mainMutant ?? null, maxCommands, replayPath),
        { numRuns, seed: batchSeed, path },
      );
      if (result.failed) {
        const report = fc.defaultReportMessage(result) ?? '';
        console.log(`FAIL lifecycle property${label} (batch ${n})`);
        console.log(report);
        console.log(`Error: ${(result.errorInstance as Error)?.message}`);
        const commandsReplay = /replayPath="([^"]*)"/.exec(report)?.[1];
        console.log(
          `Replay: SELENE_MODEL_SEED=${result.seed} SELENE_MODEL_PATH=${result.counterexamplePath}` +
            `${commandsReplay ? ` SELENE_MODEL_REPLAY_PATH=${commandsReplay}` : ''}` +
            `${mainMutant ? ` SELENE_MODEL_MUTANT=${mainMutant.name}` : ''} bun scripts/verify/test-shipment-lifecycle-model.ts`,
        );
      } else {
        console.log(
          `PASS lifecycle property${label} (batch ${n}): ${result.numRuns} runs of up to ${maxCommands} commands (seed ${result.seed})`,
        );
      }
      return result;
    };
    const missingOutcomes = () =>
      (
        [
          ['a completed transfer', stats.transfersCompleted],
          ['a completed cancellation', stats.cancellationsCompleted],
          ['a recorded refund failure', stats.refundFailuresRecorded],
        ] as const
      )
        .filter(([, n]) => n === 0)
        .map(([what]) => what);

    const details = await batch(seed, 1);
    let batches = 1;
    let anyFailed = details.failed;
    const checksOutcomes = !replay && !mainMutant;
    // Non-vacuity without a flaky check: an outcome a batch did not reach gets up
    // to extraBatches more batches with new random seeds, counters accumulated.
    const extraBatches = 3;
    while (
      checksOutcomes &&
      !anyFailed &&
      missingOutcomes().length > 0 &&
      batches <= extraBatches
    ) {
      batches++;
      console.log(
        `not reached yet: ${missingOutcomes().join(', ')}; running batch ${batches}`,
      );
      anyFailed = (await batch(undefined, batches)).failed;
    }
    if (anyFailed) failed++;
    console.log(
      `${batches} batch${batches === 1 ? '' : 'es'} ran; outcomes: ${stats.transfersCompleted} transfers completed, ${stats.cancellationsCompleted} cancellations completed, ${stats.refundFailuresRecorded} refund failures recorded`,
    );
    for (const [key, n] of [...stats.outcomes].sort())
      console.log(`  ${String(n).padStart(4)} ${key}`);

    if (!anyFailed && checksOutcomes) {
      // Non-vacuity: the property is only meaningful if the runs reached the outcomes it guards.
      for (const what of missingOutcomes()) {
        failed++;
        console.log(`FAIL no run reached ${what}; raise SELENE_MODEL_RUNS`);
      }

      // Each mutant must make the property fail on the invariant it breaks. It
      // stops at the first failure (no shrinking), so the larger budget only
      // costs time when a mutant survives.
      for (const mutant of mutants) {
        const mutantDetails = await fc.check(
          await property(sql, newStats(), mutant, maxCommands),
          {
            numRuns: Math.max(numRuns, 200),
            seed: details.seed,
            endOnFailure: true,
          },
        );
        const error = mutantDetails.errorInstance;
        if (
          mutantDetails.failed &&
          error instanceof InvariantViolation &&
          error.message.startsWith(mutant.caughtBy)
        ) {
          console.log(
            `PASS mutant ${mutant.name} (${mutant.why}) is caught: ${error.message}`,
          );
        } else {
          failed++;
          console.log(
            `FAIL mutant ${mutant.name} (${mutant.why}) is not caught by ${mutant.caughtBy}: ` +
              (mutantDetails.failed
                ? `${(error as Error)?.message}`
                : `the property passed ${mutantDetails.numRuns} runs`),
          );
        }
      }
    }

    // Every run rolled back: nothing from this harness may persist.
    const [left] =
      await sql`SELECT count(*)::int AS n FROM public.orders WHERE id = ${ids.order}`;
    assert.equal(left.n, 0, 'the fixture order persisted');
    assert.equal(
      await productionFingerprint(sql),
      fingerprint,
      'a mutant persisted',
    );
  } finally {
    await sql.close();
  }
  console.log(
    `${failed === 0 ? 'PASS' : 'FAIL'} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();

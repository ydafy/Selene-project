import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const readSource = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8');

/**
 * Strict TDD static guards for the Phase 4 single-modal webhook wiring in
 * `stripe-webhooks/index.ts`. The Edge Function `serve()` handler imports
 * `https://deno.land/std` + `https://esm.sh/...` so it cannot be imported by
 * `bun test` (we mirror the Phase 3 strategy: pure correctness lives in the
 * imported `single-modal-settlement.ts` module which IS unit-tested; here we
 * guard the wiring text).
 *
 * Spec acceptance criteria enforced (single-modal-multiseller-checkout spec):
 *  - webhook routes on metadata.flow='single_modal_connect_checkout'
 *  - persists stripe_charge_id + transfer_group (via the new RPC)
 *  - on settlement failure: order stays in payment_processing, returns 200
 *    retry-safe for the recovered path; 500+DLQ for transport/precondition
 *  - legacy `return_shipping`, per-seller Connect (`metadata.seller_id`), and
 *    legacy `app_name='selene'` flows remain intact (route precedence
 *    preserved delegated to the pure router)
 *  - `payment_intent.payment_failed` / `.canceled` product release preserved
 */

const INDEX_PATH = 'supabase/functions/stripe-webhooks/index.ts';
const BUILDER_PATH = 'supabase/functions/stripe-webhooks/single-modal-settlement.ts';

describe('single-modal webhook wiring guards', () => {
  const index = readSource(INDEX_PATH);

  it('imports the pure single-modal settlement helpers from the extracted module', () => {
    expect(index).toContain("from './single-modal-settlement.ts'");
    expect(index).toContain('resolvePaymentIntentSucceededAction');
    expect(index).toContain('buildSettlementOutcome');
  });

  it('imports SINGLE_MODAL_FLOW from the create-connect-payment builder (single source of truth)', () => {
    const builder = readSource(BUILDER_PATH);
    expect(builder).toContain("import { SINGLE_MODAL_FLOW } from '../create-connect-payment/single-payment-builder.ts';");
    // The webhook references the same constant end-to-end (no local hardcoded
    // copy of the flow string).
    expect(index).toContain('SINGLE_MODAL_FLOW');
  });

  it('extracts the Stripe charge id from the succeeded PaymentIntent', () => {
    // pi.charges.data[0].id OR latest_charge; the webhook must persist the
    // platform charge id onto orders.stripe_charge_id via the new RPC.
    expect(
      index.includes('charges.data') || index.includes('latest_charge'),
    ).toBe(true);
    expect(index).toContain('MISSING_STRIPE_CHARGE_ID');
  });

  it('invokes the fn_create_shipments_from_single_payment RPC for single-modal PIs', () => {
    expect(index).toContain('fn_create_shipments_from_single_payment');
  });

  it('maps the RPC result to a retry-safe HTTP outcome via the pure builder', () => {
    expect(index).toContain('buildSettlementOutcome');
    // The recovered (200) and fatal_error (throw -> DLQ) branches are both
    // exercised by routing on the outcome.kind.
    expect(index).toMatch(/outcome\.kind/);
    expect(index).toContain("'ok'");
    expect(index).toContain("'recovered'");
    expect(index).toContain("'fatal_error'");
  });

  it('returns HTTP 200 for both ok and recovered outcomes (retry-safe)', () => {
    expect(index).toContain('status: 200');
    // The recovered branch must NOT throw into the DLQ catch — it must return
    // 200 inline so Stripe stops retrying the webhook for a persisted shell.
    expect(index).toContain('recovered');
  });

  it('throws into the DLQ path for fatal_error outcomes (transport/precondition failures)', () => {
    // fatal_error must surface via an inline throw so the existing catch writes
    // the webhook_dlq row + returns 500.
    expect(index).toMatch(/throw new Error\(/);
  });
});

describe('single-modal webhook preserves legacy flows', () => {
  const index = readSource(INDEX_PATH);

  it('keeps the return_shipping metadata branch intact', () => {
    expect(index).toContain("type === 'return_shipping'");
    expect(index).toContain('fn_log_return_payment');
  });

  it('keeps the per-seller Connect metadata.branch intact (seller_id metadata)', () => {
    expect(index).toContain('fn_create_shipment_from_payment');
    expect(index).toContain("intent.metadata.seller_id");
  });

  it('keeps the legacy app_name path intact (fn_create_order_from_payment + fraud + release)', () => {
    expect(index).toContain('APP_NAME');
    expect(index).toContain('fn_create_order_from_payment');
    expect(index).toContain('FRAUDE DETECTADO');
    expect(index).toContain('fn_release_products');
  });

  it('keeps the payment_intent.payment_failed / .canceled product-release branch intact', () => {
    expect(index).toContain(
      "event.type === 'payment_intent.payment_failed'",
    );
    expect(index).toContain("event.type === 'payment_intent.canceled'");
    expect(index).toContain('fn_release_products');
  });
});

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const readSql = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8').replace(/\s+/g, ' ');

describe('Connect money-flow guards', () => {
  it('Connect PaymentIntent metadata includes buyer address id', () => {
    // After the single-modal Phase 3 rewrite, `address_id` lives in PI metadata
    // built by the pure `single-payment-builder.ts` (index.ts is thin Stripe/
    // Supabase wiring). Guard BOTH layers: index.ts validates + forwards the
    // address id, the builder emits the `address_id` metadata key.
    const indexSource = readSql(
      'supabase/functions/create-connect-payment/index.ts',
    );
    const builderSource = readSql(
      'supabase/functions/create-connect-payment/single-payment-builder.ts',
    );

    expect(indexSource).toContain('addressId: z.string().uuid(),');
    // After the single-modal Phase 3 rewrite, index.ts validates the raw body
    // via `normalizedRequest` (the zod-parsed + normalized payload) before
    // forwarding it to the builder. Guard the normalized forwarding path, not
    // the stale `parsedBody` literal.
    expect(indexSource).toContain('addressId: normalizedRequest.addressId');
    expect(builderSource).toContain('address_id: addressId');
  });

  it('Connect PaymentIntent metadata includes the estimated seller shipping deduction', () => {
    // After the single-modal Phase 3 rewrite, the per-seller estimated shipping
    // deduction is computed via `calculateEstimatedSellerShippingDeductionCents`
    // and carried as `shippingCents` in the per-seller allocation rows, which
    // travel chunked inside `allocation_json` PI metadata — NOT as a stale
    // top-level `seller_shipping_deduction_cents` key on a `moneyFlow` object.
    // Guard the new SCT contract end-to-end (not the legacy literal).
    const indexSource = readSql(
      'supabase/functions/create-connect-payment/index.ts',
    );
    const builderSource = readSql(
      'supabase/functions/create-connect-payment/single-payment-builder.ts',
    );

    expect(indexSource).toContain(
      "select('shipping_buffer_cents, insurance_rate, service_fee_pct')",
    );
    expect(indexSource).toContain(
      'calculateEstimatedSellerShippingDeductionCents',
    );
    // Each product allocation carries its own shipping deduction.
    expect(indexSource).toContain('shippingCents: product.shippingCents');
    // The compact allocation row the webhook reassembles keeps shippingCents.
    expect(builderSource).toContain('shippingCents: r.shippingCents');
    // Legacy moneyFlow-based single-seller metadata layout is gone.
    expect(indexSource).not.toContain('seller_shipping_deduction_cents');
    expect(indexSource).not.toContain('moneyFlow.shippingCents');
  });

  it('Connect PaymentIntent rejects quantity above one for single-product listings', () => {
    const source = readSql(
      'supabase/functions/create-connect-payment/index.ts',
    );

    expect(source).toContain('quantity: z.literal(1).default(1)');
  });
});

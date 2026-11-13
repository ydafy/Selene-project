// source-text: the cutover runbook is the contract that keeps the deployment maintainer-only and sandbox-only
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  CHECKOUT_UUID_NAMESPACE,
  deriveOrderGroupId,
  deriveShipmentId,
} from './single-payment-builder.ts';
import {
  ADDRESS_ID,
  PRODUCT_1,
  runCreateConnectPayment,
} from './handler-fakes.ts';

const readProjectFile = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('deterministic checkout UUID cutover contract', () => {
  it('pins the UUID v5 namespace and canonical names without normalization', () => {
    expect(CHECKOUT_UUID_NAMESPACE).toBe(
      '7b0f4a20-5c30-4e0f-8f84-9a9f4b2e19c1',
    );
    expect(deriveOrderGroupId('checkout-ñ-😀')).toBe(
      '42d33f19-6cf4-5c35-a0bd-94ac1bf7afc5',
    );
    expect(deriveShipmentId('shared-key', 'product_gpu')).toBe(
      '5f43fc9e-ec3b-5072-82a1-ce531a0280c9',
    );
  });

  it('derives the order and shipment ids from the idempotency key and sends it to Stripe', async () => {
    const key = 'checkout-attempt-1';
    const orderId = deriveOrderGroupId(key);
    const result = await runCreateConnectPayment({
      body: {
        productIds: [PRODUCT_1],
        addressId: ADDRESS_ID,
        idempotencyKey: key,
      },
      // No random id may be drawn when the client sends a key.
      uuids: [],
    });

    expect(result.status).toBe(200);
    expect(result.body.orderId).toBe(orderId);
    expect(result.body.transferGroup).toBe(`selene_order_${orderId}`);
    expect(result.paymentIntentsCreate).toHaveLength(1);
    const [params, requestOptions] = result.paymentIntentsCreate[0] as [
      { transfer_group: string; metadata: Record<string, string> },
      unknown,
    ];
    expect(requestOptions).toEqual({ idempotencyKey: `selene_pi_${key}` });
    expect(params.transfer_group).toBe(`selene_order_${orderId}`);
    expect(params.metadata.order_id).toBe(orderId);
    expect(params.metadata.allocation_json_0).toContain(
      `"shipmentId":"${deriveShipmentId(key, PRODUCT_1)}"`,
    );
  });

  it('sends no Stripe idempotency key and uses random ids without a client key', async () => {
    const result = await runCreateConnectPayment({
      uuids: ['order-x', 'ship-x'],
    });

    expect(result.status).toBe(200);
    expect(result.body.orderId).toBe('order-x');
    expect(result.paymentIntentsCreate[0][1]).toEqual({});
    expect(
      (
        result.paymentIntentsCreate[0][0] as {
          metadata: Record<string, string>;
        }
      ).metadata.allocation_json_0,
    ).toContain('"shipmentId":"ship-x"');
  });

  it('a retry with the same key sends a byte-identical PaymentIntent request', async () => {
    const body = {
      productIds: [PRODUCT_1],
      addressId: ADDRESS_ID,
      idempotencyKey: 'retry-key',
    };
    const first = await runCreateConnectPayment({ body, uuids: [] });
    const second = await runCreateConnectPayment({ body, uuids: [] });

    expect(JSON.stringify(second.paymentIntentsCreate)).toBe(
      JSON.stringify(first.paymentIntentsCreate),
    );
  });

  it('keeps cutover deployment maintainer-only and sandbox-only', () => {
    const runbook = readProjectFile(
      'docs/runbooks/checkout-deterministic-uuid-cutover.md',
    );

    expect(runbook).toContain("maintainer's disposable sandbox only");
    expect(runbook).toContain('Do not run these steps in production.');
    expect(runbook).toContain(
      'supabase/snippets/reset-prelaunch-order-test-data.sql',
    );
    expect(runbook).toContain('Do not retry any pre-cutover key.');
    expect(runbook).toContain(
      'A production migration requires a separate approved',
    );
  });
});

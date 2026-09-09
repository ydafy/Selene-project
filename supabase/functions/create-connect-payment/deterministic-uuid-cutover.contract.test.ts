import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  CHECKOUT_UUID_NAMESPACE,
  deriveOrderGroupId,
  deriveShipmentId,
} from './single-payment-builder.ts';

const readProjectFile = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('deterministic checkout UUID cutover contract', () => {
  it('pins the UUID v5 namespace and canonical names without normalization', () => {
    const builderSource = readFileSync(
      new URL('./single-payment-builder.ts', import.meta.url),
      'utf8',
    );

    expect(CHECKOUT_UUID_NAMESPACE).toBe(
      '7b0f4a20-5c30-4e0f-8f84-9a9f4b2e19c1',
    );
    expect(builderSource).toContain(
      'selene_order_group:${idempotencyKey}',
    );
    expect(builderSource).toContain(
      'selene_shipment:${idempotencyKey}:product:${productId}',
    );
    expect(deriveOrderGroupId('checkout-ñ-😀')).toBe(
      '42d33f19-6cf4-5c35-a0bd-94ac1bf7afc5',
    );
    expect(deriveShipmentId('shared-key', 'product_gpu')).toBe(
      '5f43fc9e-ec3b-5072-82a1-ce531a0280c9',
    );
  });

  it('keeps the Stripe adapter wired to the local no-remote test seam', () => {
    const entrypointSource = readFileSync(
      new URL('./index.ts', import.meta.url),
      'utf8',
    );

    expect(entrypointSource).toContain('createSinglePaymentIntent({');
    expect(entrypointSource).toContain(
      'idempotencyKey: normalizedRequest.idempotencyKey',
    );
    expect(entrypointSource).not.toContain('stripe.paymentIntents.create(');
    expect(entrypointSource).toContain("from '../_shared/zod-runtime.ts'");
    expect(entrypointSource).not.toContain('https://esm.sh/zod@3.23.8');
  });

  it('keeps cutover deployment maintainer-only and sandbox-only', () => {
    const runbook = readProjectFile(
      'openspec/changes/archive/2026-09-05-standardize-checkout-deterministic-uuids/cutover-runbook.md',
    );

    expect(runbook).toContain("maintainer's disposable sandbox only");
    expect(runbook).toContain('Do not run these steps in production.');
    expect(runbook).toContain(
      'supabase/queries/maintenance/reset-prelaunch-order-test-data.sql',
    );
    expect(runbook).toContain('Do not retry any pre-cutover key.');
    expect(runbook).toContain('A production migration requires a separate approved');
  });
});

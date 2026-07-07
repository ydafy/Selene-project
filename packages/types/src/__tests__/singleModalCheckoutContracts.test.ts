import { describe, expect, test } from 'bun:test';
import type {
  CreateConnectPaymentResponse,
  ReleaseConnectPayoutResponse,
} from '../index';

/**
 * Contract tests for the single-modal multi-seller checkout type foundation
 * (Batch 1 / Work Unit 1: DB & Types).
 *
 * These tests lock the hand-written shared contracts in packages/types so the
 * downstream Edge Function (create-connect-payment, release-connect-payout) and
 * frontend consumers migrate against a stable single-secret + Transfer contract.
 *
 * Generated DB row types (database.types.ts) are regenerated separately via the
 * documented manual `bun db:types` step and are NOT asserted here.
 *
 * Test layer: Unit (contract + runtime shape). The compile gate is `tsc --noEmit`
 * on the types package; the runtime gate is `bun test` exercising the pure
 * validators below, which describe the single-secret and Transfer-field behavior.
 */

/**
 * Runtime validator describing the single-secret create-connect-payment response
 * contract. It rejects the legacy per-seller `paymentIntents[]` array shape and
 * requires the single `clientSecret` + `transferGroup` + `amount` fields.
 */
function validateSingleSecretResponse(x: unknown): x is CreateConnectPaymentResponse {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.orderId === 'string' &&
    typeof o.clientSecret === 'string' &&
    typeof o.customer === 'string' &&
    typeof o.ephemeralKey === 'string' &&
    typeof o.amount === 'number' &&
    typeof o.transferGroup === 'string' &&
    !Array.isArray(o.paymentIntents)
  );
}

/**
 * Runtime validator describing the release-connect-payout success response.
 * The Transfer field (`stripeTransferId`) is optional because legacy per-seller
 * orders do not produce a platform->seller Transfer during release.
 */
function validateReleaseSuccess(
  x: unknown,
): x is Extract<ReleaseConnectPayoutResponse, { success: true }> {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.success === true &&
    typeof o.runId === 'string' &&
    typeof o.status === 'string' &&
    typeof o.amount === 'number' &&
    (o.stripePayoutId === undefined || typeof o.stripePayoutId === 'string') &&
    (o.stripeTransferId === undefined || typeof o.stripeTransferId === 'string')
  );
}

// Compile-time contract locks. These assignments fail to type-check when the
// production contract does not yet match the single-modal + Transfer shape.
// They are intentionally erased at runtime; `tsc --noEmit` is the RED/GREEN gate.
const _singleSecretContract: CreateConnectPaymentResponse = {
  orderId: '',
  clientSecret: '',
  customer: '',
  ephemeralKey: '',
  amount: 0,
  transferGroup: '',
};
const _releaseSuccessWithTransfer: Extract<
  ReleaseConnectPayoutResponse,
  { success: true }
> = {
  success: true,
  runId: '',
  status: 'paid',
  amount: 0,
  stripeTransferId: '',
};
const _releaseSuccessLegacyWithoutTransfer: Extract<
  ReleaseConnectPayoutResponse,
  { success: true }
> = {
  success: true,
  runId: '',
  status: 'paid',
  amount: 0,
};
void _singleSecretContract;
void _releaseSuccessWithTransfer;
void _releaseSuccessLegacyWithoutTransfer;

describe('CreateConnectPaymentResponse single-secret contract', () => {
  test('accepts a valid single-secret response', () => {
    const good = {
      orderId: 'o_1',
      clientSecret: 'cs_test_1',
      customer: 'cus_1',
      ephemeralKey: 'ek_1',
      amount: 5000,
      transferGroup: 'grp_o_1',
    };
    expect(validateSingleSecretResponse(good)).toBe(true);
  });

  test('rejects the legacy per-seller paymentIntents array shape', () => {
    const legacy = {
      orderId: 'o_1',
      customer: 'cus_1',
      ephemeralKey: 'ek_1',
      expiresAt: '2026-01-01T00:00:00Z',
      paymentIntents: [
        { sellerId: 's_1', shipmentId: 'sh_1', clientSecret: 'cs_1', amount: 2500, descriptor: 'd' },
      ],
    };
    expect(validateSingleSecretResponse(legacy)).toBe(false);
  });

  test('rejects objects missing transferGroup', () => {
    const missingGroup = {
      orderId: 'o_1',
      clientSecret: 'cs_1',
      customer: 'cus_1',
      ephemeralKey: 'ek_1',
      amount: 5000,
    };
    expect(validateSingleSecretResponse(missingGroup)).toBe(false);
  });
});

describe('ReleaseConnectPayoutResponse Transfer field contract', () => {
  test('accepts a success response carrying stripeTransferId', () => {
    const rel = {
      success: true,
      runId: 'run_1',
      status: 'paid',
      amount: 470000,
      stripePayoutId: 'po_1',
      stripeTransferId: 'tr_1',
    } as const;
    expect(validateReleaseSuccess(rel)).toBe(true);
  });

  test('accepts a legacy success response without stripeTransferId', () => {
    const legacy = {
      success: true,
      runId: 'run_2',
      status: 'paid',
      amount: 100000,
      stripePayoutId: 'po_2',
    } as const;
    expect(validateReleaseSuccess(legacy)).toBe(true);
  });

  test('rejects a failure-shaped object for the success validator', () => {
    const failure = {
      success: false,
      error: 'insufficient balance',
      code: 'stripe_balance_insufficient',
    } as const;
    expect(validateReleaseSuccess(failure)).toBe(false);
  });
});
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (file) =>
      file.endsWith('.sql') && file.includes('connect_manual_payout_release'),
  );

  if (files.length === 0) {
    throw new Error(
      'Migration file matching *connect_manual_payout_release*.sql not found',
    );
  }

  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

interface PayoutViewSemanticsInput {
  netPayoutPesos: number;
  shippingCostCents?: number | null;
  isCompleted?: boolean;
  hasCompletedAt?: boolean;
  hasConnectPaymentIntent?: boolean;
  hasActiveDispute?: boolean;
  hasActiveRelease?: boolean;
  hasStripeAccount?: boolean;
  isSellerPayoutReady?: boolean;
}

const mirrorPayoutViewSemantics = ({
  netPayoutPesos,
  shippingCostCents,
  isCompleted = true,
  hasCompletedAt = true,
  hasConnectPaymentIntent = true,
  hasActiveDispute = false,
  hasActiveRelease = false,
  hasStripeAccount = true,
  isSellerPayoutReady = true,
}: PayoutViewSemanticsInput) => {
  const hasShippingCostCents =
    shippingCostCents !== null &&
    shippingCostCents !== undefined &&
    shippingCostCents > 0;
  const releaseAmountCents = Math.max(
    Math.round(netPayoutPesos * 100) - (shippingCostCents ?? 0),
    0,
  );
  const isEligible =
    isCompleted &&
    hasCompletedAt &&
    hasConnectPaymentIntent &&
    !hasActiveDispute &&
    !hasActiveRelease &&
    hasShippingCostCents &&
    hasStripeAccount &&
    isSellerPayoutReady &&
    releaseAmountCents > 0;

  const ineligibleReason = !isCompleted
    ? 'shipment_not_completed'
    : !hasCompletedAt
      ? 'missing_completed_at'
      : !hasConnectPaymentIntent
        ? 'missing_connect_payment_intent'
        : hasActiveDispute
          ? 'active_dispute'
          : hasActiveRelease
            ? 'already_released'
            : !hasShippingCostCents
              ? 'missing_shipping_cost'
              : !hasStripeAccount
                ? 'missing_stripe_account'
                : !isSellerPayoutReady
                  ? 'seller_not_payout_ready'
                  : releaseAmountCents <= 0
                    ? 'missing_release_amount'
                    : null;

  return { releaseAmountCents, isEligible, ineligibleReason };
};

describe('connect manual payout release migration', () => {
  test('creates payout run ledger with idempotency and reconciliation fields', () => {
    const sql = findMigration();

    expect(sql).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_payout_runs/i,
    );
    expect(sql).toMatch(/idempotency_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
    expect(sql).toMatch(/seller_id\s+UUID\s+NOT\s+NULL/i);
    expect(sql).toMatch(/amount\s+INTEGER\s+NOT\s+NULL/i);
    expect(sql).toMatch(/actor_id\s+UUID\s+NOT\s+NULL/i);
    expect(sql).toMatch(/stripe_payout_id\s+TEXT/i);
  });

  test('creates shipment mapping with FK indexes and active shipment uniqueness', () => {
    const sql = findMigration();

    expect(sql).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_payout_run_shipments/i,
    );
    expect(sql).toMatch(/shipment_id\s+UUID\s+NOT\s+NULL/i);
    expect(sql).toMatch(/run_id\s+UUID\s+NOT\s+NULL/i);
    expect(sql).toMatch(/net_payout\s+INTEGER\s+NOT\s+NULL/i);
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_connect_payout_runs_seller_id/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_connect_payout_run_shipments_run_id/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_connect_payout_run_shipments_shipment_id/i,
    );
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_connect_payout_run_shipments_active_once[\s\S]+WHERE\s+status\s+IN\s+\(\s*'pending_reconciliation'\s*,\s*'paid'\s*,\s*'reconciliation_needed'\s*\)/i,
    );
  });

  test('creates admin payout release view with eligibility gates and release amount', () => {
    const sql = findMigration();

    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.admin_connect_payout_release_view/i,
    );
    expect(sql).toContain("s.status = 'completed'");
    expect(sql).toContain('s.completed_at IS NOT NULL');
    expect(sql).toContain('s.stripe_payment_intent_id IS NOT NULL');
    expect(sql).toMatch(
      /crs\.status\s+IN\s+\(\s*'pending_reconciliation'\s*,\s*'paid'\s*,\s*'reconciliation_needed'\s*\)/i,
    );
    expect(sql).toMatch(
      /GREATEST\([\s\S]*ROUND\(COALESCE\(SUM\(oi\.net_payout\),\s*0\)\s*\*\s*100\)::INTEGER\s*-\s*COALESCE\(s\.shipping_cost,\s*0\)[\s\S]*0[\s\S]*\)\s+AS\s+release_amount_cents/i,
    );
    expect(sql).toContain('has_shipping_cost_cents');
    expect(sql).toContain(
      "WHEN NOT has_shipping_cost_cents THEN 'missing_shipping_cost'",
    );
    expect(sql).toContain('ineligible_reason');
  });

  test('documents payout view math semantics with behavior examples', () => {
    expect(
      mirrorPayoutViewSemantics({
        netPayoutPesos: 4_700,
        shippingCostCents: 28_700,
      }),
    ).toEqual({
      releaseAmountCents: 441_300,
      isEligible: true,
      ineligibleReason: null,
    });

    expect(
      mirrorPayoutViewSemantics({
        netPayoutPesos: 4_700,
        shippingCostCents: 0,
      }),
    ).toEqual({
      releaseAmountCents: 470_000,
      isEligible: false,
      ineligibleReason: 'missing_shipping_cost',
    });

    expect(
      mirrorPayoutViewSemantics({
        netPayoutPesos: 4_700,
        shippingCostCents: null,
      }),
    ).toEqual({
      releaseAmountCents: 470_000,
      isEligible: false,
      ineligibleReason: 'missing_shipping_cost',
    });

    expect(
      mirrorPayoutViewSemantics({
        netPayoutPesos: 100,
        shippingCostCents: 12_000,
      }),
    ).toEqual({
      releaseAmountCents: 0,
      isEligible: false,
      ineligibleReason: 'missing_release_amount',
    });
  });

  test('marks active pending or reconciliation-needed shipment mappings ineligible before paid reconciliation', () => {
    const sql = findMigration();

    expect(sql).toContain('has_active_release');
    expect(sql).toContain('AND NOT has_active_release');
    expect(sql).toContain("WHEN has_active_release THEN 'already_released'");
  });

  test('limits finance tables and view to service role access', () => {
    const sql = findMigration();

    expect(sql).toMatch(
      /ALTER\s+TABLE\s+public\.connect_payout_runs\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+public\.connect_payout_run_shipments\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.connect_payout_runs\s+FROM\s+anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.connect_payout_run_shipments\s+FROM\s+anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.admin_connect_payout_release_view\s+FROM\s+anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT\s+ALL\s+ON\s+public\.connect_payout_runs\s+TO\s+service_role/i,
    );
    expect(sql).toMatch(
      /GRANT\s+SELECT\s+ON\s+public\.admin_connect_payout_release_view\s+TO\s+service_role/i,
    );
  });
});

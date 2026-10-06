import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationPath =
  'supabase/migrations/20260915000000_fix_payout_release_amount_contract.sql';
const sourcePath =
  'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql';

const readSql = (path: string) => readFileSync(join(root, path), 'utf8');

type SettlementFlow = 'single-modal' | 'legacy';

const mirrorReleaseAmountContract = ({
  flow,
  netPayoutPesos,
  shippingCostCents,
}: {
  flow: SettlementFlow;
  netPayoutPesos: number;
  shippingCostCents: number | null;
}) => {
  const netPayoutCents = Math.round(netPayoutPesos * 100);
  const hasShippingCostCents =
    shippingCostCents !== null && shippingCostCents > 0;
  const releaseAmountCents = Math.max(
    flow === 'single-modal'
      ? netPayoutCents
      : netPayoutCents - (shippingCostCents ?? 0),
    0,
  );
  const isEligible =
    (flow === 'single-modal' || hasShippingCostCents) &&
    releaseAmountCents > 0;
  const ineligibleReason = !isEligible
    ? flow === 'legacy' && !hasShippingCostCents
      ? 'missing_shipping_cost'
      : 'missing_release_amount'
    : null;

  return { releaseAmountCents, isEligible, ineligibleReason };
};

describe('payout release amount contract', () => {
  test('makes the single-modal checkout allocation the release amount in migration and operational SQL', () => {
    for (const path of [migrationPath, sourcePath]) {
      const sql = readSql(path);

      expect(sql).toMatch(
        /WHEN\s+o\.stripe_transfer_group\s+IS\s+NOT\s+NULL\s+THEN\s+ROUND\(COALESCE\(SUM\(oi\.net_payout\),\s*0\)\s*\*\s*100\)::INTEGER/i,
      );
      // The migration keeps CTE-local unqualified identifiers; the
      // operational copy qualifies the same eligibility predicate with the
      // `sa.` CTE alias. Accept both spellings.
      expect(sql).toMatch(
        /AND\s+\((sa\.)?transfer_group\s+IS\s+NOT\s+NULL\s+OR\s+(sa\.)?has_shipping_cost_cents\)/,
      );
      expect(sql).not.toMatch(/label_provider_cost_cents/i);
      expect(sql).not.toMatch(/publication_shipping_reserve_cents/i);
    }
  });

  test('does not double-deduct shipping or require a label cost for single-modal rows', () => {
    expect(
      mirrorReleaseAmountContract({
        flow: 'single-modal',
        netPayoutPesos: 4_700,
        shippingCostCents: null,
      }),
    ).toEqual({
      releaseAmountCents: 470_000,
      isEligible: true,
      ineligibleReason: null,
    });
  });

  test('preserves the legacy shipping-cost deduction and eligibility branch', () => {
    expect(
      mirrorReleaseAmountContract({
        flow: 'legacy',
        netPayoutPesos: 4_700,
        shippingCostCents: 28_700,
      }),
    ).toEqual({
      releaseAmountCents: 441_300,
      isEligible: true,
      ineligibleReason: null,
    });

    expect(
      mirrorReleaseAmountContract({
        flow: 'legacy',
        netPayoutPesos: 4_700,
        shippingCostCents: null,
      }),
    ).toEqual({
      releaseAmountCents: 470_000,
      isEligible: false,
      ineligibleReason: 'missing_shipping_cost',
    });
  });
});

export interface DrainWalletRow {
  walletId: string;
  userId: string;
  availableBalance: number;
  stripeAccountId: string | null;
  onboardingStatus: string | null;
}

export interface DrainCandidate {
  walletId: string;
  userId: string;
  availableBalance: number;
  amountCents: number;
  stripeAccountId: string;
}

export type DrainResult =
  | { status: 'transferred'; amountCents: number }
  | { status: 'failed'; amountCents: number }
  | { status: 'skipped'; amountCents: number };

export function selectDrainCandidates(
  rows: DrainWalletRow[],
): DrainCandidate[] {
  return rows
    .filter(
      (row) =>
        row.availableBalance > 0 &&
        row.stripeAccountId !== null &&
        row.onboardingStatus === 'complete',
    )
    .map((row) => ({
      walletId: row.walletId,
      userId: row.userId,
      availableBalance: row.availableBalance,
      amountCents: Math.round(row.availableBalance * 100),
      stripeAccountId: row.stripeAccountId!,
    }));
}

export function createDrainIdempotencyKey(
  walletId: string,
  amountCents: number,
) {
  return `drain_legacy_wallet_${walletId}_${amountCents}`;
}

export function summarizeDrainResults(results: DrainResult[]) {
  return results.reduce(
    (summary, result) => {
      if (result.status === 'transferred') {
        summary.transferredCount += 1;
        summary.transferredCents += result.amountCents;
      }
      if (result.status === 'failed') summary.failedCount += 1;
      if (result.status === 'skipped') summary.skippedCount += 1;
      return summary;
    },
    {
      transferredCount: 0,
      transferredCents: 0,
      failedCount: 0,
      skippedCount: 0,
    },
  );
}

export interface ConnectEarningsLikeRow {
  amount: number | null;
  application_fee_amount: number | null;
  status: 'succeeded' | 'refunded' | 'failed' | string | null;
}

export function centsToMoney(cents: number): number {
  return cents / 100;
}

export function summarizeConnectEarnings(rows: ConnectEarningsLikeRow[]) {
  return rows.reduce(
    (summary, row) => {
      if (row.status === 'succeeded') {
        summary.succeededCount += 1;
        summary.grossCents += row.amount ?? 0;
        summary.applicationFeesCents += row.application_fee_amount ?? 0;
      }
      if (row.status === 'refunded') {
        summary.refundedCount += 1;
      }
      return summary;
    },
    {
      succeededCount: 0,
      refundedCount: 0,
      grossCents: 0,
      applicationFeesCents: 0,
    },
  );
}

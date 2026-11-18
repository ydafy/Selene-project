import type { Database, Enums } from '@selene/types';

export type ReportReason = Enums<'report_reason'>;
export type ReportContext = 'product' | 'user';
export type ReportTarget = { context: ReportContext; id: string };
export type ReportOutcome = 'success' | 'already_reported' | 'error';

/** Same limit as the `details` CHECK on `public.reports`. */
export const REPORT_DETAILS_MAX_LENGTH = 1000;

// A Record keyed by the enum fails the typecheck when the database adds a reason.
const REASON_ORDER: { [K in ReportReason]: K } = {
  fraud: 'fraud',
  counterfeit_or_misdescribed: 'counterfeit_or_misdescribed',
  prohibited_item: 'prohibited_item',
  offensive_content: 'offensive_content',
  harassment: 'harassment',
  spam: 'spam',
  other: 'other',
};
export const REPORT_REASONS: readonly ReportReason[] =
  Object.values(REASON_ORDER);

// The columns `authenticated` may insert (S5); nothing else is sent.
type ReportInsert = Pick<
  Database['public']['Tables']['reports']['Insert'],
  'reporter_id' | 'target_product_id' | 'target_user_id' | 'reason' | 'details'
>;

export const buildReportInsert = ({
  reporterId,
  target,
  reason,
  details,
}: {
  reporterId: string;
  target: ReportTarget;
  reason: ReportReason;
  details?: string;
}): ReportInsert => ({
  reporter_id: reporterId,
  ...(target.context === 'product'
    ? { target_product_id: target.id }
    : { target_user_id: target.id }),
  reason,
  details: details?.trim() || null,
});

// Postgres unique violation: the partial index allows one open report per
// reporter and target.
const UNIQUE_VIOLATION = '23505';

export const reportOutcome = (error: unknown): ReportOutcome => {
  if (error === null || error === undefined) return 'success';
  const code =
    typeof error === 'object' && 'code' in error ? error.code : undefined;
  return code === UNIQUE_VIOLATION ? 'already_reported' : 'error';
};

export type ReportCopy = {
  type: 'success' | 'info' | 'error';
  text1Key: string;
  text2Key: string;
};

export const reportCopy = (
  context: ReportContext,
  outcome: ReportOutcome,
): ReportCopy => {
  switch (outcome) {
    case 'success':
      return {
        type: 'success',
        text1Key: `product:report.${context}.sentTitle`,
        text2Key: `product:report.${context}.sentMsg`,
      };
    case 'already_reported':
      return {
        type: 'info',
        text1Key: `product:report.${context}.alreadyTitle`,
        text2Key: `product:report.${context}.alreadyMsg`,
      };
    case 'error':
      return {
        type: 'error',
        text1Key: 'product:report.errorTitle',
        text2Key: 'product:report.errorMsg',
      };
  }
};

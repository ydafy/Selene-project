import type { Database } from '@selene/types';

export type SellerOnboardingViewRow =
  Database['public']['Views']['admin_seller_onboarding_view']['Row'];

export type SellerOnboardingStatus = 'pending' | 'complete' | 'rejected';

export interface SellerOnboardingRow {
  id: string;
  username: string | null;
  email: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: SellerOnboardingStatus | null;
  charges_enabled: boolean | null;
  created_at: string | null;
}

export interface SellerOnboardingLikeRow {
  stripe_onboarding_status: SellerOnboardingStatus | null;
}

export function normalizeSellerOnboardingRow(
  row: SellerOnboardingViewRow,
): SellerOnboardingRow | null {
  if (!row.id) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    stripe_account_id: row.stripe_account_id,
    stripe_onboarding_status: row.stripe_onboarding_status,
    charges_enabled: row.charges_enabled,
    created_at: row.created_at,
  };
}

export function summarizeSellerOnboarding(rows: SellerOnboardingLikeRow[]) {
  return rows.reduce(
    (summary, row) => {
      const status = row.stripe_onboarding_status ?? 'pending';
      summary[status] += 1;
      return summary;
    },
    { complete: 0, pending: 0, rejected: 0 },
  );
}

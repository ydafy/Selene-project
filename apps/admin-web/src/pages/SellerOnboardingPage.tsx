/**
 * @file apps/admin-web/src/pages/SellerOnboardingPage.tsx
 * @description Admin Dashboard Page for tracking seller Stripe Connect onboarding lifecycles (CON-001).
 *
 * Implements:
 * 1. KPI summary cards: Counts of Completed, Pending, and Rejected seller onboardings.
 * 2. Seller directory displaying usernames, emails, Stripe account IDs, and onboarding status.
 * 3. Loads the protected seller onboarding admin view through an admin-only Edge Function.
 *
 * Allows administrators to proactively identify and assist sellers rejected by Stripe's KYC checks.
 *
 * @version 1.0
 * @domain admin-onboarding-pages
 */

import { RefreshCw } from 'lucide-react';
import { useSellerOnboarding } from '../hooks/useSellerOnboarding';
import { summarizeSellerOnboarding } from '../lib/connectOnboarding';
import { ErrorState } from '../components/ui/ErrorState';

const statusLabel: Record<string, string> = {
  complete: 'Complete',
  pending: 'Pending',
  rejected: 'Rejected',
};

const SellerOnboardingPageSkeleton = () => (
  <div className="space-y-6 animate-pulse">
    <div className="flex justify-between items-end">
      <div className="space-y-3">
        <div className="h-9 w-80 max-w-full rounded-lg bg-white/10" />
        <div className="h-4 w-96 max-w-full rounded bg-white/10" />
      </div>
      <div className="h-10 w-28 rounded-xl bg-white/10" />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3"
        >
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="h-8 w-16 rounded bg-white/10" />
        </div>
      ))}
    </div>

    <div className="bg-state-gray border border-white/10 rounded-2xl overflow-hidden p-4 space-y-3">
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="h-12 rounded-lg bg-white/5" />
      ))}
    </div>
  </div>
);

export const SellerOnboardingPage = () => {
  const {
    data = [],
    isLoading,
    isError,
    refetch,
    refreshSeller,
    isRefreshingSeller,
    refreshingSellerId,
  } = useSellerOnboarding();

  if (isLoading) {
    return <SellerOnboardingPageSkeleton />;
  }

  if (isError) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  const summary = summarizeSellerOnboarding(data);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Seller Connect Onboarding</h1>
          <p className="text-blue-light text-sm">
            Track Stripe Connect account status before sellers generate labels.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-state-gray border border-white/10 text-platinum rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs text-blue-light uppercase font-bold">
            Complete
          </p>
          <p className="text-2xl font-bold text-emerald-400">
            {summary.complete}
          </p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs text-blue-light uppercase font-bold">Pending</p>
          <p className="text-2xl font-bold text-lion">{summary.pending}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs text-blue-light uppercase font-bold">
            Rejected
          </p>
          <p className="text-2xl font-bold text-fire">{summary.rejected}</p>
        </div>
      </div>

      <div className="bg-state-gray border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-blue-light uppercase text-xs">
            <tr>
              <th className="text-left p-4">Seller</th>
              <th className="text-left p-4">Stripe Account</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Charges</th>
              <th className="text-left p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td className="p-6 text-blue-light" colSpan={5}>
                  No sellers found.
                </td>
              </tr>
            ) : (
              data.map((seller) => (
                <tr key={seller.id} className="border-t border-white/5">
                  <td className="p-4">
                    <p className="font-semibold">
                      {seller.username ?? seller.id}
                    </p>
                    <p className="text-xs text-blue-light">
                      {seller.email ?? 'No email'}
                    </p>
                  </td>
                  <td className="p-4 font-mono text-xs">
                    {seller.stripe_account_id ?? 'Not created'}
                  </td>
                  <td className="p-4">
                    {statusLabel[seller.stripe_onboarding_status ?? 'pending']}
                  </td>
                  <td className="p-4">
                    {seller.charges_enabled ? 'Enabled' : 'Not enabled'}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => void refreshSeller(seller.id)}
                      disabled={
                        !seller.stripe_account_id ||
                        (isRefreshingSeller && refreshingSellerId === seller.id)
                      }
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 text-platinum rounded-lg text-xs font-bold hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RefreshCw
                        size={14}
                        className={
                          isRefreshingSeller && refreshingSellerId === seller.id
                            ? 'animate-spin'
                            : undefined
                        }
                      />
                      Refresh from Stripe
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

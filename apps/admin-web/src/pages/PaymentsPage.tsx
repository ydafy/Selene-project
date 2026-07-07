/**
 * @file apps/admin-web/src/pages/PaymentsPage.tsx
 * @description Admin Dashboard Page for monitoring Stripe Connect Earnings and transaction volume.
 *
 * Implements:
 * 1. Financial summary cards: Gross processed volume, Selene Application Fees (revenue), and succeeded payment counts.
 * 2. Searchable directory of Connect-era PaymentIntents loaded through the admin get-connect-earnings Edge Function.
 * 3. Performance optimizations: Debounced search input (300ms) to prevent repeated admin data requests while typing.
 *
 * Fully styled using Selene's high-contrast dark theme.
 *
 * @version 1.0
 * @domain admin-finance-pages
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Search } from 'lucide-react';
import { useConnectEarnings } from '../hooks/useConnectEarnings';
import { useConnectPayoutReleaseQueue } from '../hooks/useConnectPayoutReleaseQueue';
import { summarizeConnectEarnings, centsToMoney } from '../lib/connectEarnings';
import { getSelectedEligibleShipmentIds } from '../lib/connectPayoutReleaseQueue';
import { useDebounce } from '../hooks/useDebounce';
import { ErrorState } from '../components/ui/ErrorState';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);

const formatReason = (reason: string | null) =>
  reason ? reason.replaceAll('_', ' ').toLowerCase() : 'Not eligible';

const PaymentsPageSkeleton = () => (
  <div className="space-y-6 animate-pulse">
    <div className="flex justify-between items-end">
      <div className="space-y-3">
        <div className="h-9 w-64 rounded-lg bg-white/10" />
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
          <div className="h-3 w-32 rounded bg-white/10" />
          <div className="h-8 w-40 rounded bg-white/10" />
        </div>
      ))}
    </div>

    <div className="h-10 w-full md:w-96 rounded-xl bg-white/10" />
    <div className="bg-state-gray border border-white/10 rounded-2xl overflow-hidden p-4 space-y-3">
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="h-10 rounded-lg bg-white/5" />
      ))}
    </div>
  </div>
);

export const PaymentsPage = () => {
  const [search, setSearch] = useState('');
  const [selectedShipmentsBySeller, setSelectedShipmentsBySeller] = useState<
    Record<string, string[]>
  >({});
  const debouncedSearch = useDebounce(search, 300);
  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useConnectEarnings(debouncedSearch);
  const {
    batches,
    isLoading: isQueueLoading,
    isError: isQueueError,
    refetch: refetchQueue,
    releaseSelectedShipments,
    isReleasing,
  } = useConnectPayoutReleaseQueue(debouncedSearch);
  const summary = summarizeConnectEarnings(data);

  const toggleShipmentSelection = (sellerId: string, shipmentId: string) => {
    setSelectedShipmentsBySeller((current) => {
      const currentSellerSelection = current[sellerId] ?? [];
      const exists = currentSellerSelection.includes(shipmentId);

      return {
        ...current,
        [sellerId]: exists
          ? currentSellerSelection.filter((id) => id !== shipmentId)
          : [...currentSellerSelection, shipmentId],
      };
    });
  };

  const selectEligibleBatch = (sellerId: string, shipmentIds: string[]) => {
    setSelectedShipmentsBySeller((current) => ({
      ...current,
      [sellerId]: shipmentIds,
    }));
  };

  const handleRelease = async (sellerId: string) => {
    const batch = batches.find((item) => item.sellerId === sellerId);
    if (!batch) return;

    const selectedShipmentIds = getSelectedEligibleShipmentIds(
      batch,
      selectedShipmentsBySeller[sellerId] ?? [],
    );

    await releaseSelectedShipments({ batch, shipmentIds: selectedShipmentIds });
    setSelectedShipmentsBySeller((current) => ({ ...current, [sellerId]: [] }));
  };

  if (isLoading || isQueueLoading) {
    return <PaymentsPageSkeleton />;
  }

  if (isError || isQueueError) {
    return (
      <ErrorState
        onRetry={() => {
          void refetch();
          void refetchQueue();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Connect Earnings</h1>
          <p className="text-blue-light text-sm">
            Stripe Connect application fees and seller-routed payment activity.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs text-blue-light uppercase font-bold">
            Gross processed
          </p>
          <p className="text-2xl font-bold text-platinum">
            {formatCurrency(centsToMoney(summary.grossCents))}
          </p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs text-blue-light uppercase font-bold">
            Application fees
          </p>
          <p className="text-2xl font-bold text-lion">
            {formatCurrency(centsToMoney(summary.applicationFeesCents))}
          </p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs text-blue-light uppercase font-bold">
            Succeeded payments
          </p>
          <p className="text-2xl font-bold text-emerald-400">
            {summary.succeededCount}
          </p>
        </div>
      </div>

      <div className="relative w-full md:w-96">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-light"
          size={18}
        />
        <input
          type="text"
          placeholder="Search by seller name..."
          className="w-full bg-state-gray border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-platinum focus:border-lion outline-none transition-all focus:ring-2 focus:ring-lion/50"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <section className="bg-state-gray border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-platinum">
              Manual payout release queue
            </h2>
            <p className="text-sm text-blue-light">
              Select completed, dispute-free shipments and release only the
              shipment-scoped seller amount.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetchQueue()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-platinum transition-colors hover:border-lion hover:text-lion"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {batches.length === 0 ? (
          <div className="p-6 text-sm text-blue-light">
            No payout release candidates found.
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {batches.map((batch) => {
              const eligibleShipmentIds = batch.shipments
                .filter((shipment) => shipment.isEligible)
                .map((shipment) => shipment.shipmentId);
              const selectedShipmentIds = getSelectedEligibleShipmentIds(
                batch,
                selectedShipmentsBySeller[batch.sellerId] ?? [],
              );
              const selectedAmountCents = batch.shipments
                .filter((shipment) =>
                  selectedShipmentIds.includes(shipment.shipmentId),
                )
                .reduce(
                  (total, shipment) => total + shipment.releaseAmountCents,
                  0,
                );
              const canRelease = selectedShipmentIds.length > 0 && !isReleasing;

              return (
                <article key={batch.sellerId} className="p-4 space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-platinum">
                          {batch.sellerName ?? batch.sellerId}
                        </h3>
                        <span className="rounded-full bg-white/5 px-2 py-1 text-xs uppercase text-blue-light">
                          {batch.releaseState}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-blue-light">
                        {batch.eligibleShipmentCount} eligible /{' '}
                        {batch.ineligibleShipmentCount} blocked · Account{' '}
                        {batch.stripeAccountId ?? 'missing'}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="text-sm text-blue-light sm:text-right">
                        <p>Selected release</p>
                        <p className="font-bold text-lion">
                          {formatCurrency(centsToMoney(selectedAmountCents))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          selectEligibleBatch(
                            batch.sellerId,
                            eligibleShipmentIds,
                          )
                        }
                        disabled={
                          eligibleShipmentIds.length === 0 || isReleasing
                        }
                        className="rounded-xl border border-white/10 px-3 py-2 text-sm text-platinum transition-colors hover:border-lion disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Select eligible
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRelease(batch.sellerId)}
                        disabled={!canRelease}
                        className="rounded-xl bg-lion px-4 py-2 text-sm font-bold text-state-black transition-colors hover:bg-lion-light disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isReleasing ? 'Releasing…' : 'Release selected'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 text-blue-light uppercase text-xs">
                        <tr>
                          <th className="text-left p-3">Select</th>
                          <th className="text-left p-3">Shipment</th>
                          <th className="text-left p-3">Order</th>
                          <th className="text-left p-3">Amount</th>
                          <th className="text-left p-3">Eligibility</th>
                          <th className="text-left p-3">Reconciliation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.shipments.map((shipment) => {
                          const selected = selectedShipmentIds.includes(
                            shipment.shipmentId,
                          );

                          return (
                            <tr
                              key={shipment.shipmentId}
                              className="border-t border-white/5"
                            >
                              <td className="p-3">
                                <input
                                  type="checkbox"
                                  aria-label={`Select shipment ${shipment.shipmentId}`}
                                  checked={selected}
                                  disabled={!shipment.isEligible || isReleasing}
                                  onChange={() =>
                                    toggleShipmentSelection(
                                      batch.sellerId,
                                      shipment.shipmentId,
                                    )
                                  }
                                  className="h-4 w-4 rounded border-white/20 bg-state-black accent-lion disabled:cursor-not-allowed disabled:opacity-40"
                                />
                              </td>
                              <td className="p-3 font-mono text-xs text-platinum">
                                {shipment.shipmentId}
                              </td>
                              <td className="p-3 font-mono text-xs text-blue-light">
                                {shipment.orderId}
                              </td>
                              <td className="p-3 text-lion">
                                {formatCurrency(
                                  centsToMoney(shipment.releaseAmountCents),
                                )}
                              </td>
                              <td className="p-3">
                                {shipment.isEligible ? (
                                  <span className="inline-flex items-center gap-2 text-emerald-400">
                                    <CheckCircle2 size={16} /> Eligible
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-2 text-amber-300"
                                    title={formatReason(
                                      shipment.ineligibleReason,
                                    )}
                                  >
                                    <AlertTriangle size={16} />
                                    {formatReason(shipment.ineligibleReason)}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 capitalize text-blue-light">
                                {shipment.reconciliationIndicator.replaceAll(
                                  '_',
                                  ' ',
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="bg-state-gray border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-blue-light uppercase text-xs">
            <tr>
              <th className="text-left p-4">Seller</th>
              <th className="text-left p-4">PaymentIntent</th>
              <th className="text-left p-4">Gross</th>
              <th className="text-left p-4">Application fee</th>
              <th className="text-left p-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td className="p-6 text-blue-light" colSpan={5}>
                  No Connect payments found.
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="p-4">{row.seller_name ?? row.seller_id}</td>
                  <td className="p-4 font-mono text-xs">
                    {row.stripe_payment_intent_id}
                  </td>
                  <td className="p-4">
                    {formatCurrency(centsToMoney(row.amount))}
                  </td>
                  <td className="p-4 text-lion">
                    {formatCurrency(centsToMoney(row.application_fee_amount))}
                  </td>
                  <td className="p-4 capitalize">{row.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

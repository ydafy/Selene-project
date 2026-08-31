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

import { useState, useMemo } from 'react';
import {
  RefreshCw,
  Search,
  X,
  DollarSign,
  TrendingUp,
  Receipt,
  Wallet,
  ShieldCheck,
  Calendar,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';

import { useConnectEarnings } from '../hooks/useConnectEarnings';
import { useConnectPayoutReleaseQueue } from '../hooks/useConnectPayoutReleaseQueue';
import { summarizeConnectEarnings, centsToMoney } from '../lib/connectEarnings';
import { getSelectedEligibleShipmentIds } from '../lib/connectPayoutReleaseQueue';
import { useDebounce } from '../hooks/useDebounce';
import { ErrorState } from '../components/ui/ErrorState';
import { formatCurrency } from '../lib/utils/formatCurrency';
import { PayoutReleaseQueue } from '../components/features/payments/PayoutReleaseQueue';
import { PaymentIntentsTable } from '../components/features/payments/PaymentIntentsTable';

export type PaymentTab = 'queue' | 'history';
export type FinancialPeriod = 'month' | 'all';

export const PaymentsPage = () => {
  const [activeTab, setActiveTab] = useState<PaymentTab>('queue');
  const [period, setPeriod] = useState<FinancialPeriod>('month');
  const [search, setSearch] = useState('');
  const [selectedShipmentsBySeller, setSelectedShipmentsBySeller] = useState<
    Record<string, string[]>
  >({});
  const debouncedSearch = useDebounce(search, 300);

  const {
    data = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useConnectEarnings(debouncedSearch);

  const {
    batches = [],
    isLoading: isQueueLoading,
    isError: isQueueError,
    refetch: refetchQueue,
    releaseSelectedShipments,
    isReleasing,
  } = useConnectPayoutReleaseQueue(debouncedSearch);

  const isSyncing = isFetching || isQueueLoading;

  // ── 1. CÁLCULO DINÁMICO POR PERÍODO (Sin 'any') ──
  const filteredEarningsData = useMemo(() => {
    if (period === 'all') return data;

    const startOfMonth = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1,
        0,
        0,
        0,
      ),
    );
    return data.filter((row) => {
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      return (
        createdAt && !isNaN(createdAt.getTime()) && createdAt >= startOfMonth
      );
    });
  }, [data, period]);

  const summary = summarizeConnectEarnings(filteredEarningsData);

  // ── 2. CÁLCULO DE DINERO EN ESCROW (Listo vs En Tránsito) ──
  const { readyToPayoutCents, inTransitCents } = useMemo(() => {
    let ready = 0;
    let inTransit = 0;

    batches.forEach((batch) => {
      batch.shipments.forEach((s) => {
        if (s.isEligible) {
          ready += s.releaseAmountCents || 0;
        } else {
          inTransit += s.releaseAmountCents || 0;
        }
      });
    });

    return { readyToPayoutCents: ready, inTransitCents: inTransit };
  }, [batches]);

  // ── 3. HANDLERS DE SELECCIÓN Y DISPERSIÓN ──
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

  const selectAllEligibleGlobally = () => {
    const allSelected: Record<string, string[]> = {};
    batches.forEach((batch) => {
      const eligibleIds = batch.shipments
        .filter((s) => s.isEligible)
        .map((s) => s.shipmentId);
      if (eligibleIds.length > 0) {
        allSelected[batch.sellerId] = eligibleIds;
      }
    });
    setSelectedShipmentsBySeller(allSelected);
  };

  const clearAllSelections = () => {
    setSelectedShipmentsBySeller({});
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

  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchQueue()]);
    toast.success('Datos financieros actualizados');
  };

  if (isError || isQueueError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-platinum">
            Finanzas y Dispersión
          </h1>
          <p className="text-blue-light text-sm mt-1">
            Gestión de pagos a vendedores y comisiones de Stripe Connect.
          </p>
        </div>
        <ErrorState
          title="Error al cargar datos financieros"
          message="No pudimos conectar con la cola de pagos de Stripe Connect. Por favor, reintenta."
          onRetry={handleRefresh}
          isRetrying={isSyncing}
        />
      </div>
    );
  }

  const isCardsLoading =
    (isLoading || isQueueLoading) && data.length === 0 && batches.length === 0;

  return (
    <div className="space-y-8">
      {/* ── HEADER CON BOTÓN DE REFRESH ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-platinum">
            Finanzas y Dispersión
          </h1>
          <p className="text-blue-light text-sm mt-1">
            Control de tesorería, dinero en custodia (Escrow) y pagos de Stripe
            Connect.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isSyncing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-platinum transition-all hover:border-lion hover:text-lion cursor-pointer disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={isSyncing ? 'animate-spin text-lion' : ''}
          />
          {isSyncing ? 'Sincronizando...' : 'Actualizar Datos'}
        </button>
      </div>

      {/* ── SELECTOR DE PERÍODO & 4 TARJETAS FINANCIERAS ── */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-blue-light uppercase tracking-widest">
            Resumen de Tesorería
          </h3>

          {/* Toggle de Período */}
          <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/5">
            <button
              type="button"
              onClick={() => setPeriod('month')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                period === 'month'
                  ? 'bg-lion text-night shadow-md'
                  : 'text-blue-light hover:text-platinum'
              }`}
            >
              <Calendar size={13} /> Este Mes
            </button>
            <button
              type="button"
              onClick={() => setPeriod('all')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                period === 'all'
                  ? 'bg-lion text-night shadow-md'
                  : 'text-blue-light hover:text-platinum'
              }`}
            >
              <Globe size={13} /> Histórico (All-Time)
            </button>
          </div>
        </div>

        {/* Las 4 Tarjetas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-state-gray border border-white/5 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest">
                Volumen Procesado
              </p>
              {isCardsLoading ? (
                <div className="h-8 w-28 bg-white/5 animate-pulse rounded mt-1" />
              ) : (
                <p className="text-2xl font-bold text-platinum mt-1">
                  {formatCurrency(centsToMoney(summary.grossCents))}
                </p>
              )}
            </div>
            <div className="p-3 bg-white/5 rounded-xl text-blue-light">
              <DollarSign size={20} />
            </div>
          </div>

          <div className="bg-state-gray border border-white/5 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest">
                Comisiones Selene
              </p>
              {isCardsLoading ? (
                <div className="h-8 w-24 bg-white/5 animate-pulse rounded mt-1" />
              ) : (
                <p className="text-2xl font-bold text-lion mt-1">
                  {formatCurrency(centsToMoney(summary.applicationFeesCents))}
                </p>
              )}
            </div>
            <div className="p-3 bg-lion/10 rounded-xl text-lion">
              <TrendingUp size={20} />
            </div>
          </div>

          <div className="bg-state-gray border border-white/5 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest">
                Listo para Dispersar
              </p>
              {isCardsLoading ? (
                <div className="h-8 w-28 bg-white/5 animate-pulse rounded mt-1" />
              ) : (
                <p className="text-2xl font-bold text-forest mt-1">
                  {formatCurrency(centsToMoney(readyToPayoutCents))}
                </p>
              )}
            </div>
            <div className="p-3 bg-forest/10 rounded-xl text-forest">
              <Wallet size={20} />
            </div>
          </div>

          <div className="bg-state-gray border border-white/5 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest">
                En Custodia (Tránsito)
              </p>
              {isCardsLoading ? (
                <div className="h-8 w-28 bg-white/5 animate-pulse rounded mt-1" />
              ) : (
                <p className="text-2xl font-bold text-amber-400 mt-1">
                  {formatCurrency(centsToMoney(inTransitCents))}
                </p>
              )}
            </div>
            <div className="p-3 bg-amber-400/10 rounded-xl text-amber-400">
              <ShieldCheck size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* ── NAVEGACIÓN POR SUB-PESTAÑAS (TABS) ── */}
      <div className="flex gap-2 p-1 bg-white/5 w-fit rounded-xl border border-white/5">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'queue'
              ? 'bg-lion text-night shadow-lg'
              : 'text-blue-light hover:text-platinum'
          }`}
        >
          <Wallet size={15} /> Cola de Dispersión ({batches.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'history'
              ? 'bg-lion text-night shadow-lg'
              : 'text-blue-light hover:text-platinum'
          }`}
        >
          <Receipt size={15} /> Historial de Transacciones ({data.length})
        </button>
      </div>

      {/* ── BUSCADOR CONTEXTUAL CON BOTÓN DE LIMPIEZA ── */}
      <div className="relative w-full md:w-96">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-light"
          size={18}
        />
        <input
          type="text"
          placeholder={
            activeTab === 'queue'
              ? 'Buscar por nombre de vendedor en la cola...'
              : 'Buscar en el historial de transacciones...'
          }
          className="w-full bg-state-gray border border-white/10 rounded-xl py-2 pl-10 pr-10 text-sm text-platinum focus:border-lion outline-none transition-all focus:ring-2 focus:ring-lion/50"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search.length > 0 && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-light hover:text-platinum cursor-pointer"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* ── CONTENIDO DINÁMICO POR PESTAÑA ── */}
      {activeTab === 'queue' ? (
        <PayoutReleaseQueue
          batches={batches}
          isLoading={isQueueLoading}
          isReleasing={isReleasing}
          selectedShipmentsBySeller={selectedShipmentsBySeller}
          onToggleShipment={toggleShipmentSelection}
          onSelectEligibleBatch={selectEligibleBatch}
          onSelectAllEligibleGlobally={selectAllEligibleGlobally}
          onClearAllSelections={clearAllSelections}
          onRelease={handleRelease}
        />
      ) : (
        <PaymentIntentsTable data={data} isLoading={isLoading} />
      )}
    </div>
  );
};

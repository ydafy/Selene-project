import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConnectPayoutReleaseQueue } from '../hooks/useConnectPayoutReleaseQueue';
import { useDebounce } from '../hooks/useDebounce';
import { getSelectedEligibleShipmentIds, type ReleaseQueueBatch, type ReleaseQueueRun, type ReleaseQueueActionRequiredRun } from '../lib/connectPayoutReleaseQueue';
import { ErrorState } from '../components/ui/ErrorState';
import { formatTime } from '../lib/utils/formatDate';
import { PayoutReleaseWorkbench } from '../components/features/payments/PayoutReleaseWorkbench';
import { ActionRequiredPanel } from '../components/features/payments/ActionRequiredPanel';
import { PayoutRunsWorkbench } from '../components/features/payments/PayoutRunsWorkbench';
import { workbenchFocus } from '../components/features/payments/PayoutWorkbenchLayout';

export type PaymentTab = 'ready' | 'processing' | 'action-required' | 'history';

const WORKSPACES = [
  { id: 'ready', label: 'Por liberar', icon: Wallet },
  { id: 'action-required', label: 'Necesita atención', icon: AlertTriangle },
  { id: 'processing', label: 'En proceso', icon: Clock3 },
  { id: 'history', label: 'Historial', icon: ShieldCheck },
] as const;

export const PaymentsPage = () => {
  const [activeTab, setActiveTab] = useState<PaymentTab>('ready');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedBatches, setSelectedBatches] = useState<ReleaseQueueBatch[]>([]);
  const [selectedPageEvidence, setSelectedPageEvidence] = useState('');
  const [selectedShipmentsBySeller, setSelectedShipmentsBySeller] = useState<
    Record<string, string[]>
  >({});
  const [refreshing, setRefreshing] = useState(false);
  const [workbenchBusy, setWorkbenchBusy] = useState(false);
  const requestInFlight = useRef(false);
  const debouncedSearch = useDebounce(search, 300);
  const {
    pageRevision,
    pagination,
    lastSuccessfulFetchAt = null,
    counts: serverCounts,
    fetchSelection,
    batches = [],
    processingRuns = [],
    actionRequiredRuns = [],
    historyRuns = [],
    isLoading: isQueueLoading,
    isFetching: isQueueFetching = false,
    isError: isQueueError,
    refetch: refetchQueue,
    releaseSelectedShipments,
    isReleasing,
    retryFailedPayout,
    isRetrying,
  } = useConnectPayoutReleaseQueue(debouncedSearch, { bucket: activeTab, page });
  useLayoutEffect(() => {
    if (pagination && pagination.page !== page) setPage(pagination.page);
  }, [pagination, page]);
  // A complete read wins over the page committed before it began. Any later
  // page commit reconciles overlapping groups again, even if values repeat.
  const pageEvidence = JSON.stringify([pageRevision, batches, actionRequiredRuns, debouncedSearch, activeTab, page]);
  const selectionBatches = selectedPageEvidence === pageEvidence
    ? [...selectedBatches, ...batches.filter((item) => !selectedBatches.some((next) => next.sellerId === item.sellerId))]
    : [...selectedBatches.filter((item) => !batches.some((next) => next.sellerId === item.sellerId)), ...batches];
  const rememberBatches = () => {
    setSelectedBatches(selectionBatches);
    setSelectedPageEvidence(pageEvidence);
  };
  const financialBusy = isReleasing || isRetrying || workbenchBusy;
  const queueUnresolved = isQueueLoading || isQueueFetching || refreshing || search !== debouncedSearch;
  const isSyncing = refreshing || isQueueLoading;
  const authority = {
    batches, actionRequiredRuns, selectedShipmentsBySeller, queueUnresolved,
    isQueueError, releaseSelectedShipments, retryFailedPayout, fetchSelection,
    search: debouncedSearch, activeTab, pageEvidence,
  };
  const evidence = JSON.stringify([pageEvidence, queueUnresolved, isQueueError]);
  const authorization = useRef({ evidence, epoch: 0 });
  const current = useRef(authority);
  useLayoutEffect(() => {
    // Publish only committed evidence. Recovery cannot erase a prior interval,
    // and even an off-page action is invalidated by a superseding queue read.
    if (authorization.current.evidence !== evidence) {
      authorization.current = { evidence, epoch: authorization.current.epoch + 1 };
    }
    current.current = authority;
  });
  const counts = serverCounts ?? {
    ready: batches.length,
    'action-required': actionRequiredRuns.length,
    processing: processingRuns.length,
    history: historyRuns.length,
  };

  const toggleShipment = (sellerId: string, shipmentId: string) => {
    if (financialBusy || queueUnresolved || isQueueError) return;
    rememberBatches();
    setSelectedShipmentsBySeller((selection) => {
      const selected = selection[sellerId] ?? [];
      return {
        ...selection,
        [sellerId]: selected.includes(shipmentId)
          ? selected.filter((id) => id !== shipmentId)
          : [...selected, shipmentId],
      };
    });
  };
  const handleRelease = async (sellerId: string, expected?: { sellerId: string; stripeAccountId: string | null; ids: string[]; cents: number }) => {
    const source = current.current;
    const epoch = authorization.current.epoch;
    if (requestInFlight.current || source.queueUnresolved || source.isQueueError ||
      (typeof source.fetchSelection === 'function' && (!expected || source.activeTab !== 'ready')))
      throw new Error('Espera a que se actualice la cola antes de autorizar.');
    requestInFlight.current = true;
    try {
      // Always make a new complete read; cached selections are review data only.
      const fresh = source.fetchSelection ? await source.fetchSelection() : null;
      if (authorization.current.epoch !== epoch || current.current.queueUnresolved || current.current.isQueueError ||
        current.current.search !== source.search || current.current.activeTab !== source.activeTab)
        throw new Error('La consulta cambió; revisa la selección.');
      const batch = (fresh?.releaseBatches ?? source.batches).find((item) => item.sellerId === sellerId);
      if (!batch) throw new Error('Este vendedor ya no está en la cola. Actualiza los datos.');
      const shipmentIds = getSelectedEligibleShipmentIds(batch, current.current.selectedShipmentsBySeller[sellerId] ?? []);
      if (!shipmentIds.length) throw new Error('No hay envíos elegibles seleccionados.');
      const cents = batch.shipments.filter((item) => shipmentIds.includes(item.shipmentId)).reduce((sum, item) => sum + item.releaseAmountCents, 0);
      if (expected && (JSON.stringify([...shipmentIds].sort()) !== JSON.stringify(expected.ids) ||
        expected.cents !== cents || expected.stripeAccountId !== batch.stripeAccountId))
        throw new Error('La selección, importe o cuenta cambió; revisa la cola.');
      await source.releaseSelectedShipments({ batch, shipmentIds });
      setSelectedShipmentsBySeller((selection) => ({ ...selection, [sellerId]: [] }));
    } finally { requestInFlight.current = false; }
  };
  const handleRetry = async (runId: string, expected?: ReleaseQueueRun | ReleaseQueueActionRequiredRun) => {
    const source = current.current;
    const epoch = authorization.current.epoch;
    if (requestInFlight.current || source.queueUnresolved || source.isQueueError ||
      (typeof source.fetchSelection === 'function' && (!expected || source.activeTab !== 'action-required')))
      throw new Error('La cola no permite reintentar esta ejecución. Actualiza los datos.');
    requestInFlight.current = true;
    try {
      const fresh = source.fetchSelection ? await source.fetchSelection() : null;
      const run = (fresh?.actionRequiredRuns ?? source.actionRequiredRuns).find((item) => item.runId === runId);
      if (!run?.canRetry || run.status !== 'failed' || run.reason !== 'retryable_failed')
        throw new Error('La cola no permite reintentar esta ejecución. Actualiza los datos.');
      if (authorization.current.epoch !== epoch || current.current.queueUnresolved || current.current.isQueueError ||
        current.current.search !== source.search || current.current.activeTab !== source.activeTab ||
        !run?.canRetry || run.status !== 'failed' || run.reason !== 'retryable_failed' ||
        (expected && (run.amountCents !== expected.amountCents || run.sellerId !== expected.sellerId || run.retryOfRunId !== expected.retryOfRunId)))
        throw new Error('La cola cambió; revisa las condiciones actuales.');
      await source.retryFailedPayout({ retryRunId: runId });
    } finally { requestInFlight.current = false; }
  };
  const handleRefresh = async () => {
    if (financialBusy || refreshing) return;
    setRefreshing(true);
    try {
      const result = await refetchQueue();
      if (result.isError) toast.error('No se pudieron actualizar los datos.');
      else toast.success('Consulta actualizada');
    } catch {
      toast.error('No se pudieron actualizar los datos.');
    } finally {
      setRefreshing(false);
    }
  };
  const changeSearch = (value: string) => {
    if (financialBusy) return;
    setSelectedShipmentsBySeller({});
    setSelectedBatches([]);
    setPage(0);
    setSearch(value);
  };
  const navigateTab = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (financialBusy) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % WORKSPACES.length;
        break;
      case 'ArrowLeft':
        next = (index + WORKSPACES.length - 1) % WORKSPACES.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = WORKSPACES.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setPage(0);
    setActiveTab(WORKSPACES[next].id);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      );
    tabs?.[next]?.focus();
  };
  const currentRuns =
    activeTab === 'processing'
      ? processingRuns
      : activeTab === 'action-required'
        ? actionRequiredRuns
        : historyRuns;

  const runsWorkbench = activeTab === 'ready' ? null : (
    <PayoutRunsWorkbench
      key={`${activeTab}:${debouncedSearch}`}
      mode={activeTab}
      runs={isQueueError ? [] : currentRuns}
      pageRevision={pageEvidence}
      pagination={pagination}
      onPageChange={(next) => { if (!financialBusy) setPage(next); }}
      onSelectAll={async () => {
        const source = current.current;
        const epoch = authorization.current.epoch;
        if (source.queueUnresolved || source.isQueueError) throw new Error('Espera a que se actualice la cola.');
        const complete = await fetchSelection();
        if (authorization.current.epoch !== epoch || current.current.queueUnresolved || current.current.isQueueError ||
          current.current.search !== source.search || current.current.activeTab !== source.activeTab)
          throw new Error('La consulta cambió; vuelve a seleccionar.');
        return complete.actionRequiredRuns;
      }}
      isLoading={queueUnresolved || isQueueError}
      isReleasing={isReleasing}
      isRetrying={isRetrying}
      onBusyChange={setWorkbenchBusy}
      onRetryFailedPayout={handleRetry}
    />
  );

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-lion">
            Selene · Operación financiera
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-platinum sm:text-3xl">
            Finanzas y Dispersión
          </h1>
          <p className="mt-2 text-sm text-blue-light">
            Libera pagos a vendedores y atiende las dispersiones que requieren
            seguimiento.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isSyncing || financialBusy}
          className={`inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-white/10 bg-state-gray px-4 py-2.5 text-xs font-semibold text-platinum transition-colors hover:border-lion/40 disabled:opacity-40 ${workbenchFocus}`}
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? 'Actualizando...' : 'Actualizar consulta'}
        </button>
      </header>
      <nav
        role="tablist"
        aria-label="Áreas de trabajo financiero"
        className="flex w-fit min-w-0 max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/5 bg-state-gray p-1.5"
      >
        {WORKSPACES.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            id={`payments-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="payments-workspace"
            tabIndex={activeTab === id ? 0 : -1}
            disabled={financialBusy}
            onClick={() => {
              if (!financialBusy) { setPage(0); setActiveTab(id); }
            }}
            onKeyDown={(event) => navigateTab(event, index)}
            className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-3 text-xs font-semibold transition-colors disabled:opacity-40 ${workbenchFocus} ${activeTab === id ? 'bg-lion/10 text-lion' : 'text-blue-light hover:bg-white/5 hover:text-platinum'}`}
          >
            <Icon
              size={16}
              className={
                id === 'action-required' && actionRequiredRuns.length > 0
                  ? 'text-amber-400'
                  : ''
              }
            />
            <span>{label}</span>
            <span
              aria-label={`${id === 'ready' ? 'Vendedores en cola' : 'Ejecuciones'}: ${queueUnresolved || isQueueError ? 'consultando' : counts[id]}`}
              className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${id === 'action-required' && counts[id] > 0 ? 'bg-amber-400/10 text-amber-400' : 'bg-white/5'}`}
            >
              {queueUnresolved || isQueueError ? '—' : counts[id]}
            </span>
          </button>
        ))}
      </nav>
      <div className="relative">
        <Search
          size={17}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-blue-light"
        />
        <input
          type="search"
          aria-label="Buscar vendedor en dispersiones"
          placeholder="Buscar vendedor en la cola..."
          value={search}
          disabled={financialBusy}
          onChange={(event) => changeSearch(event.target.value)}
          className={`w-full rounded-2xl border border-white/10 bg-state-gray py-3 pl-11 pr-12 text-sm text-platinum placeholder:text-blue-light/70 disabled:opacity-40 ${workbenchFocus}`}
        />
        {search ? (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            disabled={financialBusy}
            onClick={() => changeSearch('')}
            className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-blue-light hover:text-platinum ${workbenchFocus}`}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
      <section
        id="payments-workspace"
        role="tabpanel"
        aria-labelledby={`payments-tab-${activeTab}`}
        aria-label="Mesa operativa de pagos"
        className="min-w-0"
      >
        {isQueueError ? (
          <ErrorState
            title="Error al cargar datos financieros"
            message="No pudimos cargar la cola. No autorices ni reintentes hasta actualizar los datos."
            onRetry={handleRefresh}
            isRetrying={isSyncing || financialBusy}
          />
        ) : null}
        {activeTab === 'ready' ? (
          <PayoutReleaseWorkbench
            key={`ready:${debouncedSearch}`}
            batches={isQueueError ? [] : batches}
            selectionBatches={selectionBatches}
            pagination={pagination}
            onPageChange={(next) => { if (!financialBusy) setPage(next); }}
            onSelectAll={async () => {
              if (queueUnresolved || isQueueError) throw new Error('Espera a que se actualice la cola.');
              const source = current.current;
              const epoch = authorization.current.epoch;
              const complete = await fetchSelection();
              if (authorization.current.epoch !== epoch || current.current.queueUnresolved || current.current.isQueueError ||
                current.current.search !== source.search || current.current.activeTab !== source.activeTab)
                throw new Error('La consulta cambió; vuelve a seleccionar.');
              setSelectedBatches(complete.releaseBatches);
              setSelectedPageEvidence(source.pageEvidence);
              setSelectedShipmentsBySeller(Object.fromEntries(complete.releaseBatches.map((item) => [item.sellerId,
                getSelectedEligibleShipmentIds(item, item.shipments.map((shipment) => shipment.shipmentId))])));
            }}
            isLoading={queueUnresolved || isQueueError}
            isReleasing={isReleasing || isRetrying}
            selectedShipmentsBySeller={selectedShipmentsBySeller}
            onToggleShipment={toggleShipment}
            onSelectEligibleBatch={(sellerId, shipmentIds) => {
              if (financialBusy || queueUnresolved || isQueueError) return;
              rememberBatches();
              setSelectedShipmentsBySeller((selection) => ({
                ...selection,
                [sellerId]: shipmentIds,
              }));
            }}
            onClearAllSelections={() => {
              if (!financialBusy) { setSelectedShipmentsBySeller({}); setSelectedBatches([]); }
            }}
            onBusyChange={setWorkbenchBusy}
            onRelease={handleRelease}
          />
        ) : activeTab === 'action-required' ? (
          <ActionRequiredPanel payoutCount={actionRequiredRuns.length}>{runsWorkbench}</ActionRequiredPanel>
        ) : (
          runsWorkbench
        )}
      </section>
      <div className="space-y-1 text-[10px] leading-relaxed text-blue-light">
        <p>
          {lastSuccessfulFetchAt ? (
            <>
              Última consulta exitosa de esta página:{' '}
              <time dateTime={new Date(lastSuccessfulFetchAt).toISOString()}>
                {formatTime(new Date(lastSuccessfulFetchAt).toISOString())}
              </time>.
            </>
          ) : 'Sin consulta exitosa todavía.'}{' '}
          Actualización automática cada 30 segundos. No indica sincronización con Stripe.
        </p>
        <p>
          {search.trim() ? 'Resultados de la búsqueda.' : 'Resultados de la consulta.'}{' '}
          Contadores de la consulta actual, no totales globales:{' '}
          vendedores en Por liberar; ejecuciones en las demás pestañas.
          {' '}Los importes de la cola no representan un saldo Stripe.
        </p>
      </div>
    </div>
  );
};

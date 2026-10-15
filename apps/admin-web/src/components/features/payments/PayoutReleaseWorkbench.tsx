import { useLayoutEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  LockKeyhole,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { SelectionActionSummary } from '../../ui/SelectionActionSummary';
import { Modal } from '../../ui/Modal';
import { centsToMoney } from '../../../lib/connectEarnings';
import {
  getSelectedEligibleShipmentIds,
  type ReleaseQueueBatch,
} from '../../../lib/connectPayoutReleaseQueue';
import { formatCurrency } from '../../../lib/utils/formatCurrency';

import {
  PAYOUT_PAGE_SIZE,
  PayoutPagination,
  workbenchFocus,
} from './PayoutWorkbenchLayout';

const eligibleIdsFor = (batch: ReleaseQueueBatch) =>
  getSelectedEligibleShipmentIds(
    batch,
    batch.shipments
      .filter(
        (shipment) => shipment.isEligible && shipment.releaseAmountCents > 0,
      )
      .map((shipment) => shipment.shipmentId),
  );

const snapshotFor = (
  batches: ReleaseQueueBatch[],
  selection: Record<string, string[]>,
) =>
  batches.flatMap((batch) => {
    const eligible = new Set(eligibleIdsFor(batch));
    const ids = getSelectedEligibleShipmentIds(
      batch,
      selection[batch.sellerId] ?? [],
    )
      .filter((id) => eligible.has(id))
      .sort();
    const selected = new Set(ids);
    const cents = batch.shipments.reduce(
      (sum, shipment) =>
        sum +
        (selected.has(shipment.shipmentId) ? shipment.releaseAmountCents : 0),
      0,
    );
    return ids.length && cents > 0
      ? [
          {
            sellerId: batch.sellerId,
            stripeAccountId: batch.stripeAccountId,
            ids,
            cents,
          },
        ]
      : [];
  });

interface PayoutReleaseWorkbenchProps {
  batches: ReleaseQueueBatch[];
  isLoading: boolean;
  isReleasing: boolean;
  selectedShipmentsBySeller: Record<string, string[]>;
  onToggleShipment: (sellerId: string, shipmentId: string) => void;
  onSelectEligibleBatch: (sellerId: string, shipmentIds: string[]) => void;
  onClearAllSelections: () => void;
  onRelease: (sellerId: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

const buttonFocus = workbenchFocus;
const secondaryAction = `rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-platinum transition-colors hover:border-lion/50 disabled:opacity-40 ${buttonFocus}`;
const money = (cents: number) => formatCurrency(centsToMoney(cents));
const reasonLabel = (reason: string | null) =>
  reason?.replaceAll('_', ' ').toLowerCase() ?? 'Elegibilidad pendiente';

export const PayoutReleaseWorkbench = ({
  batches,
  isLoading,
  isReleasing,
  selectedShipmentsBySeller,
  onToggleShipment,
  onSelectEligibleBatch,
  onClearAllSelections,
  onRelease,
  onBusyChange,
}: PayoutReleaseWorkbenchProps) => {
  const [focusedSellerId, setFocusedSellerId] = useState<string | null>(null);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState<{
    accepted: number;
    stopped: string | null;
    remaining: number;
  } | null>(null);
  const reviewedSnapshot = useRef<ReturnType<typeof snapshotFor>>([]);
  const latest = useRef({
    batches,
    selectedShipmentsBySeller,
    isLoading,
    isReleasing,
  });
  // Publish only committed props before any post-commit confirmation can run.
  useLayoutEffect(() => {
    latest.current = {
      batches,
      selectedShipmentsBySeller,
      isLoading,
      isReleasing,
    };
  }, [batches, selectedShipmentsBySeller, isLoading, isReleasing]);
  // Review and dispatch share the same integer-cents, account-bound snapshot.
  const snapshot = snapshotFor(batches, selectedShipmentsBySeller);
  const currentKey = JSON.stringify(snapshot);
  const isReviewed =
    reviewKey === currentKey && snapshot.length > 0 && !isLoading;
  const activeReview = useRef<string | null>(null);
  useLayoutEffect(() => {
    activeReview.current = isReviewed ? reviewKey : null;
  }, [isReviewed, reviewKey]);
  if (reviewKey !== null && !isReviewed) setReviewKey(null);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(batches.length / PAYOUT_PAGE_SIZE) - 1),
  );
  const visible = batches.slice(
    currentPage * PAYOUT_PAGE_SIZE,
    (currentPage + 1) * PAYOUT_PAGE_SIZE,
  );
  // Keep outcomes outside queue-specific states so refresh cannot hide uncertainty.
  const outcome = progress ? (
    <p
      role={releaseError ? 'alert' : 'status'}
      className="mb-3 text-sm text-blue-light"
    >
      {progress.accepted} aceptadas ·{' '}
      {progress.stopped
        ? `Resultado no confirmado: ${progress.stopped} · `
        : ''}
      {progress.remaining} sin intentar
      {releaseError
        ? ` · ${releaseError}. Actualiza la cola antes de volver a actuar.`
        : ''}
    </p>
  ) : null;
  const batch = batches[0];
  const detailBatch = batches.find((item) => item.sellerId === focusedSellerId);
  const busy = isReleasing || submitting;

  if (isLoading)
    return (
      <div>
        {outcome}
        <div
          role="status"
          className="rounded-3xl border border-white/5 bg-state-gray p-12 text-center text-sm text-blue-light"
        >
          <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-lion border-t-transparent" />
          Consultando cola de dispersión en Stripe Connect...
        </div>
      </div>
    );
  if (!batch)
    return (
      <div>
        {outcome}
        <div className="rounded-3xl border border-white/5 bg-state-gray p-12 text-center">
          <CheckCircle2 className="mx-auto mb-4 text-lion" size={30} />
          <h3 className="font-bold text-platinum">
            No hay pagos pendientes de liberación
          </h3>
          <p className="mt-2 text-sm text-blue-light">
            No hay resultados en esta cola. Revisa la búsqueda o consultá las
            dispersiones en proceso.
          </p>
        </div>
      </div>
    );

  const selectedIds =
    snapshot.find((item) => item.sellerId === detailBatch?.sellerId)?.ids ?? [];
  const selectedSet = new Set(selectedIds);
  const selectedCents = (detailBatch?.shipments ?? []).reduce(
    (sum, shipment) =>
      sum +
      (selectedSet.has(shipment.shipmentId) ? shipment.releaseAmountCents : 0),
    0,
  );
  const eligibleIds = detailBatch ? eligibleIdsFor(detailBatch) : [];
  const totalCents = snapshot.reduce((sum, item) => sum + item.cents, 0);
  const shipmentCount = snapshot.reduce(
    (sum, item) => sum + item.ids.length,
    0,
  );
  const confirmRelease = async () => {
    if (
      !isReviewed ||
      activeReview.current !== currentKey ||
      busy ||
      inFlight.current ||
      totalCents <= 0
    )
      return;
    inFlight.current = true;
    onBusyChange?.(true);
    setSubmitting(true);
    setReleaseError(null);
    // Parent callbacks clear accepted selections; retain our immutable review.
    const frozen = reviewedSnapshot.current;
    setReviewKey(null);
    let accepted = 0;
    setProgress({ accepted, stopped: null, remaining: frozen.length });
    try {
      for (const item of frozen) {
        const next = latest.current;
        const fresh = snapshotFor(
          next.batches,
          next.selectedShipmentsBySeller,
        ).find((s) => s.sellerId === item.sellerId);
        try {
          if (
            next.isLoading ||
            JSON.stringify(fresh) !== JSON.stringify(item)
          ) {
            throw new Error(
              'La selección, importe o cuenta cambió; revisa la cola.',
            );
          }
          await onRelease(item.sellerId);
          accepted++;
          setProgress({
            accepted,
            stopped: null,
            remaining: frozen.length - accepted,
          });
        } catch (error) {
          setReleaseError(
            error instanceof Error
              ? error.message
              : 'No se pudo iniciar la dispersión.',
          );
          setProgress({
            accepted,
            stopped: item.sellerId,
            remaining: frozen.length - accepted - 1,
          });
          break;
        }
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div>
      {outcome}
      <SelectionActionSummary
        label="Selección para liberar"
        title="Total a liberar"
        amountLabel="Importe seleccionado para liberar"
        amount={money(totalCents)}
        unit="MXN"
        selection={
          <>
            {snapshot.length} vendedores · {shipmentCount} envíos seleccionados
          </>
        }
        description="Liberar inicia el envío del dinero al banco del vendedor; no confirma que ya haya llegado a su cuenta."
        actions={
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              className={secondaryAction}
              onClick={() => {
                for (const item of batches)
                  onSelectEligibleBatch(item.sellerId, eligibleIdsFor(item));
                setReviewKey(null);
              }}
            >
              Seleccionar todos los elegibles
            </button>
            <button
              type="button"
              disabled={busy}
              className={secondaryAction}
              onClick={() => {
                onClearAllSelections();
                setReviewKey(null);
              }}
            >
              Limpiar selección
            </button>
          </div>
        }
      >
        {isReviewed ? (
          <div aria-label="Confirmación de liberación">
            <p className="text-sm text-platinum">
              Autorizar {money(totalCents)} · {snapshot.length} vendedores
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                className={`rounded-xl bg-lion px-4 py-3 text-sm font-bold text-night disabled:opacity-40 ${buttonFocus}`}
                onClick={confirmRelease}
              >
                Confirmar liberación
              </button>
              <button
                type="button"
                disabled={busy}
                className={secondaryAction}
                onClick={() => setReviewKey(null)}
              >
                Volver a revisar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || !snapshot.length}
            className={`mt-3 rounded-xl bg-lion px-4 py-3 text-night disabled:opacity-40 ${buttonFocus}`}
            onClick={() => {
              reviewedSnapshot.current = snapshot;
              setReviewKey(currentKey);
            }}
          >
            Liberar
          </button>
        )}
      </SelectionActionSummary>
      <section
        aria-label="Vendedores por liberar"
        className="min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-state-gray shadow-xl shadow-black/10"
      >
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-light">
            Vendedores{' '}
            <span className="ml-2 text-platinum">{batches.length}</span>
          </p>
          <Wallet size={16} className="text-lion" />
        </div>
        <div className="divide-y divide-white/5">
          {visible.map((item) => {
            const eligible = eligibleIdsFor(item);
            const selected =
              snapshot.find((entry) => entry.sellerId === item.sellerId)?.ids
                .length ?? 0;
            const partial = selected > 0 && selected < eligible.length;
            return (
              <button
                key={item.sellerId}
                type="button"
                aria-label={`Ver detalle de ${item.sellerName ?? item.sellerId}`}
                aria-haspopup="dialog"
                disabled={busy}
                onClick={() => {
                  if (!busy) setFocusedSellerId(item.sellerId);
                }}
                className={`group relative flex w-full items-center gap-4 border-l-2 px-5 py-7 text-left transition-colors disabled:cursor-wait ${buttonFocus} ${selected > 0 ? 'border-l-forest bg-forest/10' : 'border-l-transparent hover:bg-white/[0.03]'}`}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-base font-bold text-lion">
                  {(item.sellerName ?? item.sellerId).slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-platinum">
                    {item.sellerName ? `@${item.sellerName}` : item.sellerId}
                  </span>
                  <span className="mt-2 block text-xs text-blue-light">
                    {item.eligibleShipmentCount} listos
                    {item.ineligibleShipmentCount > 0
                      ? ` · ${item.ineligibleShipmentCount} pendientes`
                      : ''}
                  </span>
                  {selected > 0 ? (
                    <span className="mt-2 block text-xs font-semibold text-forest">
                      {selected} de {eligible.length} seleccionados
                    </span>
                  ) : null}
                </span>
                <span className="text-right">
                  <span className="block text-base font-semibold tabular-nums text-lion">
                    {money(item.totalEligibleAmountCents)}
                  </span>
                  <span className="mt-1 block text-[10px] text-blue-light">
                    Elegible · MXN
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-blue-light" />
                {selected > 0 ? (
                  <span
                    aria-label={
                      partial
                        ? 'Selección parcial'
                        : 'Todos los elegibles seleccionados'
                    }
                    className="absolute right-4 top-3 text-forest"
                  >
                    <CheckCircle2 size={16} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <PayoutPagination
          page={currentPage}
          total={batches.length}
          label="vendedores"
          display="pages"
          disabled={busy}
          onPageChange={(next) => {
            setPage(next);
            setFocusedSellerId(null);
          }}
        />
      </section>

      {detailBatch ? (
        <Modal
          title="Revisión por vendedor"
          onClose={() => setFocusedSellerId(null)}
        >
          <section aria-label="Detalle de liberación">
            <header className="border-b border-white/5 p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-lion">
                <ShieldCheck size={14} /> Revisión por vendedor
              </div>
              <h3 className="break-words text-xl font-bold text-platinum">
                {detailBatch.sellerName
                  ? `@${detailBatch.sellerName}`
                  : detailBatch.sellerId}
              </h3>
              <p className="mt-2 text-xs text-blue-light">
                Cuenta Connect{' '}
                <code className="ml-1 break-all text-platinum">
                  {detailBatch.stripeAccountId ?? 'Sin cuenta vinculada'}
                </code>
              </p>
              <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-blue-light">
                    Disponible para autorizar
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-lion">
                    {money(detailBatch.totalEligibleAmountCents)}{' '}
                    <span className="text-xs font-medium text-blue-light">
                      MXN
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || eligibleIds.length === 0}
                  onClick={() => {
                    onSelectEligibleBatch(detailBatch.sellerId, eligibleIds);
                    setReviewKey(null);
                  }}
                  className={`rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-platinum hover:border-lion/50 disabled:opacity-40 ${buttonFocus}`}
                >
                  Seleccionar elegibles
                </button>
              </div>
            </header>
            <div className="px-5 sm:px-6">
              {detailBatch.shipments.map((shipment) => (
                <div
                  key={shipment.shipmentId}
                  className={`flex gap-3 border-b border-white/5 py-5 ${shipment.isEligible ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar envío ${shipment.shipmentId}`}
                    checked={selectedSet.has(shipment.shipmentId)}
                    disabled={
                      !shipment.isEligible ||
                      shipment.releaseAmountCents <= 0 ||
                      busy
                    }
                    onChange={() => {
                      onToggleShipment(
                        detailBatch.sellerId,
                        shipment.shipmentId,
                      );
                      setReviewKey(null);
                    }}
                    className={`mt-1 h-4 w-4 shrink-0 accent-lion disabled:opacity-30 ${buttonFocus}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap justify-between gap-2">
                      <span className="text-xs font-bold text-platinum">
                        Envío{' '}
                        <code className="font-normal">
                          {shipment.shipmentId.slice(0, 8)}
                        </code>
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-platinum">
                        {money(shipment.releaseAmountCents)}
                      </span>
                    </span>
                    <span
                      className={`mt-2 flex items-center gap-1.5 text-xs ${shipment.isEligible ? 'text-forest' : 'text-blue-light'}`}
                    >
                      {shipment.isEligible ? (
                        <CheckCircle2 size={12} />
                      ) : (
                        <LockKeyhole size={12} />
                      )}
                      {shipment.isEligible
                        ? 'Elegible para liberar'
                        : reasonLabel(shipment.ineligibleReason)}
                    </span>
                    <details className="mt-2 break-all font-mono text-[10px] leading-relaxed text-blue-light">
                      <summary>Referencias técnicas</summary>
                      <span>
                        Envío: {shipment.shipmentId}
                        <br />
                        Orden: {shipment.orderId}
                        <br />
                        PaymentIntent:{' '}
                        {shipment.stripePaymentIntentId ?? 'No disponible'}
                      </span>
                    </details>
                    {shipment.completedAt ? (
                      <span className="mt-1 block text-[10px] text-blue-light">
                        Completado:{' '}
                        {new Date(shipment.completedAt).toLocaleString('es-MX')}
                      </span>
                    ) : null}
                    {!shipment.isEligible && shipment.ineligibleReason ? (
                      <code className="mt-1 block break-all text-[10px] text-blue-light">
                        {shipment.ineligibleReason}
                      </code>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
            <footer className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-blue-light">
                    {selectedIds.length} envíos seleccionados
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-platinum">
                    {money(selectedCents)}{' '}
                    <span className="text-xs text-blue-light">MXN</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSelectEligibleBatch(detailBatch.sellerId, []);
                    setReviewKey(null);
                  }}
                  disabled={busy}
                  className={secondaryAction}
                >
                  Limpiar selección del vendedor
                </button>
              </div>

              {releaseError ? (
                <p role="alert" className="mt-3 break-words text-xs text-fire">
                  No pudimos confirmar el resultado: {releaseError}. Actualiza
                  la cola antes de volver a actuar.
                </p>
              ) : null}
              <p className="mt-4 text-[10px] leading-relaxed text-blue-light">
                Solo se incluyen envíos elegibles de este vendedor. Los importes
                de la cola no representan un saldo bancario.
              </p>
            </footer>
          </section>
        </Modal>
      ) : null}
    </div>
  );
};

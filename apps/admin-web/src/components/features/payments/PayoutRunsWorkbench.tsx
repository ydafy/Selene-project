import { useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSearch,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { CopyableReference } from '../../ui/CopyableReference';
import { SelectionActionSummary } from '../../ui/SelectionActionSummary';
import { centsToMoney } from '../../../lib/connectEarnings';
import type {
  ReleaseQueueActionRequiredRun,
  ReleaseQueueRun,
} from '../../../lib/connectPayoutReleaseQueue';
import { formatCurrency } from '../../../lib/utils/formatCurrency';

import {
  PAYOUT_PAGE_SIZE,
  PayoutPagination,
  workbenchFocus as focus,
  workbenchGrid,
  workbenchPanel,
  workbenchScroll,
} from './PayoutWorkbenchLayout';

export type PayoutRunsMode = 'processing' | 'action-required' | 'history';
interface PayoutRunsWorkbenchProps {
  mode: PayoutRunsMode;
  runs: (ReleaseQueueRun | ReleaseQueueActionRequiredRun)[];
  onBusyChange?: (busy: boolean) => void;
  isLoading?: boolean;
  isRetrying: boolean;
  isReleasing: boolean;
  onRetryFailedPayout: (runId: string) => Promise<void>;
}
const batchControl = `rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-platinum transition-colors hover:border-lion/50 disabled:opacity-40 ${focus}`;
const money = (cents: number) => formatCurrency(centsToMoney(cents));
const sellerLabel = (run: ReleaseQueueRun) =>
  run.sellerName
    ? `@${run.sellerName}`
    : (run.sellerId ?? 'Vendedor no identificado');
const emptyTitles: Record<PayoutRunsMode, string> = {
  processing: 'No hay dispersiones en proceso',
  'action-required': 'Nada requiere atención',
  history: 'Sin dispersiones pagadas todavía',
};
const reasonLabels: Record<ReleaseQueueActionRequiredRun['reason'], string> = {
  retryable_failed: 'Fallida · revisión de reintento',
  failed: 'Fallo sin reintento disponible',
  reconciliation_needed: 'Conciliación requerida',
  canceled: 'Dispersión cancelada',
  manual_review: 'Revisión manual',
  unexpected_status: 'Estado no reconocido',
};
function attentionRun(
  run: ReleaseQueueRun | ReleaseQueueActionRequiredRun,
): ReleaseQueueActionRequiredRun | null {
  return 'reason' in run ? run : null;
}

export const PayoutRunsWorkbench = ({
  mode,
  runs,
  isRetrying,
  isReleasing,
  onRetryFailedPayout,
  onBusyChange,
  isLoading = false,
}: PayoutRunsWorkbenchProps) => {
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const [review, setReviewState] = useState<
    (ReleaseQueueRun | ReleaseQueueActionRequiredRun)[] | null
  >(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const confirmationRef = useRef<HTMLElement>(null);
  const latest = useRef({ runs, mode, isLoading, isRetrying, isReleasing });
  const activeReview = useRef<typeof review>(null);
  const setReview = (next: typeof review) => {
    activeReview.current = next;
    setReviewState(next);
  };
  const eligible = (item: ReleaseQueueRun | ReleaseQueueActionRequiredRun) => {
    const details = attentionRun(item);
    return (
      !isLoading &&
      mode === 'action-required' &&
      item.status === 'failed' &&
      details?.reason === 'retryable_failed' &&
      details.canRetry &&
      runs.filter((other) => other.runId === item.runId).length === 1
    );
  };
  const signature = (item: ReleaseQueueRun | ReleaseQueueActionRequiredRun) =>
    JSON.stringify([
      item.runId,
      item.status,
      item.amountCents,
      attentionRun(item)?.reason,
      attentionRun(item)?.canRetry,
    ]);
  const selectedRuns = runs.filter(
    (item) => selected.includes(item.runId) && eligible(item),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(runs.length / PAYOUT_PAGE_SIZE) - 1),
  );
  const visible = runs.slice(
    currentPage * PAYOUT_PAGE_SIZE,
    (currentPage + 1) * PAYOUT_PAGE_SIZE,
  );
  const usesModal = mode !== 'processing';
  const run = usesModal
    ? runs.find((item) => item.runId === focusedRunId)
    : (runs.find((item) => item.runId === focusedRunId) ?? visible[0]);
  const isReviewed =
    review !== null &&
    review.length > 0 &&
    review.every((item) =>
      runs.some(
        (next) => eligible(next) && signature(next) === signature(item),
      ),
    );
  useLayoutEffect(() => {
    latest.current = { runs, mode, isLoading, isRetrying, isReleasing };
    if (!isReviewed) activeReview.current = null;
  }, [runs, mode, isLoading, isRetrying, isReleasing, isReviewed]);
  useLayoutEffect(() => {
    if (isReviewed && focusedRunId === null) confirmationRef.current?.focus();
  }, [isReviewed, focusedRunId]);
  if (review && !isReviewed && !submitting) setReviewState(null);
  const busy = isLoading || isRetrying || isReleasing || submitting;
  const Icon =
    mode === 'action-required'
      ? AlertTriangle
      : mode === 'processing'
        ? Clock3
        : CheckCircle2;
  const tone =
    mode === 'action-required'
      ? 'text-amber-400'
      : mode === 'history'
        ? 'text-forest'
        : 'text-lion';

  const attention = run ? attentionRun(run) : null;
  const canRetry = run ? eligible(run) : false;
  const confirmRetry = async () => {
    if (
      !isReviewed ||
      !review ||
      busy ||
      inFlight.current ||
      activeReview.current !== review ||
      latest.current.isLoading ||
      latest.current.isRetrying ||
      latest.current.isReleasing
    )
      return;
    activeReview.current = null;
    inFlight.current = true;
    onBusyChange?.(true);
    const snapshot = review.map((item) => ({ ...item }));
    setSubmitting(true);
    setReview(null);
    setRetryError(null);
    let accepted = 0;
    let stopped: string | null = null;
    try {
      for (const item of snapshot) {
        stopped = item.runId;
        const matches = latest.current.runs.filter(
          (next) => next.runId === item.runId,
        );
        if (
          latest.current.isLoading ||
          latest.current.mode !== 'action-required' ||
          matches.length !== 1 ||
          signature(matches[0]) !== signature(item)
        )
          throw new Error('La cola cambió; revisa las condiciones actuales.');
        setOutcome(`${accepted} aceptadas · solicitando ${item.runId}`);
        await onRetryFailedPayout(item.runId);
        accepted++;
        setSelected((ids) => ids.filter((id) => id !== item.runId));
        stopped = null;
      }
    } catch (error) {
      setRetryError(
        error instanceof Error
          ? error.message
          : 'No se pudo confirmar el reintento.',
      );
    } finally {
      setOutcome(
        `${accepted} aceptadas${stopped ? ` · detenida en ${stopped}` : ''} · ${snapshot.length - accepted - (stopped ? 1 : 0)} sin intentar. No garantiza recepción bancaria.`,
      );
      inFlight.current = false;
      setSubmitting(false);
      onBusyChange?.(false);
    }
  };
  const statusLabel = (
    item: ReleaseQueueRun | ReleaseQueueActionRequiredRun,
  ) => {
    const details = attentionRun(item);
    return mode === 'action-required' && details
      ? reasonLabels[details.reason]
      : mode === 'history'
        ? 'Pago observado'
        : 'Autorizada · en proceso';
  };

  const confirmation = isReviewed ? (
    <section
      aria-label="Confirmación de reintento"
      ref={confirmationRef}
      tabIndex={-1}
      className="rounded-2xl border border-lion/20 bg-lion/[0.06] p-4"
    >
      <h4 className="text-sm font-bold text-platinum">
        Reintentar {review?.length} ejecuciones ·{' '}
        {money((review ?? []).reduce((sum, item) => sum + item.amountCents, 0))}
      </h4>
      <p className="mt-2 text-xs text-blue-light">
        Solo se envía el ID de cada ejecución. El servidor reconstruye el
        importe y reutiliza las transferencias existentes; puede rechazar
        condiciones cambiadas.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={confirmRetry}
        className={batchControl}
      >
        {busy ? 'Solicitando...' : 'Confirmar reintento'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setReview(null)}
        className={batchControl}
      >
        Volver a revisar
      </button>
    </section>
  ) : null;
  const detail = run ? (
    <section
      aria-label="Detalle de dispersión"
      className={usesModal ? undefined : workbenchPanel}
    >
      <header className="border-b border-white/5 p-5 sm:p-6">
        <p
          className={`mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] ${tone}`}
        >
          <FileSearch size={14} /> {statusLabel(run)}
        </p>
        <h3 className="break-words text-xl font-bold text-platinum">
          {sellerLabel(run)}
        </h3>
        <p className="mt-4 text-3xl font-bold tabular-nums text-platinum">
          {money(run.amountCents)}{' '}
          <span className="text-xs font-medium text-blue-light">MXN</span>
        </p>
      </header>
      <div
        className={
          usesModal
            ? 'space-y-5 p-5 sm:p-6'
            : `${workbenchScroll} space-y-5 p-5 sm:p-6`
        }
      >
        {mode === 'action-required' ? (
          <section
            aria-label="Motivo reportado"
            className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4"
          >
            <h4 className="mb-2 text-xs font-bold text-amber-400">
              Motivo reportado
            </h4>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-platinum">
              {attention?.failureReason?.trim() ||
                'No se recibió un motivo de fallo.'}
            </p>
            {attention?.failedAt ? (
              <p className="mt-3 text-xs text-blue-light">
                Fallo registrado:{' '}
                {new Date(attention.failedAt).toLocaleString('es-MX')}
              </p>
            ) : null}
          </section>
        ) : null}
        <div className="rounded-2xl border border-white/5 bg-night/30 p-4">
          <h4 className="mb-2 text-xs font-bold text-platinum">
            {mode === 'processing'
              ? 'No requiere otra autorización'
              : mode === 'history'
                ? 'Resultado observado'
                : 'Acción disponible'}
          </h4>
          <p className="text-xs leading-relaxed text-blue-light">
            {mode === 'processing'
              ? 'La dispersión ya fue autorizada. La conciliación continúa automáticamente; esta consulta no expone la etapa específica ni una fecha de llegada al banco.'
              : mode === 'history'
                ? 'Stripe informó el pago. Este estado observado no es una garantía irreversible: una devolución posterior puede llevar esta ejecución a Necesita atención.'
                : canRetry
                  ? 'Revisa y corrige la causa reportada antes de reintentar. Antes de mover dinero, el servidor verifica el fallo confirmado y el retorno de fondos. El reintento reutiliza las transferencias existentes.'
                  : attention?.reason === 'reconciliation_needed' ||
                      attention?.reason === 'unexpected_status'
                    ? 'No hay un resultado confirmado que permita reintentar. Actualiza la cola y revisa la conciliación; no vuelvas a liberar estos fondos.'
                    : run.status === 'canceled'
                      ? 'Esta dispersión está cancelada. No se puede reintentar desde esta vista; requiere una evaluación separada, no otra liberación del mismo envío.'
                      : 'La cola no autoriza un reintento. Revisa el motivo y la información de la ejecución antes de tomar otra decisión.'}
          </p>
        </div>
        {mode === 'action-required' ? (
          <details>
            <summary className={`text-xs text-platinum ${focus}`}>
              Referencias técnicas
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-blue-light">
              Usa el ID de ejecución para localizar el registro en Supabase y
              consultar sus referencias de Stripe. Esta consulta no incluye el
              ID de payout de Stripe.
            </p>
            <dl className="mt-4 space-y-4 text-xs">
              <CopyableReference
                key={run.runId}
                label="ID de ejecución"
                value={run.runId}
              />
              {run.sellerId ? (
                <CopyableReference
                  label="ID de vendedor"
                  value={run.sellerId}
                />
              ) : (
                <div>
                  <dt>ID de vendedor</dt>
                  <dd>No disponible</dd>
                </div>
              )}
              {run.retryOfRunId ? (
                <CopyableReference
                  label="Reintento de"
                  value={run.retryOfRunId}
                />
              ) : null}
              <div>
                <dt className="text-blue-light">Estado registrado</dt>
                <dd className="mt-1 font-mono text-platinum">{run.status}</dd>
              </div>
            </dl>
          </details>
        ) : (
          <details>
            <summary className={`text-xs text-platinum ${focus}`}>
              Referencias técnicas
            </summary>
            <dl className="space-y-4 text-xs">
              <div>
                <dt className="text-blue-light">ID de ejecución</dt>
                <dd className="mt-1 break-all font-mono text-platinum">
                  {run.runId}
                </dd>
              </div>
              <div>
                <dt className="text-blue-light">Estado registrado</dt>
                <dd className="mt-1 font-mono text-platinum">{run.status}</dd>
              </div>
              {run.retryOfRunId ? (
                <div>
                  <dt className="text-blue-light">Reintento de</dt>
                  <dd className="mt-1 break-all font-mono text-platinum">
                    {run.retryOfRunId}
                  </dd>
                </div>
              ) : null}
              {attention?.failureReason ? (
                <div>
                  <dt className="text-blue-light">Motivo reportado</dt>
                  <dd className="mt-1 break-all font-mono text-amber-400">
                    {attention.failureReason}
                  </dd>
                </div>
              ) : null}
              {attention?.failedAt ? (
                <div>
                  <dt className="text-blue-light">Fallo registrado</dt>
                  <dd className="mt-1 text-platinum">
                    {new Date(attention.failedAt).toLocaleString('es-MX')}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>ID de vendedor</dt>
                <dd>{run.sellerId ?? 'No disponible'}</dd>
              </div>
            </dl>
          </details>
        )}
      </div>
      <div className="shrink-0 space-y-3 border-t border-white/5 p-4">
        {mode === 'action-required' ? (
          <label className="flex items-center gap-3 py-2 text-sm text-platinum">
            <input
              type="checkbox"
              aria-label={`Seleccionar reintento ${run.runId}`}
              className={`accent-forest ${focus}`}
              disabled={busy || !canRetry}
              checked={selectedRuns.some((item) => item.runId === run.runId)}
              onChange={() => {
                if (busy || !eligible(run)) return;
                setSelected((ids) =>
                  ids.includes(run.runId)
                    ? ids.filter((id) => id !== run.runId)
                    : [...ids, run.runId],
                );
                setReview(null);
              }}
            />
            Seleccionar para reintentar
          </label>
        ) : null}
        {mode === 'action-required' && canRetry && !isReviewed ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setReview([{ ...run }]);
              setRetryError(null);
              setFocusedRunId(null);
            }}
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-lion px-4 py-3 text-sm font-bold text-night hover:bg-lion/90 disabled:opacity-40 ${focus}`}
          >
            <ShieldCheck size={15} />
            Revisar reintento
          </button>
        ) : mode === 'action-required' && !isReviewed ? (
          <p className="flex items-center gap-2 text-xs text-blue-light">
            <ShieldCheck size={15} />
            Sin reintento disponible
          </p>
        ) : null}
      </div>
    </section>
  ) : null;
  return (
    <div className="space-y-4">
      {outcome ? (
        <p role="status" className="text-xs text-blue-light">
          {outcome}
        </p>
      ) : null}
      {retryError ? (
        <p role="alert" className="break-words text-xs text-fire">
          No pudimos confirmar el resultado: {retryError}. Actualiza la cola
          antes de volver a actuar.
        </p>
      ) : null}
      {mode === 'action-required' && !isLoading && runs.length > 0 ? (
        <SelectionActionSummary
          label="Selección de reintentos"
          title="Total a reintentar"
          amountLabel="Importe seleccionado para reintentar"
          amount={money(
            selectedRuns.reduce((sum, item) => sum + item.amountCents, 0),
          )}
          unit="MXN"
          selection={
            <>
              {selectedRuns.length} seleccionadas ·{' '}
              {runs.filter(eligible).length} reintentables ·{' '}
              {runs.filter((item) => !eligible(item)).length} requieren revisión
            </>
          }
          description="Solo se incluyen dispersiones con reintento disponible en esta consulta. El servidor verifica el fallo y el retorno de fondos; reintentar no confirma la llegada al banco."
          actions={
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={batchControl}
                disabled={busy || !runs.some(eligible)}
                onClick={() => {
                  setSelected(runs.filter(eligible).map((item) => item.runId));
                  setReview(null);
                }}
              >
                Seleccionar todos los reintentables
              </button>
              <button
                type="button"
                className={batchControl}
                disabled={busy || !selectedRuns.length}
                onClick={() => {
                  setSelected([]);
                  setReview(null);
                }}
              >
                Limpiar selección
              </button>
            </div>
          }
        >
          {isReviewed ? (
            confirmation
          ) : (
            <button
              type="button"
              className={`mt-3 rounded-xl bg-lion px-4 py-3 text-night disabled:opacity-40 ${focus}`}
              disabled={busy || !selectedRuns.length}
              onClick={() =>
                setReview(selectedRuns.map((item) => ({ ...item })))
              }
            >
              Reintentar
            </button>
          )}
        </SelectionActionSummary>
      ) : null}
      {isLoading || runs.length === 0 ? (
        <div
          role={isLoading ? 'status' : undefined}
          className="rounded-3xl border border-white/5 bg-state-gray p-12 text-center"
        >
          <Icon size={30} className={`mx-auto mb-4 ${tone}`} />
          <h3 className="font-bold text-platinum">
            {isLoading
              ? 'Consultando cola de dispersión en Stripe Connect...'
              : emptyTitles[mode]}
          </h3>
          <p className="mt-2 text-sm text-blue-light">
            {isLoading
              ? 'Espera a que se actualice la cola antes de autorizar o reintentar.'
              : 'No hay resultados disponibles en esta vista.'}
          </p>
        </div>
      ) : (
        <div className={usesModal ? 'min-w-0' : workbenchGrid}>
          <section
            aria-label="Dispersiones"
            className={
              usesModal
                ? 'min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-state-gray shadow-xl shadow-black/10'
                : workbenchPanel
            }
          >
            <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-light">
                Ejecuciones{' '}
                <span className="ml-2 text-platinum">{runs.length}</span>
              </p>
              <Icon size={16} className={tone} />
            </div>
            <div
              className={
                usesModal
                  ? 'divide-y divide-white/5'
                  : `${workbenchScroll} divide-y divide-white/5`
              }
            >
              {visible.map((item) => (
                <div key={item.runId} className="flex items-center">
                  <button
                    key={item.runId}
                    type="button"
                    aria-pressed={
                      usesModal ? undefined : item.runId === run?.runId
                    }
                    aria-haspopup={usesModal ? 'dialog' : undefined}
                    disabled={busy}
                    onClick={() => {
                      setFocusedRunId(item.runId);
                      setReview(null);
                    }}
                    className={`relative flex w-full items-start gap-3 border-l-2 px-5 text-left transition-colors disabled:cursor-wait ${focus} ${usesModal ? `py-7 ${selectedRuns.some((next) => next.runId === item.runId) ? 'border-l-forest bg-forest/10' : 'border-l-transparent hover:bg-white/[0.03]'}` : `py-5 ${item.runId === run?.runId ? 'border-l-lion bg-lion/[0.07]' : 'border-l-transparent hover:bg-white/[0.03]'}`}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-platinum">
                        {sellerLabel(item)}
                      </span>
                      <span className={`mt-2 block text-xs ${tone}`}>
                        {statusLabel(item)}
                      </span>
                      {mode === 'action-required' &&
                      attentionRun(item)?.failureReason ? (
                        <span className="mt-2 line-clamp-2 break-words text-xs text-amber-400">
                          {attentionRun(item)?.failureReason === 'BANK_REJECTED'
                            ? 'El banco rechazó la dispersión'
                            : attentionRun(item)?.failureReason}
                        </span>
                      ) : null}
                      {item.retryOfRunId ? (
                        <span className="block text-xs text-blue-light">
                          Fue un reintento
                        </span>
                      ) : null}
                      {mode === 'action-required' ? (
                        <span className="block text-xs text-blue-light">
                          {eligible(item)
                            ? 'Reintento disponible'
                            : 'Sin reintento disponible'}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-platinum">
                        {money(item.amountCents)}
                      </span>
                      <span className="mt-1 block text-[10px] text-blue-light">
                        MXN
                      </span>
                    </span>
                    {mode === 'action-required' &&
                    selectedRuns.some((next) => next.runId === item.runId) ? (
                      <span className="absolute right-4 top-3 flex items-center gap-1 text-[10px] text-forest">
                        <CheckCircle2 size={14} />
                        Seleccionada para reintentar
                      </span>
                    ) : null}
                    <ChevronRight
                      size={15}
                      className="mt-1 shrink-0 text-blue-light"
                    />
                  </button>
                </div>
              ))}
            </div>
            <PayoutPagination
              page={currentPage}
              total={runs.length}
              label="dispersiones"
              display={usesModal ? 'pages' : 'range'}
              disabled={busy}
              onPageChange={(next) => {
                setPage(next);
                setFocusedRunId(
                  usesModal
                    ? null
                    : (runs[next * PAYOUT_PAGE_SIZE]?.runId ?? null),
                );
              }}
            />
          </section>
          {usesModal ? (
            run ? (
              <Modal
                title="Detalle de dispersión"
                onClose={() => setFocusedRunId(null)}
              >
                {detail}
              </Modal>
            ) : null
          ) : (
            detail
          )}
        </div>
      )}
    </div>
  );
};

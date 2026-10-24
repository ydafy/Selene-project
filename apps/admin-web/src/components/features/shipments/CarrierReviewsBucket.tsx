import { useRef, useState } from 'react';
import { AlertTriangle, PackageCheck, Truck } from 'lucide-react';
import { ErrorState } from '../../ui/ErrorState';
import { Modal } from '../../ui/Modal';
import { PayoutBucketEmptyState } from '../payments/PayoutRunRow';
import { workbenchFocus } from '../payments/PayoutWorkbenchLayout';
import { centsToMoney } from '../../../lib/connectEarnings';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import { formatTime } from '../../../lib/utils/formatDate';
import { getErrorCode } from '../../../lib/shipmentRefundProblems';
import {
  formatWaiting,
  MAX_REVIEW_NOTE_LENGTH,
  normalizeReviewNote,
  resolveCarrierReviewErrorMessage,
  REVIEW_REASON_LABELS,
  type CarrierReview,
  type ReviewResolution,
} from '../../../lib/carrierReviews';

const shortId = (id: string) => id.slice(0, 8);
const money = (cents: number) => formatCurrency(centsToMoney(cents));

interface CarrierReviewsBucketProps {
  reviews: CarrierReview[];
  isLoading: boolean;
  isError: boolean;
  isResolving: boolean;
  onRetry: () => void;
  /** Rejects with the server's stable error code on failure. */
  onResolve: (shipmentId: string, resolution: ReviewResolution, note: string) => Promise<unknown>;
}

const DECISIONS: Record<ReviewResolution, { title: string; confirm: string }> = {
  refund_approved: { title: 'Reembolsar al comprador', confirm: 'Confirmar reembolso' },
  closed_no_refund: { title: 'Cerrar sin reembolso', confirm: 'Confirmar cierre' },
};

/**
 * Preparing-timeout cancellations where the carrier gave no proof either way. The admin decides:
 * approving lets the next automatic run refund the buyer through the standard path, closing
 * stops the cancellation. This panel never moves money itself.
 */
export const CarrierReviewsBucket = ({
  reviews,
  isLoading,
  isError,
  isResolving,
  onRetry,
  onResolve,
}: CarrierReviewsBucketProps) => {
  const [selected, setSelected] = useState<{ review: CarrierReview; resolution: ReviewResolution } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  if (isLoading) {
    return (
      <p role="status" className="rounded-3xl border border-white/5 bg-state-gray p-10 text-center text-sm text-blue-light">
        Consultando cancelaciones con el carrier...
      </p>
    );
  }
  if (isError) {
    return (
      <ErrorState
        title="Error al cargar cancelaciones con el carrier"
        message="No pudimos cargar las cancelaciones con el carrier. Actualiza antes de registrar una decisión."
        onRetry={onRetry}
      />
    );
  }
  if (reviews.length === 0) {
    return (
      <PayoutBucketEmptyState
        icon={PackageCheck}
        tone="forest"
        title="Ninguna cancelación pendiente"
        description="No hay cancelaciones de envíos que el carrier haya dejado sin confirmar."
      />
    );
  }

  const open = (review: CarrierReview, resolution: ReviewResolution) => {
    setSelected({ review, resolution });
    setNote('');
    setError(null);
  };

  const close = () => {
    if (inFlight.current) return;
    setSelected(null);
    setNote('');
    setError(null);
  };

  const submit = async () => {
    if (!selected || inFlight.current) return;
    const normalized = normalizeReviewNote(note);
    if (!normalized) {
      setError(resolveCarrierReviewErrorMessage('INVALID_REVIEW_NOTE'));
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onResolve(selected.review.shipmentId, selected.resolution, normalized);
      inFlight.current = false;
      setSelected(null);
      setNote('');
    } catch (failure) {
      inFlight.current = false;
      setError(resolveCarrierReviewErrorMessage(getErrorCode(failure)));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || isResolving;

  return (
    <section className="space-y-4" aria-labelledby="carrier-reviews-title">
      <div>
        <h2 id="carrier-reviews-title" className="flex items-center gap-2 text-lg font-bold text-platinum">
          <Truck size={20} className="text-amber-400" /> Cancelaciones con el carrier
        </h2>
        <p className="mt-0.5 text-xs text-blue-light">
          {reviews.length} {reviews.length === 1 ? 'cancelación necesita' : 'cancelaciones necesitan'} revisión
        </p>
        <p className="mt-1 max-w-2xl text-xs text-blue-light/70">
          El vendedor no preparó el envío a tiempo y el carrier no confirmó la cancelación de la guía. Decide si se
          reembolsa al comprador o se cierra sin reembolso.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {reviews.map((review) => (
          <article key={review.shipmentId} className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-400">
                <AlertTriangle size={13} /> {REVIEW_REASON_LABELS[review.reason]}
              </span>
              <p className="text-sm font-bold text-amber-400">
                {review.labelCostCents === null ? 'Sin dato' : money(review.labelCostCents)}
              </p>
            </div>
            <dl className="mt-3 space-y-1 text-[11px] text-blue-light">
              <div>
                <dt className="inline">Envío: </dt>
                <dd className="inline font-mono" title={review.shipmentId}>{shortId(review.shipmentId)}</dd>
                <dt className="inline"> · Orden: </dt>
                <dd className="inline font-mono" title={review.orderId}>{shortId(review.orderId)}</dd>
                <dt className="inline"> · Vendedor: </dt>
                <dd className="inline font-mono" title={review.sellerId}>{shortId(review.sellerId)}</dd>
              </div>
              <div>
                <dt className="inline">Guía: </dt>
                <dd className="inline font-mono">{review.trackingNumber ?? 'Sin tracking'}</dd>
                <dt className="inline"> · Carrier: </dt>
                <dd className="inline">{review.carrier ?? 'Sin carrier'}</dd>
              </div>
              <div>
                <dt className="inline">Costo de la guía: </dt>
                <dd className="inline">{review.labelCostCents === null ? 'Sin dato' : money(review.labelCostCents)}</dd>
              </div>
              <div>
                <dt className="inline">Esperando: </dt>
                <dd className="inline">{formatWaiting(review.requiredAt)}</dd>
                <dt className="inline"> · Desde: </dt>
                <dd className="inline">
                  <time dateTime={review.requiredAt}>{formatTime(review.requiredAt)}</time>
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => open(review, 'refund_approved')}
                disabled={busy}
                className={`inline-flex cursor-pointer items-center justify-center rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-night transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
              >
                {DECISIONS.refund_approved.title}
              </button>
              <button
                type="button"
                onClick={() => open(review, 'closed_no_refund')}
                disabled={busy}
                className={`inline-flex cursor-pointer items-center justify-center rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-platinum transition-colors hover:border-lion/40 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
              >
                {DECISIONS.closed_no_refund.title}
              </button>
            </div>
          </article>
        ))}
      </div>

      {selected ? (
        <Modal title={DECISIONS[selected.resolution].title} onClose={close}>
          <form
            className="space-y-4 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h3 className="flex items-center gap-2 text-lg font-bold text-platinum" aria-hidden="true">
              <Truck size={20} className="text-amber-400" /> {DECISIONS[selected.resolution].title}
            </h3>
            {selected.resolution === 'refund_approved' ? (
              <p className="text-sm text-blue-light">
                Se reembolsará al comprador. La guía no se canceló con el carrier, así que Selene absorbe su costo
                {selected.review.labelCostCents === null ? '' : ` (${money(selected.review.labelCostCents)})`}. Esta
                decisión no mueve dinero: el próximo ciclo automático ejecuta el reembolso.
              </p>
            ) : (
              <p className="text-sm text-blue-light">
                El envío no se cancelará y no se reembolsará al comprador. La decisión queda registrada y no se puede
                deshacer.
              </p>
            )}
            <label className="block text-xs font-semibold text-platinum">
              Nota para el registro
              <textarea
                value={note}
                maxLength={MAX_REVIEW_NOTE_LENGTH}
                rows={3}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ej. el carrier confirmó por teléfono que no escaneó el paquete"
                className={`mt-1 w-full rounded-xl border border-white/10 bg-night px-3 py-2 text-sm text-platinum disabled:opacity-40 ${workbenchFocus}`}
              />
            </label>
            {error ? (
              <p role="alert" className="text-xs text-fire">{error}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className={`rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-platinum disabled:opacity-40 ${workbenchFocus}`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className={`rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-night hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
              >
                {busy ? 'Confirmando...' : DECISIONS[selected.resolution].confirm}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
};

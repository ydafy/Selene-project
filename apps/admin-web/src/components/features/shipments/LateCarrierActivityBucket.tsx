import { useRef, useState } from 'react';
import { PackageSearch, PackageCheck } from 'lucide-react';
import { ErrorState } from '../../ui/ErrorState';
import { Modal } from '../../ui/Modal';
import { PayoutBucketEmptyState } from '../payments/PayoutRunRow';
import { workbenchFocus } from '../payments/PayoutWorkbenchLayout';
import { formatTime } from '../../../lib/utils/formatDate';
import { getErrorCode } from '../../../lib/shipmentRefundProblems';
import { formatWaiting } from '../../../lib/carrierReviews';
import {
  EVENT_TYPE_LABELS,
  MAX_ACKNOWLEDGEMENT_NOTE_LENGTH,
  normalizeAcknowledgementNote,
  REFUND_STATUS_LABELS,
  resolveLateCarrierActivityErrorMessage,
  SHIPMENT_STATUS_LABELS,
  type LateCarrierActivity,
} from '../../../lib/lateCarrierActivity';

const shortId = (id: string) => id.slice(0, 8);

interface LateCarrierActivityBucketProps {
  cases: LateCarrierActivity[];
  isLoading: boolean;
  isError: boolean;
  isAcknowledging: boolean;
  onRetry: () => void;
  /** Rejects with the server's stable error code on failure. */
  onAcknowledge: (shipmentId: string, note: string) => Promise<unknown>;
}

/**
 * Cancellations where the carrier recorded activity after the refund had started. The
 * cancellation itself is not touched here: an admin looks at the package that moved and marks the
 * case as reviewed with a note. Acknowledging changes no shipment, order or refund.
 */
export const LateCarrierActivityBucket = ({
  cases,
  isLoading,
  isError,
  isAcknowledging,
  onRetry,
  onAcknowledge,
}: LateCarrierActivityBucketProps) => {
  const [selected, setSelected] = useState<LateCarrierActivity | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const unresolved = isLoading || isError;

  const open = (item: LateCarrierActivity) => {
    setSelected(item);
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
    const normalized = normalizeAcknowledgementNote(note);
    if (!normalized) {
      setError(resolveLateCarrierActivityErrorMessage('INVALID_ACKNOWLEDGEMENT_NOTE'));
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onAcknowledge(selected.shipmentId, normalized);
      inFlight.current = false;
      setSelected(null);
      setNote('');
    } catch (failure) {
      inFlight.current = false;
      setError(resolveLateCarrierActivityErrorMessage(getErrorCode(failure)));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || isAcknowledging;

  return (
    <section className="space-y-4" aria-labelledby="late-carrier-activity-title">
      <div>
        <h2 id="late-carrier-activity-title" className="flex items-center gap-2 text-lg font-bold text-platinum">
          <PackageSearch size={20} className="text-amber-400" /> Paquetes que se movieron después de cancelar
          <span
            data-testid="late-carrier-activity-count"
            aria-label={`Casos por revisar: ${unresolved ? 'consultando' : cases.length}`}
            className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${!unresolved && cases.length > 0 ? 'bg-amber-400/10 text-amber-400' : 'bg-white/5 text-blue-light'}`}
          >
            {unresolved ? '—' : cases.length}
          </span>
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-blue-light/70">
          <span className="font-semibold text-platinum">Cancelamos estos envíos y ya iniciamos el reembolso al comprador,
            pero la paquetería reportó que el paquete se movió.</span> Habla con el vendedor o el comprador para saber dónde
          está el paquete. Cuando lo resuelvas, márcalo como revisado: solo queda anotado y sale de la lista.
        </p>
      </div>

      {isLoading ? (
        <p role="status" className="rounded-3xl border border-white/5 bg-state-gray p-10 text-center text-sm text-blue-light">
          Consultando actividad del carrier...
        </p>
      ) : isError ? (
        <ErrorState
          title="Error al cargar la actividad del carrier"
          message="No pudimos cargar los casos de actividad del carrier. Actualiza antes de registrar una revisión."
          onRetry={onRetry}
        />
      ) : cases.length === 0 ? (
        <PayoutBucketEmptyState
          icon={PackageCheck}
          tone="forest"
          title="Ningún caso pendiente"
          description="Ningún paquete se movió después de una cancelación."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {cases.map((item) => (
            <article key={item.shipmentId} className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-400">
                  <PackageSearch size={13} /> {EVENT_TYPE_LABELS[item.eventType]}
                </span>
                <p className="text-xs font-semibold text-amber-400">Hace {formatWaiting(item.activityAt)}</p>
              </div>
              <dl className="mt-3 space-y-1 text-[11px] text-blue-light">
                <div>
                  <dt className="inline">Envío: </dt>
                  <dd className="inline font-mono" title={item.shipmentId}>{shortId(item.shipmentId)}</dd>
                  <dt className="inline"> · Orden: </dt>
                  <dd className="inline font-mono" title={item.orderId}>{shortId(item.orderId)}</dd>
                  <dt className="inline"> · Vendedor: </dt>
                  <dd className="inline font-mono" title={item.sellerId}>{shortId(item.sellerId)}</dd>
                </div>
                <div>
                  <dt className="inline">Guía: </dt>
                  <dd className="inline font-mono">{item.trackingNumber ?? 'Sin tracking'}</dd>
                  <dt className="inline"> · Carrier: </dt>
                  <dd className="inline">{item.carrier ?? 'Sin carrier'}</dd>
                </div>
                <div>
                  <dt className="inline">Estado del envío: </dt>
                  <dd className="inline">{SHIPMENT_STATUS_LABELS[item.shipmentStatus]}</dd>
                  <dt className="inline"> · Reembolso: </dt>
                  <dd className="inline">{item.refundStatus ? REFUND_STATUS_LABELS[item.refundStatus] : 'Sin dato'}</dd>
                </div>
                <div>
                  <dt className="inline">Actividad registrada: </dt>
                  <dd className="inline">
                    <time dateTime={item.activityAt}>{formatTime(item.activityAt)}</time>
                  </dd>
                </div>
              </dl>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => open(item)}
                  disabled={busy}
                  className={`inline-flex cursor-pointer items-center justify-center rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-night transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
                >
                  Marcar revisado
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selected ? (
        <Modal title="Marcar revisado" onClose={close}>
          <form
            className="space-y-4 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h3 className="flex items-center gap-2 text-lg font-bold text-platinum" aria-hidden="true">
              <PackageSearch size={20} className="text-amber-400" /> Marcar revisado
            </h3>
            <p className="text-sm text-blue-light">
              Queda anotado que ya lo atendiste y el caso sale de la lista. No mueve dinero ni cambia el pedido, y no se
              puede deshacer.
            </p>
            <label className="block text-xs font-semibold text-platinum">
              Nota para el registro
              <textarea
                value={note}
                maxLength={MAX_ACKNOWLEDGEMENT_NOTE_LENGTH}
                rows={3}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ej. el comprador recibió el paquete y lo va a devolver"
                className={`mt-1 w-full rounded-xl border border-white/10 bg-night px-3 py-2 text-sm text-platinum disabled:opacity-40 ${workbenchFocus}`}
              />
            </label>
            {error ? <p role="alert" className="text-xs text-fire">{error}</p> : null}
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
                {busy ? 'Confirmando...' : 'Confirmar revisión'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
};

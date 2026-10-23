import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ErrorState } from '../../ui/ErrorState';
import { Modal } from '../../ui/Modal';
import { PayoutBucketEmptyState } from './PayoutRunRow';
import { workbenchFocus } from './PayoutWorkbenchLayout';
import { centsToMoney } from '../../../lib/connectEarnings';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import { formatTime } from '../../../lib/utils/formatDate';
import {
  getErrorCode,
  normalizeResolutionReference,
  resolveRefundErrorMessage,
  type RefundProblem,
  type RefundProblemKind,
} from '../../../lib/shipmentRefundProblems';

const KIND_LABELS: Record<RefundProblemKind, string> = {
  refund_failed: 'Reembolso fallido',
  refund_canceled: 'Reembolso cancelado',
  refund_not_found: 'Reembolso no encontrado',
  refund_ambiguous: 'Reembolso ambiguo',
};

const shortId = (id: string) => id.slice(0, 8);
const money = (cents: number) => formatCurrency(centsToMoney(cents));

interface RefundProblemsBucketProps {
  problems: RefundProblem[];
  isLoading: boolean;
  isError: boolean;
  isResolving: boolean;
  onRetry: () => void;
  /** Rejects with the server's stable error code on failure. */
  onResolve: (shipmentId: string, reference: string) => Promise<unknown>;
}

/**
 * Buyer refunds that need an admin: failed or canceled Stripe refunds and
 * escalated operations with no refund. Selene never creates a refund from here;
 * the admin repays outside Stripe and records the reference.
 */
export const RefundProblemsBucket = ({
  problems,
  isLoading,
  isError,
  isResolving,
  onRetry,
  onResolve,
}: RefundProblemsBucketProps) => {
  const [selected, setSelected] = useState<RefundProblem | null>(null);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  if (isLoading) {
    return (
      <p role="status" className="rounded-3xl border border-white/5 bg-state-gray p-10 text-center text-sm text-blue-light">
        Consultando reembolsos con problema...
      </p>
    );
  }
  if (isError) {
    return (
      <ErrorState
        title="Error al cargar reembolsos"
        message="No pudimos cargar los reembolsos con problema. Actualiza antes de registrar una resolución."
        onRetry={onRetry}
      />
    );
  }
  if (problems.length === 0) {
    return (
      <PayoutBucketEmptyState
        icon={ShieldCheck}
        tone="forest"
        title="Ningún reembolso pendiente"
        description="No hay reembolsos a compradores fallidos ni escalados que necesiten revisión."
      />
    );
  }

  const close = () => {
    if (inFlight.current) return;
    setSelected(null);
    setReference('');
    setError(null);
  };

  const submit = async () => {
    if (!selected || inFlight.current) return;
    const normalized = normalizeResolutionReference(reference);
    if (!normalized) {
      setError(resolveRefundErrorMessage('INVALID_RESOLUTION_REFERENCE'));
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onResolve(selected.shipmentId, normalized);
      inFlight.current = false;
      setSelected(null);
      setReference('');
    } catch (failure) {
      inFlight.current = false;
      setError(resolveRefundErrorMessage(getErrorCode(failure)));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || isResolving;

  return (
    <section className="space-y-4" aria-labelledby="refund-problems-title">
      <div>
        <h2 id="refund-problems-title" className="flex items-center gap-2 text-lg font-bold text-platinum">
          <AlertTriangle size={20} className="text-amber-400" /> Reembolsos con problema
        </h2>
        <p className="mt-0.5 text-xs text-blue-light">
          {problems.length} {problems.length === 1 ? 'reembolso necesita' : 'reembolsos necesitan'} revisión
        </p>
        <p className="mt-1 max-w-2xl text-xs text-blue-light/70">
          Verifica en Stripe o repaga al comprador por otro medio (por ejemplo SPEI) y registra la referencia. Selene no
          crea reembolsos desde este panel.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {problems.map((problem) => (
          <article key={problem.shipmentId} className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-400">
                <AlertTriangle size={13} /> {KIND_LABELS[problem.kind]}
              </span>
              <p className="text-sm font-bold text-amber-400">{money(problem.amountOwedCents)}</p>
            </div>
            <dl className="mt-3 space-y-1 text-[11px] text-blue-light">
              <div>
                <dt className="inline">Envío: </dt>
                <dd className="inline font-mono" title={problem.shipmentId}>{shortId(problem.shipmentId)}</dd>
                <dt className="inline"> · Orden: </dt>
                <dd className="inline font-mono" title={problem.orderId}>{shortId(problem.orderId)}</dd>
              </div>
              <div>
                <dt className="inline">Estado del envío: </dt>
                <dd className="inline">{problem.shipmentStatus}</dd>
              </div>
              {problem.refundId ? (
                <div>
                  <dt className="inline">Reembolso Stripe: </dt>
                  <dd className="inline font-mono">{problem.refundId}</dd>
                </div>
              ) : null}
              {problem.refundFailureReason ? (
                <div>
                  <dt className="inline">Motivo: </dt>
                  <dd className="inline">{problem.refundFailureReason.replaceAll('_', ' ')}</dd>
                </div>
              ) : null}
              <div>
                <dt className="inline">Desde: </dt>
                <dd className="inline">
                  <time dateTime={problem.since}>{formatTime(problem.since)}</time>
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setSelected(problem)}
              disabled={busy}
              className={`mt-3 inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-night transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
            >
              Marcar resuelto
            </button>
          </article>
        ))}
      </div>

      {selected ? (
        <Modal title="Marcar reembolso como resuelto" onClose={close}>
          <form
            className="space-y-4 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h3 className="flex items-center gap-2 text-lg font-bold text-platinum" aria-hidden="true">
              <CheckCircle2 size={20} className="text-forest" /> Marcar reembolso como resuelto
            </h3>
            <p className="text-sm text-blue-light">
              Esto registra que repagaste {money(selected.amountOwedCents)} al comprador fuera de Stripe. Si el envío
              sigue abierto, también se cancelará. No se crea ningún reembolso nuevo.
            </p>
            <label className="block text-xs font-semibold text-platinum">
              Referencia del pago externo
              <input
                type="text"
                value={reference}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Ej. folio SPEI o ID del reembolso en Stripe"
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
                {busy ? 'Confirmando...' : 'Confirmar resolución'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
};

import { useRef, useState } from 'react';
import { PackageCheck, PackageX } from 'lucide-react';
import { ErrorState } from '../../ui/ErrorState';
import { Modal } from '../../ui/Modal';
import { PayoutBucketEmptyState } from '../payments/PayoutRunRow';
import { workbenchFocus } from '../payments/PayoutWorkbenchLayout';
import { centsToMoney } from '../../../lib/connectEarnings';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import { formatTime } from '../../../lib/utils/formatDate';
import { getErrorCode } from '../../../lib/shipmentRefundProblems';
import { formatWaiting } from '../../../lib/carrierReviews';
import {
  MAX_RESOLUTION_NOTE_LENGTH,
  normalizeResolutionNote,
  resolveLabelReconciliationErrorMessage,
  validateLabelFoundForm,
  type LabelFoundFormInput,
  type LabelReconciliation,
  type ResolveLabelReconciliationInput,
} from '../../../lib/labelReconciliations';

const money = (cents: number) => formatCurrency(centsToMoney(cents));
const shortId = (id: string) => id.slice(0, 8);
const place = (city: string | null, postalCode: string | null) =>
  [city, postalCode].filter(Boolean).join(' ') || 'Sin dato';

const EMPTY_FORM: LabelFoundFormInput = { trackingNumber: '', labelUrl: '', enviaShipmentId: '', costPesos: '', note: '' };

interface LabelReconciliationsBucketProps {
  cases: LabelReconciliation[];
  isLoading: boolean;
  isError: boolean;
  isResolving: boolean;
  onRetry: () => void;
  /** Rejects with the server's stable error code on failure. */
  onResolve: (input: ResolveLabelReconciliationInput) => Promise<unknown>;
}

type Dialog = { item: LabelReconciliation; mode: 'found' | 'none' } | null;

const inputClass = `mt-1 w-full rounded-xl border border-white/10 bg-night px-3 py-2 text-sm text-platinum disabled:opacity-40 ${workbenchFocus}`;

/**
 * Paid shipments where Envía's answer to "create the label" never arrived. The buyer's money is held
 * and nothing moves on its own. An admin looks the shipment up in the Envía panel and records either
 * the label that exists or that there is none. This panel starts no refund itself.
 */
export const LabelReconciliationsBucket = ({
  cases,
  isLoading,
  isError,
  isResolving,
  onRetry,
  onResolve,
}: LabelReconciliationsBucketProps) => {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<LabelFoundFormInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const unresolved = isLoading || isError;

  const open = (item: LabelReconciliation, mode: 'found' | 'none') => {
    setDialog({ item, mode });
    setForm(EMPTY_FORM);
    setError(null);
  };

  const close = () => {
    if (inFlight.current) return;
    setDialog(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const setField = (name: keyof LabelFoundFormInput, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));

  const submit = async () => {
    if (!dialog || inFlight.current) return;
    const { item, mode } = dialog;
    let input: ResolveLabelReconciliationInput;
    if (mode === 'found') {
      const checked = validateLabelFoundForm(form);
      if (!checked.ok) {
        setError(checked.message);
        return;
      }
      input = { shipmentId: item.shipmentId, resolution: 'label_found', ...checked.value };
    } else {
      const note = normalizeResolutionNote(form.note);
      if (!note) {
        setError(resolveLabelReconciliationErrorMessage('INVALID_RESOLUTION_NOTE'));
        return;
      }
      input = { shipmentId: item.shipmentId, resolution: 'no_label', note };
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onResolve(input);
      inFlight.current = false;
      setDialog(null);
      setForm(EMPTY_FORM);
    } catch (failure) {
      inFlight.current = false;
      setError(resolveLabelReconciliationErrorMessage(getErrorCode(failure)));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || isResolving;
  const noteField = (
    <label className="block text-xs font-semibold text-platinum">
      Nota para el registro
      <textarea
        name="note"
        value={form.note}
        maxLength={MAX_RESOLUTION_NOTE_LENGTH}
        rows={3}
        disabled={busy}
        onChange={(event) => setField('note', event.target.value)}
        placeholder="Ej. la guía aparece en el panel de Envía con fecha de ayer"
        className={inputClass}
      />
    </label>
  );
  const textField = (name: keyof LabelFoundFormInput, text: string, placeholder: string, inputMode?: 'decimal') => (
    <label className="block text-xs font-semibold text-platinum">
      {text}
      <input
        name={name}
        type="text"
        inputMode={inputMode}
        value={form[name]}
        disabled={busy}
        onChange={(event) => setField(name, event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
    </label>
  );

  return (
    <section className="space-y-4" aria-labelledby="label-reconciliations-title">
      <div>
        <h2 id="label-reconciliations-title" className="flex items-center gap-2 text-lg font-bold text-platinum">
          <PackageX size={20} className="text-amber-400" /> Guías que no sabemos si se crearon
          <span
            data-testid="label-reconciliations-count"
            aria-label={`Envíos por revisar: ${unresolved ? 'consultando' : cases.length}`}
            className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${!unresolved && cases.length > 0 ? 'bg-amber-400/10 text-amber-400' : 'bg-white/5 text-blue-light'}`}
          >
            {unresolved ? '—' : cases.length}
          </span>
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-blue-light/70">
          <span className="font-semibold text-platinum">El vendedor pidió su guía y no supimos si Envía la creó.</span>{' '}
          El dinero del comprador sigue retenido. Busca el envío en el panel de Envía y elige qué pasó.
        </p>
      </div>

      {isLoading ? (
        <p role="status" className="rounded-3xl border border-white/5 bg-state-gray p-10 text-center text-sm text-blue-light">
          Consultando guías...
        </p>
      ) : isError ? (
        <ErrorState
          title="Error al cargar las guías por revisar"
          message="No pudimos cargar los envíos por revisar. Actualiza antes de tomar una decisión."
          onRetry={onRetry}
        />
      ) : cases.length === 0 ? (
        <PayoutBucketEmptyState
          icon={PackageCheck}
          tone="forest"
          title="Ninguna guía por revisar"
          description="Todos los envíos tienen su guía o ya se resolvieron."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {cases.map((item) => (
            <article key={item.shipmentId} className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-400">
                  <PackageX size={13} />{' '}
                  {item.state === 'orphan_pending' ? 'Envía no respondió' : 'El intento se quedó sin terminar'}
                </span>
                <p className="text-xs font-semibold text-amber-400">Hace {formatWaiting(item.stuckAt)}</p>
              </div>
              <dl className="mt-3 space-y-1 text-[11px] text-blue-light">
                <div>
                  <dt className="inline">Envío: </dt>
                  <dd className="inline font-mono" title={item.shipmentId}>{shortId(item.shipmentId)}</dd>
                  <dt className="inline"> · Orden: </dt>
                  <dd className="inline font-mono" title={item.orderId}>{shortId(item.orderId)}</dd>
                </div>
                <div>
                  <dt className="inline">Vendedor: </dt>
                  <dd className="inline" title={item.sellerId}>{item.sellerName ?? shortId(item.sellerId)}</dd>
                  <dt className="inline"> · Comprador: </dt>
                  <dd className="inline" title={item.buyerId}>{item.buyerName ?? shortId(item.buyerId)}</dd>
                </div>
                <div>
                  <dt className="inline">Creado: </dt>
                  <dd className="inline">
                    <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
                  </dd>
                </div>
                <div>
                  <dt className="inline">Ruta: </dt>
                  <dd className="inline">
                    {place(item.originCity, item.originPostalCode)} → {place(item.destinationCity, item.destinationPostalCode)}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Cotización: </dt>
                  <dd className="inline">
                    {[item.quoteCarrier, item.quoteService, item.quoteCostCents === null ? null : money(item.quoteCostCents)]
                      .filter(Boolean)
                      .join(' · ') || 'Sin dato'}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => open(item, 'found')}
                  disabled={busy}
                  className={`inline-flex cursor-pointer items-center justify-center rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-night transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
                >
                  La guía existe
                </button>
                <button
                  type="button"
                  onClick={() => open(item, 'none')}
                  disabled={busy}
                  className={`inline-flex cursor-pointer items-center justify-center rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-platinum transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
                >
                  No hay guía
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog ? (
        <Modal title={dialog.mode === 'found' ? 'La guía existe' : 'No hay guía'} onClose={close}>
          <form
            className="space-y-4 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h3 className="flex items-center gap-2 text-lg font-bold text-platinum" aria-hidden="true">
              <PackageX size={20} className="text-amber-400" /> {dialog.mode === 'found' ? 'La guía existe' : 'No hay guía'}
            </h3>
            {dialog.mode === 'found' ? (
              <>
                <p className="text-sm text-blue-light">
                  Copia estos datos del panel de Envía. El envío sigue su curso como si la guía se hubiera creado normal.
                </p>
                {textField('trackingNumber', 'Número de guía', 'Ej. 1234567890')}
                {textField('labelUrl', 'URL de la guía', 'https://...')}
                {textField('enviaShipmentId', 'ID de envío en Envía', 'Ej. 98765')}
                {textField('costPesos', 'Costo de la guía (MXN)', 'Ej. 93.50', 'decimal')}
              </>
            ) : (
              <p className="text-sm text-blue-light">
                Confirma solo si en el panel de Envía no hay ninguna guía de este envío. El envío regresa al vendedor
                para que genere la guía otra vez. Si ya pasó el plazo, se cancela y se reembolsa al comprador. Es una
                decisión que no se puede deshacer.
              </p>
            )}
            {noteField}
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
                {busy ? (dialog.mode === 'found' ? 'Guardando...' : 'Confirmando...') : dialog.mode === 'found' ? 'Guardar guía' : 'Confirmar: no hay guía'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
};

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ShieldCheck, Undo2 } from 'lucide-react';
import { Modal } from '@/shared/ui/modal';
import { BucketEmptyState } from '@/shared/ui/bucket-empty-state';
import { workbenchFocus } from '@/shared/ui/workbench-focus';
import { getErrorCode } from '@/shared/utils/get-error-code';
import { PayoutPagination } from './payout-workbench-layout';
import { OverduePayoutCard } from './overdue-payout-card';
import {
  danger,
  money,
  secondary,
  sellerLabel,
  shortId,
} from './overdue-payout-presentation';
import type { OverduePayout } from '../logic/connect-payout-release-queue';
import {
  MAX_HOLD_NOTE_LENGTH,
  holdNoteErrorMessage,
  holdNoteLength,
  normalizeHoldNote,
  overdueRefundErrorMessage,
  type OverdueRefundResult,
} from '../logic/overdue-payouts';

const sellerCountLabel = (count: number) =>
  `${count} ${count === 1 ? 'vendedor' : 'vendedores'} con pagos retenidos 30 días o más`;

/** A refund the server answered, or Stripe's failure that ends this attempt. */
type RefundOutcome =
  { kind: 'refunded' | 'pending'; amountCents: number } | { kind: 'failed' };

interface OverduePayoutsBucketProps {
  payouts: OverduePayout[];
  pagination?: { page: number; totalGroups: number };
  onPageChange?: (page: number) => void;
  isLoading: boolean;
  /** Another overdue action is running; both actions wait for it. */
  isBusy?: boolean;
  /** Rejects with the server's stable error code on failure. */
  onRecordHoldNote: (shipmentId: string, note: string) => Promise<unknown>;
  /** Rejects with the server's stable error code on failure. */
  onRefund: (shipmentId: string) => Promise<OverdueRefundResult>;
}

/**
 * "Pagos vencidos" (#549): completed shipments held 30 days or more because the
 * seller cannot be paid. Nothing is refunded on its own; the admin keeps holding
 * with a note or, only when Stripe rejected the account, refunds the buyer.
 */
export const OverduePayoutsBucket = ({
  payouts,
  pagination,
  onPageChange,
  isLoading,
  isBusy = false,
  onRecordHoldNote,
  onRefund,
}: OverduePayoutsBucketProps) => {
  const [holding, setHolding] = useState<OverduePayout | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  /** The note itself is wrong, not the request; the field is marked. */
  const [noteInvalid, setNoteInvalid] = useState(false);
  /** Bumped on each rejected note so every rejection refocuses the field. */
  const [noteFocusRequest, setNoteFocusRequest] = useState(0);
  const [savingNote, setSavingNote] = useState(false);
  const [refunding, setRefunding] = useState<OverduePayout | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundOutcome, setRefundOutcome] = useState<RefundOutcome | null>(
    null,
  );
  const [sendingRefund, setSendingRefund] = useState(false);
  const noteInFlight = useRef(false);
  const refundInFlight = useRef(false);
  const noteField = useRef<HTMLTextAreaElement>(null);
  // Focus waits for the save to end: a disabled textarea cannot take focus.
  useEffect(() => {
    if (noteFocusRequest > 0 && !savingNote) noteField.current?.focus();
  }, [noteFocusRequest, savingNote]);

  // The queue refetches in the background; an open dialog stays mounted so the
  // admin keeps the note being written or the refund outcome being read.
  const dialogOpen = holding !== null || refunding !== null;
  if (isLoading && !dialogOpen) {
    return (
      <p
        role="status"
        className="rounded-3xl border border-white/5 bg-state-gray p-10 text-center text-sm text-blue-light"
      >
        Consultando pagos vencidos...
      </p>
    );
  }
  if (payouts.length === 0 && !dialogOpen) {
    return (
      <BucketEmptyState
        icon={ShieldCheck}
        tone="forest"
        title="Ningún pago vencido"
        description="No hay envíos completados hace 30 días o más con el pago al vendedor retenido."
      />
    );
  }

  const closeNote = () => {
    if (noteInFlight.current) return;
    setHolding(null);
    setNote('');
    setNoteError(null);
    setNoteInvalid(false);
    setNoteFocusRequest(0);
  };
  const saveNote = async () => {
    if (!holding || noteInFlight.current) return;
    const normalized = normalizeHoldNote(note);
    if (!normalized) {
      setNoteError(holdNoteErrorMessage('INVALID_HOLD_NOTE'));
      setNoteInvalid(true);
      setNoteFocusRequest((request) => request + 1);
      return;
    }
    noteInFlight.current = true;
    setSavingNote(true);
    setNoteError(null);
    setNoteInvalid(false);
    setNoteFocusRequest(0);
    try {
      await onRecordHoldNote(holding.shipmentId, normalized);
      noteInFlight.current = false;
      setHolding(null);
      setNote('');
    } catch (failure) {
      noteInFlight.current = false;
      const code = getErrorCode(failure);
      setNoteError(holdNoteErrorMessage(code));
      if (code === 'INVALID_HOLD_NOTE') {
        setNoteInvalid(true);
        setNoteFocusRequest((request) => request + 1);
      }
    } finally {
      setSavingNote(false);
    }
  };

  const closeRefund = () => {
    if (refundInFlight.current) return;
    setRefunding(null);
    setRefundError(null);
    setRefundOutcome(null);
  };
  const confirmRefund = async () => {
    if (!refunding || refundInFlight.current || refundOutcome) return;
    refundInFlight.current = true;
    setSendingRefund(true);
    setRefundError(null);
    try {
      const result = await onRefund(refunding.shipmentId);
      setRefundOutcome({
        kind: result.status,
        amountCents: result.amountCents,
      });
    } catch (failure) {
      const code = getErrorCode(failure);
      if (code === 'REFUND_FAILED') setRefundOutcome({ kind: 'failed' });
      setRefundError(overdueRefundErrorMessage(code));
    } finally {
      refundInFlight.current = false;
      setSendingRefund(false);
    }
  };

  const noteLength = holdNoteLength(note);
  const busy = isBusy || savingNote || sendingRefund;

  return (
    <section className="space-y-4" aria-labelledby="overdue-payouts-title">
      <div>
        <h2
          id="overdue-payouts-title"
          className="flex items-center gap-2 text-lg font-bold text-platinum"
        >
          <CalendarClock size={20} className="text-amber-400" /> Pagos vencidos
        </h2>
        <p className="mt-0.5 text-xs text-blue-light">
          {sellerCountLabel(pagination?.totalGroups ?? payouts.length)}
        </p>
        <p className="mt-1 max-w-2xl text-xs text-blue-light/70">
          El vendedor no puede cobrar y nada se reembolsa solo. Sigue reteniendo
          el pago con una nota o, solo si Stripe rechazó la cuenta del vendedor,
          reembolsa al comprador.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {payouts.map((payout) => (
          <OverduePayoutCard
            key={payout.shipmentId}
            payout={payout}
            busy={busy}
            onHold={() => setHolding(payout)}
            onRefund={() => setRefunding(payout)}
          />
        ))}
      </div>

      {pagination && onPageChange ? (
        <PayoutPagination
          page={pagination.page}
          total={pagination.totalGroups}
          label="pagos vencidos"
          display="pages"
          disabled={busy}
          onPageChange={onPageChange}
        />
      ) : null}

      {holding ? (
        <Modal title="Seguir reteniendo el pago" onClose={closeNote}>
          <form
            className="space-y-4 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNote();
            }}
          >
            <h3 className="text-lg font-bold text-platinum" aria-hidden="true">
              Seguir reteniendo el pago
            </h3>
            <p className="text-sm text-blue-light">
              El pago del envío {shortId(holding.shipmentId)} de{' '}
              {sellerLabel(holding)} sigue retenido. Explica por qué; la nota
              queda registrada con tu usuario y no se puede editar.
            </p>
            <label className="block text-xs font-semibold text-platinum">
              Nota para seguir reteniendo
              <textarea
                ref={noteField}
                value={note}
                rows={4}
                disabled={savingNote}
                aria-invalid={noteInvalid || undefined}
                aria-describedby={
                  noteInvalid
                    ? 'hold-note-counter hold-note-error'
                    : 'hold-note-counter'
                }
                onChange={(event) => {
                  setNote(event.target.value);
                  setNoteInvalid(false);
                  setNoteError(null);
                }}
                placeholder="Ej. Stripe sigue revisando la cuenta; volver a revisar el lunes."
                className={`mt-1 w-full rounded-xl border border-white/10 bg-night px-3 py-2 text-sm text-platinum disabled:opacity-40 ${workbenchFocus}`}
              />
            </label>
            <p
              id="hold-note-counter"
              className={`text-right text-[10px] tabular-nums ${noteLength > MAX_HOLD_NOTE_LENGTH ? 'text-fire' : 'text-blue-light'}`}
            >
              {`${noteLength}/${MAX_HOLD_NOTE_LENGTH}`}
            </p>
            {noteError ? (
              <p
                id="hold-note-error"
                role="alert"
                className="text-xs text-fire"
              >
                {noteError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeNote}
                disabled={savingNote}
                className={secondary}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveNote}
                disabled={savingNote}
                className={`rounded-xl bg-lion px-4 py-2.5 text-xs font-bold text-night disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`}
              >
                {savingNote ? 'Guardando...' : 'Guardar nota'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {refunding ? (
        <Modal title="Reembolsar al comprador" onClose={closeRefund}>
          <div className="space-y-4 p-6">
            <h3
              className="flex items-center gap-2 text-lg font-bold text-platinum"
              aria-hidden="true"
            >
              <Undo2 size={20} className="text-fire" /> Reembolsar al comprador
            </h3>
            <p className="text-sm text-blue-light">
              Envío {shortId(refunding.shipmentId)} de {sellerLabel(refunding)}.
              Stripe rechazó la cuenta del vendedor.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-platinum">
              <li>
                El comprador recibe de vuelta lo que pagó por este envío: el
                producto y su parte de Seguro Selene.
              </li>
              <li>
                Selene absorbe el envío que ya pagó y la comisión de Stripe.
              </li>
              <li>No se puede deshacer.</li>
              <li>
                El servidor calcula el monto; desde aquí no se envía ningún
                importe.
              </li>
            </ul>
            {refundOutcome?.kind === 'refunded' ? (
              <p role="status" className="text-sm font-semibold text-forest">
                Reembolso hecho: {money(refundOutcome.amountCents)} MXN
                devueltos al comprador.
              </p>
            ) : null}
            {refundOutcome?.kind === 'pending' ? (
              <p role="status" className="text-sm font-semibold text-amber-400">
                Reembolso de {money(refundOutcome.amountCents)} MXN pendiente en
                Stripe. Se completa solo cuando Stripe lo confirme; no lo
                vuelvas a intentar.
              </p>
            ) : null}
            {refundError ? (
              <p role="alert" className="text-xs text-fire">
                {refundError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              {refundOutcome ? (
                <button
                  type="button"
                  onClick={closeRefund}
                  className={secondary}
                >
                  Cerrar
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={closeRefund}
                    disabled={sendingRefund}
                    className={secondary}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmRefund}
                    disabled={sendingRefund}
                    className={danger}
                  >
                    {sendingRefund ? 'Reembolsando...' : 'Confirmar reembolso'}
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
};

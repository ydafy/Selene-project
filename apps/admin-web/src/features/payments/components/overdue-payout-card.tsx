import { formatTime } from '@/shared/utils/format-date';
import type { OverduePayout } from '../logic/connect-payout-release-queue';
import {
  daysHeldLabel,
  sellerPayoutBlockReasonLabel,
} from '../logic/seller-payout-block-reason';
import { canRefundOverduePayout } from '../logic/overdue-payouts';
import {
  danger,
  money,
  secondary,
  sellerLabel,
  shortId,
} from './overdue-payout-presentation';

interface OverduePayoutCardProps {
  payout: OverduePayout;
  busy: boolean;
  onHold: () => void;
  onRefund: () => void;
}

/** One overdue held payout: why it is held, for how long, and its latest note. */
export const OverduePayoutCard = ({
  payout,
  busy,
  onHold,
  onRefund,
}: OverduePayoutCardProps) => (
  <article
    aria-label={`Pago vencido de ${sellerLabel(payout)}, envío ${shortId(payout.shipmentId)}`}
    className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-platinum">
          {sellerLabel(payout)}
        </p>
        {payout.sellerPayoutBlockReason ? (
          <p
            title={payout.sellerPayoutBlockReason}
            className="mt-1 text-xs font-semibold text-fire"
          >
            {sellerPayoutBlockReasonLabel(payout.sellerPayoutBlockReason)}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-amber-400">
          {money(payout.heldAmountCents)}
        </p>
        <p className="mt-0.5 text-[10px] text-blue-light">
          Pago retenido · MXN
        </p>
      </div>
    </div>
    <dl className="mt-3 space-y-1 text-[11px] text-blue-light">
      <div>
        <dt className="inline">Envío: </dt>
        <dd className="inline font-mono" title={payout.shipmentId}>
          {shortId(payout.shipmentId)}
        </dd>
        <dt className="inline"> · Orden: </dt>
        <dd className="inline font-mono" title={payout.orderId}>
          {shortId(payout.orderId)}
        </dd>
      </div>
      {payout.daysSinceCompleted !== null ? (
        <div>
          <dt className="sr-only">Tiempo retenido</dt>
          <dd className="font-semibold text-platinum">
            {daysHeldLabel(payout.daysSinceCompleted)}
          </dd>
        </div>
      ) : null}
    </dl>
    <div className="mt-3 rounded-xl border border-white/5 bg-night/30 p-3 text-xs">
      <p className="font-semibold text-platinum">Última nota</p>
      {payout.latestHoldNote ? (
        <>
          <p className="mt-1 whitespace-pre-wrap break-words text-platinum">
            {payout.latestHoldNote.note}
          </p>
          <p className="mt-1 text-[10px] text-blue-light">
            Admin{' '}
            <code title={payout.latestHoldNote.notedBy}>
              {shortId(payout.latestHoldNote.notedBy)}
            </code>{' '}
            ·{' '}
            <time dateTime={payout.latestHoldNote.notedAt}>
              {formatTime(payout.latestHoldNote.notedAt)}
            </time>
          </p>
        </>
      ) : (
        <p className="mt-1 text-blue-light">Sin notas todavía</p>
      )}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onHold}
        className={secondary}
      >
        Seguir reteniendo
      </button>
      {canRefundOverduePayout(payout.sellerPayoutBlockReason) ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRefund}
          className={danger}
        >
          Reembolsar al comprador
        </button>
      ) : null}
    </div>
  </article>
);

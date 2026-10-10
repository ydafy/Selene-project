import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { User } from 'lucide-react';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import { centsToMoney } from '../../../lib/connectEarnings';
import type { ReleaseQueueRun } from '../../../lib/connectPayoutReleaseQueue';

/**
 * Shared accent tones for the payout-run presentation language. Every
 * read-only bucket renders rows through `PayoutRunRow` so status color,
 * amount emphasis, and row anatomy stay identical across Processing,
 * Action required, and History.
 *
 * - `lion`: run authorized and still in flight.
 * - `amber`: outcome that needs operator attention.
 * - `forest`: server-confirmed paid outcome.
 * - `muted`: informational outcome without a corrective action.
 */
export type PayoutRunTone = 'lion' | 'amber' | 'forest' | 'muted';

interface TonePresentation {
  card: string;
  avatarIcon: string;
  amount: string;
  chip: string;
}

const TONE_PRESENTATION: Record<PayoutRunTone, TonePresentation> = {
  lion: {
    card: 'bg-state-gray border border-white/5 transition-all hover:border-lion/20',
    avatarIcon: 'text-lion',
    amount: 'text-lion',
    chip: 'border-lion/20 bg-lion/10 text-lion',
  },
  amber: {
    card: 'border border-amber-400/20 bg-amber-400/5',
    avatarIcon: 'text-amber-400',
    amount: 'text-amber-400',
    chip: 'border-amber-400/20 bg-amber-400/10 text-amber-400',
  },
  forest: {
    card: 'bg-state-gray border border-white/5 transition-all hover:border-forest/20',
    avatarIcon: 'text-forest',
    amount: 'text-forest',
    chip: 'border-forest/20 bg-forest/10 text-forest',
  },
  muted: {
    card: 'border border-white/10 bg-white/[0.03]',
    avatarIcon: 'text-blue-light',
    amount: 'text-platinum',
    chip: 'border-white/10 bg-white/5 text-blue-light',
  },
};

const EMPTY_STATE_PRESENTATION: Record<PayoutRunTone, string> = {
  lion: 'bg-lion/10 text-lion',
  amber: 'bg-amber-400/10 text-amber-400',
  forest: 'bg-forest/10 text-forest',
  muted: 'bg-white/5 text-blue-light',
};

interface PayoutRunRowProps {
  run: ReleaseQueueRun;
  tone: PayoutRunTone;
  chipIcon: LucideIcon;
  chipLabel: string;
  chipIconClassName?: string;
  chipClassName?: string;
  /** Operator-facing detail line rendered under the run ID (e.g. failure reason). */
  detail?: string | null;
  /** Trailing action slot below the amount/chip group (e.g. retry button). */
  action?: ReactNode;
}

/**
 * Shared payout-run card row. Presentation only: it never mutates data and
 * exposes money as already-validated integer cents from the queue mapper.
 */
export const PayoutRunRow = ({
  run,
  tone,
  chipIcon: ChipIcon,
  chipLabel,
  chipIconClassName,
  chipClassName,
  detail,
  action,
}: PayoutRunRowProps) => {
  const presentation = TONE_PRESENTATION[tone];

  return (
    <article className={`rounded-2xl p-4 ${presentation.card}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex items-start gap-3">
          <div
            className={`p-2 bg-white/5 rounded-xl shrink-0 ${presentation.avatarIcon}`}
          >
            <User size={18} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-platinum truncate">
              @{run.sellerName ?? run.sellerId}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-blue-light">
              Ejecución: {run.runId}
            </p>
            {detail ? (
              <p className="mt-1 text-xs capitalize text-blue-light">{detail}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <p className={`text-sm font-bold ${presentation.amount}`}>
              {formatCurrency(centsToMoney(run.amountCents))}
            </p>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${presentation.chip} ${chipClassName ?? ''}`}
            >
              <ChipIcon size={13} className={chipIconClassName} />
              {chipLabel}
            </span>
          </div>
          {action}
        </div>
      </div>
    </article>
  );
};

interface PayoutBucketEmptyStateProps {
  icon: LucideIcon;
  tone: PayoutRunTone;
  title: string;
  description: string;
}

/** Shared empty state for the read-only payout-run buckets. */
export const PayoutBucketEmptyState = ({
  icon: Icon,
  tone,
  title,
  description,
}: PayoutBucketEmptyStateProps) => (
  <div className="bg-state-gray border border-white/5 rounded-3xl p-10 text-center flex flex-col items-center justify-center">
    <div
      className={`p-4 rounded-full mb-3 ${EMPTY_STATE_PRESENTATION[tone]}`}
    >
      <Icon size={28} />
    </div>
    <h3 className="text-base font-bold text-platinum">{title}</h3>
    <p className="text-xs text-blue-light mt-1 max-w-sm">{description}</p>
  </div>
);

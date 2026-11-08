import type { LucideIcon } from 'lucide-react';

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

const EMPTY_STATE_PRESENTATION: Record<PayoutRunTone, string> = {
  lion: 'bg-lion/10 text-lion',
  amber: 'bg-amber-400/10 text-amber-400',
  forest: 'bg-forest/10 text-forest',
  muted: 'bg-white/5 text-blue-light',
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
    <div className={`p-4 rounded-full mb-3 ${EMPTY_STATE_PRESENTATION[tone]}`}>
      <Icon size={28} />
    </div>
    <h3 className="text-base font-bold text-platinum">{title}</h3>
    <p className="text-xs text-blue-light mt-1 max-w-sm">{description}</p>
  </div>
);

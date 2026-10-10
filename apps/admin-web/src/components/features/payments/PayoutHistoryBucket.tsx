import { CircleCheck, Receipt } from 'lucide-react';
import {
  PayoutBucketEmptyState,
  PayoutRunRow,
} from './PayoutRunRow';
import type { ReleaseQueueRun } from '../../../lib/connectPayoutReleaseQueue';

/**
 * Read-only bucket for terminal, confirmed payout runs (`paid`). The admin
 * payout release view does not expose `paid_at`, so rows show only the
 * server-confirmed status without invented timestamps. This is the seller
 * payout axis of the History frame; buyer Connect charges render as a
 * separate sibling view.
 */
interface PayoutHistoryBucketProps {
  runs: ReleaseQueueRun[];
}

export const PayoutHistoryBucket = ({ runs }: PayoutHistoryBucketProps) => {
  if (runs.length === 0) {
    return (
      <PayoutBucketEmptyState
        icon={Receipt}
        tone="forest"
        title="Sin dispersiones pagadas todavía"
        description="Las dispersiones pagadas a vendedores se registran aquí como historial de solo lectura."
      />
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="payout-history-runs-title">
      <div>
        <h2
          id="payout-history-runs-title"
          className="text-lg font-bold text-platinum flex items-center gap-2"
        >
          <Receipt size={20} className="text-forest" /> Dispersiones Pagadas a
          Vendedores
        </h2>
        <p className="text-xs text-blue-light mt-0.5">
          {runs.length}{' '}
          {runs.length === 1
            ? 'dispersión pagada confirmada'
            : 'dispersiones pagadas confirmadas'}
        </p>
        <p className="text-xs text-blue-light/70 mt-1 max-w-2xl">
          Registro de solo lectura de las dispersiones pagadas confirmadas por
          Stripe. No admite acciones.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {runs.map((run) => (
          <PayoutRunRow
            key={run.runId}
            run={run}
            tone="forest"
            chipIcon={CircleCheck}
            chipLabel={run.status}
            chipClassName="capitalize"
          />
        ))}
      </div>
    </section>
  );
};

import { Clock, Loader2 } from 'lucide-react';
import {
  PayoutBucketEmptyState,
  PayoutRunRow,
} from './PayoutRunRow';
import type { ReleaseQueueRun } from '../../../lib/connectPayoutReleaseQueue';

/**
 * Read-only bucket for payout runs that are still in flight
 * (`pending_reconciliation`). The admin payout release view does not expose
 * `release_stage`, so the copy stays deliberately generic about what the run
 * is waiting on.
 */
interface PayoutProcessingBucketProps {
  runs: ReleaseQueueRun[];
}

export const PayoutProcessingBucket = ({ runs }: PayoutProcessingBucketProps) => {
  if (runs.length === 0) {
    return (
      <PayoutBucketEmptyState
        icon={Clock}
        tone="lion"
        title="No hay dispersiones en proceso"
        description="Cuando autorices una dispersión aparecerá aquí hasta confirmarse."
      />
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="processing-runs-title">
      <div>
        <h2
          id="processing-runs-title"
          className="text-lg font-bold text-platinum flex items-center gap-2"
        >
          <Loader2 size={20} className="text-lion" /> Dispersión en Proceso
        </h2>
        <p className="text-xs text-blue-light mt-0.5">
          {runs.length}{' '}
          {runs.length === 1
            ? 'dispersión autorizada en curso'
            : 'dispersiones autorizadas en curso'}
        </p>
        <p className="text-xs text-blue-light/70 mt-1 max-w-2xl">
          Estas dispersiones fueron enviadas a Stripe y aún no quedan
          confirmadas. Esta vista es informativa: la conciliación avanza por sí
          sola y no requiere acción.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {runs.map((run) => (
          <PayoutRunRow
            key={run.runId}
            run={run}
            tone="lion"
            chipIcon={Loader2}
            chipIconClassName="animate-spin"
            chipLabel="En proceso"
          />
        ))}
      </div>
    </section>
  );
};

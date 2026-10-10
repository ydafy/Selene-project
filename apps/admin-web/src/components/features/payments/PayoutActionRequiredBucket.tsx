import {
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  PayoutBucketEmptyState,
  PayoutRunRow,
  type PayoutRunTone,
} from './PayoutRunRow';
import type {
  ReleaseQueueActionRequiredReason,
  ReleaseQueueActionRequiredRun,
} from '../../../lib/connectPayoutReleaseQueue';

const REASON_PRESENTATION: Record<
  ReleaseQueueActionRequiredReason,
  { label: string; tone: PayoutRunTone }
> = {
  retryable_failed: { label: 'Fallida — reintentable', tone: 'amber' },
  failed: { label: 'Fallida', tone: 'amber' },
  reconciliation_needed: { label: 'Conciliación requerida', tone: 'amber' },
  unexpected_status: { label: 'Estado no reconocido', tone: 'muted' },
  canceled: { label: 'Cancelada', tone: 'muted' },
  manual_review: { label: 'Revisión manual', tone: 'muted' },
};

const formatReason = (reason: string | null) =>
  reason ? reason.replaceAll('_', ' ').toLowerCase() : null;

/**
 * Bucket for payout runs that need operator attention. Only explicitly
 * retryable failed runs (`canRetry`) expose the retry action; every other
 * outcome is presented read-only without inventing new retry authority.
 */
interface PayoutActionRequiredBucketProps {
  runs: ReleaseQueueActionRequiredRun[];
  isReleasing: boolean;
  isRetrying: boolean;
  onRetryFailedPayout: (retryRunId: string) => void;
}

export const PayoutActionRequiredBucket = ({
  runs,
  isReleasing,
  isRetrying,
  onRetryFailedPayout,
}: PayoutActionRequiredBucketProps) => {
  if (runs.length === 0) {
    return (
      <PayoutBucketEmptyState
        icon={ShieldCheck}
        tone="forest"
        title="Nada requiere atención"
        description="No hay dispersiones fallidas ni corridas que necesiten revisión."
      />
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="action-required-runs-title">
      <div>
        <h2
          id="action-required-runs-title"
          className="text-lg font-bold text-platinum flex items-center gap-2"
        >
          <AlertTriangle size={20} className="text-amber-400" /> Requieren
          Atención
        </h2>
        <p className="text-xs text-blue-light mt-0.5">
          {runs.length}{' '}
          {runs.length === 1
            ? 'corrida necesita revisión'
            : 'corridas necesitan revisión'}
        </p>
        <p className="text-xs text-blue-light/70 mt-1 max-w-2xl">
          Los reintentos usan únicamente el ID de la ejecución fallida; el
          servidor reconstruye y valida la dispersión. Las corridas canceladas
          son terminales y no pueden liberarse ni reintentarse desde aquí.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {runs.map((run) => {
          const presentation = REASON_PRESENTATION[run.reason];
          const chipIcon =
            presentation.tone === 'amber' ? AlertTriangle : ShieldAlert;

          return (
            <PayoutRunRow
              key={run.runId}
              run={run}
              tone={presentation.tone}
              chipIcon={chipIcon}
              chipLabel={presentation.label}
              detail={
                formatReason(run.failureReason) ?? formatReason(run.status)
              }
              action={
                run.canRetry ? (
                  <button
                    type="button"
                    onClick={() => onRetryFailedPayout(run.runId)}
                    disabled={isRetrying || isReleasing}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-night transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw
                      size={14}
                      className={isRetrying ? 'animate-spin' : ''}
                    />
                    {isRetrying ? 'Reintentando...' : 'Reintentar Dispersión'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-blue-light opacity-60"
                  >
                    <ShieldAlert size={14} /> Sin acciones disponibles
                  </button>
                )
              }
            />
          );
        })}
      </div>
    </section>
  );
};

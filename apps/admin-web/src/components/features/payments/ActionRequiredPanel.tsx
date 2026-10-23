import { useState, type ReactNode } from 'react';
import { RefundProblemsBucket } from './RefundProblemsBucket';
import { workbenchFocus } from './PayoutWorkbenchLayout';
import {
  useResolveShipmentRefund,
  useShipmentRefundProblems,
} from '../../../hooks/useShipmentRefundProblems';

type ActionRequiredView = 'payouts' | 'refunds';

interface ActionRequiredPanelProps {
  /** Action-required payout runs in the current queue read. */
  payoutCount: number;
  /** The existing payout-run workbench; rendered untouched under Dispersiones. */
  children: ReactNode;
}

/**
 * "Necesita atención" content: one chip per kind of work, each with its own
 * component and query so seller payouts and buyer refunds never share a list.
 * The refunds query runs whichever chip is selected, so its count is always shown.
 */
export const ActionRequiredPanel = ({ payoutCount, children }: ActionRequiredPanelProps) => {
  const [view, setView] = useState<ActionRequiredView>('payouts');
  const refunds = useShipmentRefundProblems();
  const resolver = useResolveShipmentRefund();

  const chips: Array<{ id: ActionRequiredView; label: string; count: string }> = [
    { id: 'payouts', label: 'Dispersiones', count: String(payoutCount) },
    { id: 'refunds', label: 'Reembolsos', count: refunds.count === null ? '—' : String(refunds.count) },
  ];

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Tipo de pendiente" className="flex flex-wrap gap-2">
        {chips.map(({ id, label, count }) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className={`min-h-9 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${workbenchFocus} ${view === id ? 'border-lion/40 bg-lion/10 text-lion' : 'border-white/10 text-blue-light hover:text-platinum'}`}
          >
            {`${label} (${count})`}
          </button>
        ))}
      </div>
      {view === 'payouts' ? (
        children
      ) : (
        <RefundProblemsBucket
          problems={refunds.problems}
          isLoading={refunds.isLoading}
          isError={refunds.isError}
          isResolving={resolver.isPending}
          onRetry={() => void refunds.refetch()}
          onResolve={resolver.resolve}
        />
      )}
    </div>
  );
};

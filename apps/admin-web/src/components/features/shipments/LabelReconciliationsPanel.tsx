import { LabelReconciliationsBucket } from './LabelReconciliationsBucket';
import {
  useLabelReconciliations,
  useResolveLabelReconciliation,
} from '../../../hooks/useLabelReconciliations';

/** Wires the stuck-label query and the resolution into their bucket. */
export const LabelReconciliationsPanel = () => {
  const reconciliations = useLabelReconciliations();
  const resolver = useResolveLabelReconciliation();
  return (
    <LabelReconciliationsBucket
      cases={reconciliations.cases}
      isLoading={reconciliations.isLoading}
      isError={reconciliations.isError}
      isResolving={resolver.isPending}
      onRetry={() => void reconciliations.refetch()}
      onResolve={resolver.resolve}
    />
  );
};

import { LateCarrierActivityBucket } from './LateCarrierActivityBucket';
import {
  useAcknowledgeLateCarrierActivity,
  useLateCarrierActivity,
} from '../../../hooks/useLateCarrierActivity';

/** Wires the late carrier activity query and acknowledgement into their bucket. */
export const LateCarrierActivityPanel = () => {
  const activity = useLateCarrierActivity();
  const acknowledger = useAcknowledgeLateCarrierActivity();
  return (
    <LateCarrierActivityBucket
      cases={activity.cases}
      isLoading={activity.isLoading}
      isError={activity.isError}
      isAcknowledging={acknowledger.isPending}
      onRetry={() => void activity.refetch()}
      onAcknowledge={acknowledger.acknowledge}
    />
  );
};

import { useEffect } from 'react';
import { OverduePayoutsBucket } from './overdue-payouts-bucket';
import {
  useRecordPayoutHoldNote,
  useRefundOverduePayout,
} from '../hooks/use-overdue-payout-actions';
import type { OverduePayout } from '../logic/connect-payout-release-queue';

interface OverduePayoutsPanelProps {
  payouts: OverduePayout[];
  pagination?: { page: number; totalGroups: number };
  onPageChange: (page: number) => void;
  isLoading: boolean;
  /** Keeps the tabs and search still while a note or refund is in flight. */
  onBusyChange: (busy: boolean) => void;
}

/** "Pagos vencidos" tab: wires the overdue actions to the bucket. */
export const OverduePayoutsPanel = ({
  onBusyChange,
  ...props
}: OverduePayoutsPanelProps) => {
  const holdNote = useRecordPayoutHoldNote();
  const refund = useRefundOverduePayout();
  const busy = holdNote.isPending || refund.isPending;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  return (
    <OverduePayoutsBucket
      {...props}
      isBusy={busy}
      onRecordHoldNote={holdNote.record}
      onRefund={refund.refund}
    />
  );
};

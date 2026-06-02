import { Wallet, Clock, CheckCircle, XCircle } from 'lucide-react';
import { StatCard } from '../../ui/StatCard';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import type { PayoutOverviewRow } from '../../../hooks/usePayoutRequests';

interface KPIPaymentsCardsProps {
  payouts: PayoutOverviewRow[];
}

export const KPIPaymentsCards = ({ payouts }: KPIPaymentsCardsProps) => {
  const totalPending = payouts
    .filter((p) => p.status === 'pending')
    .reduce((sum, p) => sum + p.amount, 0);

  const totalProcessing = payouts
    .filter((p) => p.status === 'processing')
    .reduce((sum, p) => sum + p.amount, 0);

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const totalCompletedMonth = payouts
    .filter(
      (p) =>
        p.status === 'completed' &&
        p.completed_at &&
        new Date(p.completed_at) >= startOfMonth,
    )
    .reduce((sum, p) => sum + p.amount, 0);

  const rejectedCount = payouts.filter((p) => p.status === 'rejected').length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Total Pendiente"
        value={formatCurrency(totalPending)}
        icon={Wallet}
        color="text-lion"
      />
      <StatCard
        title="Retiros en Proceso"
        value={formatCurrency(totalProcessing)}
        icon={Clock}
        color="text-blue-light"
      />
      <StatCard
        title="Volumen Procesado (mes)"
        value={formatCurrency(totalCompletedMonth)}
        icon={CheckCircle}
        color="text-forest"
      />
      <StatCard
        title="Retiros Fallidos"
        value={rejectedCount}
        icon={XCircle}
        color="text-fire"
      />
    </div>
  );
};

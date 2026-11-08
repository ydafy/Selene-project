export type StatusType =
  | 'pending'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'dispute'
  | 'VERIFIED'
  | 'SOLD'
  | 'REJECTED'
  | 'IN_REVIEW'
  | 'PENDING_VERIFICATION'
  | 'HIDDEN'
  | 'IN_DISPUTE'
  | 'RESERVED'
  // Dispute statuses
  | 'open'
  | 'under_review'
  | 'waiting_return'
  | 'resolved'
  | 'return_shipped'
  | 'return_delivered'
  // Payout statuses
  | 'processing'
  | 'rejected';

interface Props {
  status: StatusType;
}

export const StatusBadge = ({ status }: Props) => {
  // Subtle pulse for statuses that indicate active/in-progress states
  const activeStatuses = new Set([
    'pending',
    'open',
    'under_review',
    'PENDING_VERIFICATION',
    'IN_REVIEW',
    'IN_DISPUTE',
    'waiting_return',
    'return_shipped',
    'processing',
  ]);
  const isActive = activeStatuses.has(status);

  // Mapeo de colores (Órdenes y Productos)
  const config: Record<string, string> = {
    // Órdenes
    pending:
      'bg-status-pending/10 text-status-pending border-status-pending/20',
    paid: 'bg-status-paid/10 text-status-paid border-status-paid/20',
    preparing:
      'bg-status-preparing/10 text-status-preparing border-status-preparing/20',
    shipped:
      'bg-status-shipped/10 text-status-shipped border-status-shipped/20',
    delivered:
      'bg-status-delivered/10 text-status-delivered border-status-delivered/20',
    completed:
      'bg-status-completed/10 text-status-completed border-status-completed/20',
    cancelled:
      'bg-status-cancelled/10 text-status-cancelled border-status-cancelled/20',
    refunded:
      'bg-status-refunded/10 text-status-refunded border-status-refunded/20',
    dispute:
      'bg-status-dispute/10 text-status-dispute border-status-dispute/20',

    // Productos (Mapeo lógico a colores de orden)
    VERIFIED:
      'bg-status-delivered/10 text-status-delivered border-status-delivered/20',
    SOLD: 'bg-status-completed/10 text-status-completed border-status-completed/20',
    REJECTED:
      'bg-status-dispute/10 text-status-dispute border-status-dispute/20',
    IN_REVIEW:
      'bg-status-pending/10 text-status-pending border-status-pending/20',
    HIDDEN:
      'bg-status-cancelled/10 text-status-cancelled border-status-cancelled/20',
    IN_DISPUTE:
      'bg-status-dispute/10 text-status-dispute border-status-dispute/20',
    RESERVED:
      'bg-status-preparing/10 text-status-preparing border-status-preparing/20',

    //Disputas
    open: 'bg-status-pending/10 text-status-pending border-status-pending/20',
    under_review:
      'bg-status-preparing/10 text-status-preparing border-status-preparing/20',
    waiting_return: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    resolved:
      'bg-status-completed/10 text-status-completed border-status-completed/20',

    // Payouts (Retiros a banco)
    processing:
      'bg-status-preparing/10 text-status-preparing border-status-preparing/20',
    rejected:
      'bg-status-dispute/10 text-status-dispute border-status-dispute/20',
  };

  const style = config[status] || 'bg-white/5 text-blue-light border-white/10';

  return (
    <span
      className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${style} whitespace-nowrap ${
        isActive ? 'motion-safe:animate-pulse' : ''
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
};

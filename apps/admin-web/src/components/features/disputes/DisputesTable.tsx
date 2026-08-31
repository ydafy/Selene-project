import { useMemo } from 'react';
import { Gavel, ChevronRight, Calendar } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';
import { DataTable } from '../../ui/DataTable';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import { formatTime } from '../../../lib/utils/formatDate';
import type { ColumnDef } from '@tanstack/react-table';
import type { StatusType } from '../../ui/StatusBadge';
import type { DisputeSummary } from '@selene/types';

interface Props {
  disputes: DisputeSummary[] | undefined;
  isLoading: boolean;
  onViewDetails: (id: string) => void;
}

export const DisputesTable = ({
  disputes,
  isLoading,
  onViewDetails,
}: Props) => {
  const columns: ColumnDef<DisputeSummary>[] = useMemo(
    () => [
      {
        accessorKey: 'dispute_date',
        header: 'Reporte',
        cell: ({ getValue }) => {
          const date = getValue() as string | null;
          return (
            <div className="flex items-center gap-2 text-blue-light">
              <Calendar size={13} className="text-lion shrink-0" />
              <span className="text-xs">{formatTime(date)}</span>
            </div>
          );
        },
      },
      {
        id: 'order_amount',
        header: 'Orden / Monto',
        cell: ({ row }) => {
          const orderId = row.original.order_id || '--------';
          const amount = row.original.total_amount || 0;
          return (
            <div>
              <p className="text-sm font-bold text-platinum">
                #{orderId.slice(0, 8).toUpperCase()}
              </p>
              <p className="text-xs font-bold text-forest mt-0.5">
                {formatCurrency(amount)}
              </p>
            </div>
          );
        },
      },
      {
        id: 'parties',
        header: 'Involucrados',
        cell: ({ row }) => {
          const buyer = row.original.buyer_username || 'anon';
          const seller = row.original.seller_username || 'anon';
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-blue-light/50 w-8">Com:</span>
                <span className="text-platinum font-bold">@{buyer}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-blue-light/50 w-8">Ven:</span>
                <span className="text-platinum/60">@{seller}</span>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'dispute_description_preview',
        header: 'Motivo',
        cell: ({ getValue }) => {
          const reason = getValue() as string | null;
          return (
            <p className="text-xs text-platinum truncate max-w-55 capitalize">
              {reason?.replace(/_/g, ' ') || 'Sin motivo especificado'}
            </p>
          );
        },
      },
      {
        accessorKey: 'dispute_status',
        header: 'Estatus',
        cell: ({ getValue }) => (
          <StatusBadge status={(getValue() ?? 'open') as StatusType} />
        ),
      },
      {
        id: 'action',
        header: 'Acción',
        cell: ({ row }) => (
          <div className="text-right">
            <button
              type="button"
              aria-label={`Ver detalles de la disputa ${row.original.dispute_id}`}
              onClick={(e) => {
                e.stopPropagation();
                if (row.original.dispute_id) {
                  onViewDetails(row.original.dispute_id);
                }
              }}
              className="p-2 bg-lion/10 text-lion rounded-xl hover:bg-lion hover:text-night transition-all active:scale-95 cursor-pointer"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        ),
      },
    ],
    [onViewDetails],
  );

  if (isLoading) {
    return (
      <DataTable<DisputeSummary>
        columns={columns}
        data={[]}
        isLoading={true}
        skeletonRowCount={5}
      />
    );
  }

  if (!disputes || disputes.length === 0) {
    return (
      <div className="p-20 text-center flex flex-col items-center bg-state-gray rounded-3xl border border-white/5">
        <Gavel size={48} className="text-blue-light/10 mb-4" />
        <h3 className="text-base font-bold text-platinum mb-1">
          Bandeja de entrada al día
        </h3>
        <p className="text-xs text-blue-light italic">
          No hay disputas pendientes de mediación en este momento.
        </p>
      </div>
    );
  }

  return (
    <DataTable<DisputeSummary>
      columns={columns}
      data={disputes}
      onRowClick={(row) => {
        if (row.dispute_id) onViewDetails(row.dispute_id);
      }}
    />
  );
};

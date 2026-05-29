import { useMemo } from 'react';
import { History } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';
import { DataTable } from '../../ui/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { StatusType } from '../../ui/StatusBadge';
import type { PayoutRequest } from '@selene/types';

interface Props {
  payouts: PayoutRequest[];
}

export const UserPayoutsTable = ({ payouts }: Props) => {
  const columns: ColumnDef<PayoutRequest>[] = useMemo(
    () => [
      {
        accessorKey: 'amount',
        header: 'Monto',
        cell: ({ getValue }) => {
          const amount = (getValue() as number) || 0;
          return (
            <span className="font-bold text-platinum">
              ${amount.toLocaleString()}
            </span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Estatus',
        cell: ({ getValue }) => {
          const status = getValue() as string | null;
          return <StatusBadge status={(status ?? 'processing') as StatusType} />;
        },
      },
      {
        accessorKey: 'requested_at',
        header: 'Fecha',
        cell: ({ getValue }) => {
          const date = getValue() as string | null;
          return (
            <span className="text-xs text-blue-light">
              {date ? new Date(date).toLocaleDateString() : 'N/A'}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="max-h-[300px] overflow-y-auto">
      <DataTable<PayoutRequest>
        columns={columns}
        data={payouts}
        header={
          <h3 className="font-bold text-platinum flex items-center gap-2">
            <History size={18} className="text-lion" /> Historial de Retiros
          </h3>
        }
        emptyMessage="No hay retiros registrados."
      />
    </div>
  );
};

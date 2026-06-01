import { useMemo } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  ReceiptText,
  AlertCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DataTable } from '../../ui/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { WalletTransaction } from '@selene/types';
import { TaxWithholdingCell } from './TaxWithholdingCell';

interface Props {
  transactions: WalletTransaction[];
}

function getTypeLabel(type: WalletTransaction['type']) {
  const labels: Record<
    WalletTransaction['type'],
    { text: string; color: string; icon: LucideIcon }
  > = {
    sale_proceeds: {
      text: 'Venta',
      color: 'text-forest',
      icon: ArrowUpRight,
    },
    payout: { text: 'Retiro', color: 'text-fire', icon: ArrowDownLeft },
    refund: {
      text: 'Reembolso',
      color: 'text-blue-light',
      icon: ArrowDownLeft,
    },
    adjustment: { text: 'Ajuste', color: 'text-lion', icon: ReceiptText },
    release: {
      text: 'Liberación',
      color: 'text-forest',
      icon: ArrowUpRight,
    },
  };
  return (
    labels[type] || {
      text: type,
      color: 'text-platinum',
      icon: ReceiptText,
    }
  );
}

export const UserTransactionsTable = ({ transactions }: Props) => {
  if (!transactions || transactions.length === 0) {
    return (
      <div className="bg-state-gray rounded-3xl border border-white/5 p-12 flex flex-col items-center justify-center text-center">
        <AlertCircle size={40} className="text-blue-light/20 mb-4" />
        <p className="text-blue-light italic text-sm">
          No se han registrado movimientos financieros aún.
        </p>
      </div>
    );
  }

  const columns: ColumnDef<WalletTransaction>[] = useMemo(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Fecha',
        cell: ({ getValue }) => {
          const date = getValue() as string;
          return (
            <span className="text-xs text-blue-light">
              {new Date(date).toLocaleString([], {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
          );
        },
      },
      {
        id: 'type_description',
        header: 'Tipo / Descripción',
        cell: ({ row }) => {
          const typeInfo = getTypeLabel(row.original.type);
          const Icon = typeInfo.icon;
          return (
            <div className="flex items-center gap-2">
              <Icon size={14} className={typeInfo.color} />
              <div>
                <p className={`text-xs font-bold ${typeInfo.color}`}>
                  {typeInfo.text}
                </p>
                <p className="text-[10px] text-blue-light truncate max-w-[150px]">
                  {row.original.description || 'Sin descripción'}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'amount',
        header: 'Monto Bruto',
        cell: ({ getValue }) => {
          const amount = (getValue() as number) || 0;
          return (
            <span className="text-xs text-platinum font-medium">
              ${amount.toLocaleString()}
            </span>
          );
        },
        enableSorting: true,
      },
      {
        accessorKey: 'fee_deducted',
        header: 'Comisión Selene',
        cell: ({ getValue }) => {
          const fee = (getValue() as number) || 0;
          return fee > 0 ? (
            <span className="text-xs font-medium text-fire">
              -${fee.toLocaleString()}
            </span>
          ) : (
            <span className="text-blue-light/30">—</span>
          );
        },
      },
      {
        accessorKey: 'tax_withholding',
        header: 'Retención SAT',
        cell: ({ getValue }) => {
          const tax = getValue() as number | null;
          return <TaxWithholdingCell tax={tax} />;
        },
      },
      {
        accessorKey: 'shipping_cost',
        header: 'Costo Envío',
        cell: ({ getValue }) => {
          const shipping = (getValue() as number) || 0;
          return shipping > 0 ? (
            <span className="text-xs font-medium text-fire">
              -${shipping.toLocaleString()}
            </span>
          ) : (
            <span className="text-blue-light/30">—</span>
          );
        },
      },
      {
        accessorKey: 'net_amount',
        header: 'Neto',
        cell: ({ getValue }) => {
          const net = (getValue() as number) || 0;
          return (
            <span
              className={`text-sm font-bold ${
                net < 0
                  ? 'text-fire'
                  : net > 0
                    ? 'text-forest'
                    : 'text-platinum'
              }`}
            >
              {net > 0 ? '+' : ''}${net.toLocaleString()}
            </span>
          );
        },
      },
      {
        accessorKey: 'balance_after',
        header: 'Saldo Final',
        cell: ({ getValue }) => {
          const balance = (getValue() as number) || 0;
          return (
            <span className="text-xs font-mono text-lion bg-white/[0.02] px-2 py-1 rounded">
              ${balance.toLocaleString()}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <DataTable<WalletTransaction>
      columns={columns}
      data={transactions}
      header={
        <h3 className="font-bold text-platinum flex items-center gap-2">
          <ReceiptText size={18} className="text-lion" /> Historial de
          Movimientos (Ledger)
        </h3>
      }
    />
  );
};

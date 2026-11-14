import { useMemo } from 'react';
import { ShoppingBag } from 'lucide-react';
import { StatusBadge } from '@/shared/ui/status-badge';
import { DataTable, type ColumnDef } from '@/shared/ui/data-table';
import { SecureImage } from '@/shared/ui/secure-image';
import { centsToMoney } from '@/shared/utils/cents-to-money';
import { formatCurrency } from '@/shared/utils/format-currency';
import type { StatusType } from '@/shared/ui/status-badge';
import type { OrderItemWithProduct } from '@selene/types';

interface Props {
  items: OrderItemWithProduct[];
}

export const PurchasesTable = ({ items }: Props) => {
  const columns: ColumnDef<OrderItemWithProduct>[] = useMemo(
    () => [
      {
        accessorKey: 'product',
        header: 'Producto',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <SecureImage
              path={row.original.product?.images?.[0] ?? ''}
              alt=""
              className="w-8 h-8 rounded bg-night"
            />
            <p className="text-sm text-platinum truncate max-w-[150px]">
              {row.original.product?.name}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'price_at_purchase_cents',
        header: 'Precio Pagado',
        cell: ({ getValue }) => {
          const priceCents = getValue() as number;
          return (
            <span className="text-sm text-platinum">
              {formatCurrency(centsToMoney(priceCents))}
            </span>
          );
        },
      },
      {
        id: 'order_status',
        header: 'Estado Orden',
        cell: ({ row }) => (
          <StatusBadge status={row.original.orders?.status as StatusType} />
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'Fecha',
        cell: ({ getValue }) => {
          const date = getValue() as string;
          return (
            <span className="text-xs text-blue-light">
              {new Date(date).toLocaleDateString()}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (items.length === 0) {
    void columns;
    return null;
  }

  return (
    <DataTable<OrderItemWithProduct>
      columns={columns}
      data={items}
      header={
        <>
          <h3 className="font-bold text-platinum flex items-center gap-2">
            <ShoppingBag size={18} className="text-forest" /> Compras Recientes
          </h3>
          <span className="text-xs text-blue-light">
            {items.length} artículos
          </span>
        </>
      }
    />
  );
};

import { useMemo } from 'react';
import { ShoppingBag } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';
import { DataTable } from '../../ui/DataTable';
import { SecureImage } from '../../ui/SecureImage';
import type { ColumnDef } from '@tanstack/react-table';
import type { StatusType } from '../../ui/StatusBadge';
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
        accessorKey: 'price_at_purchase',
        header: 'Precio Pagado',
        cell: ({ getValue }) => {
          const price = getValue() as number;
          return (
            <span className="text-sm text-platinum">
              ${price?.toLocaleString()}
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

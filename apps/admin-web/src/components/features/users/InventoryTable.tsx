import { useMemo } from 'react';
import { Package } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';
import { DataTable } from '../../ui/DataTable';
import { SecureImage } from '../../ui/SecureImage';
import type { ColumnDef } from '@tanstack/react-table';
import type { StatusType } from '../../ui/StatusBadge';
import type { Product } from '@selene/types';

interface Props {
  products: Product[];
  total: number;
}

export const InventoryTable = ({ products, total }: Props) => {
  const columns: ColumnDef<Product>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Producto',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <SecureImage
              path={row.original.images?.[0] ?? ''}
              alt={row.original.name}
              className="w-10 h-10 rounded-lg object-cover bg-night border border-white/5"
            />
            <p className="text-sm font-medium text-platinum truncate max-w-[200px]">
              {row.original.name}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'price',
        header: 'Precio',
        cell: ({ getValue }) => {
          const price = getValue() as number;
          return (
            <span className="text-sm text-platinum">
              ${(price || 0).toLocaleString()}
            </span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Estatus',
        cell: ({ getValue }) => (
          <StatusBadge status={getValue() as StatusType} />
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

  return (
    <DataTable<Product>
      columns={columns}
      data={products}
      header={
        <>
          <h3 className="font-bold text-platinum flex items-center gap-2">
            <Package size={18} className="text-lion" /> Inventario Reciente
          </h3>
          <span className="text-xs text-blue-light">
            {products.length} de {total} publicados
          </span>
        </>
      }
      emptyMessage="Este usuario no tiene productos registrados."
    />
  );
};

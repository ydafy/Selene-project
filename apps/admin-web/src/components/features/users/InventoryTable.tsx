/* eslint-disable @typescript-eslint/no-explicit-any */
import { Package } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';

interface Props {
  products: any[];
  total: number;
}

export const InventoryTable = ({ products, total }: Props) => {
  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden">
      <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
        <h3 className="font-bold text-platinum flex items-center gap-2">
          <Package size={18} className="text-lion" /> Inventario Reciente
        </h3>
        <span className="text-xs text-blue-light">
          {products.length} de {total} publicados
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-night/50 text-[10px] uppercase text-blue-light font-bold">
            <tr>
              <th className="p-4">Producto</th>
              <th className="p-4">Precio</th>
              <th className="p-4">Estatus</th>
              <th className="p-4">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {products.map((product: any) => (
              <tr
                key={product.id}
                className="hover:bg-white/[0.01] transition-colors"
              >
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={product.images?.[0]}
                      className="w-10 h-10 rounded-lg object-cover bg-night border border-white/5"
                      alt={product.name}
                    />
                    <p className="text-sm font-medium text-platinum truncate max-w-[200px]">
                      {product.name}
                    </p>
                  </div>
                </td>
                <td className="p-4 text-sm text-platinum">
                  ${(product.price || 0).toLocaleString()}
                </td>
                <td className="p-4">
                  <StatusBadge status={product.status} />
                </td>
                <td className="p-4 text-xs text-blue-light">
                  {new Date(product.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-12 text-center text-sm text-blue-light italic"
                >
                  Este usuario no tiene productos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ShoppingBag } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';

interface Props {
  items: any[];
}

export const PurchasesTable = ({ items }: Props) => {
  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden">
      <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
        <h3 className="font-bold text-platinum flex items-center gap-2">
          <ShoppingBag size={18} className="text-forest" /> Compras Recientes
        </h3>
        <span className="text-xs text-blue-light">
          {items.length} artículos
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-night/50 text-[10px] uppercase text-blue-light font-bold">
            <tr>
              <th className="p-4">Producto</th>
              <th className="p-4">Precio Pagado</th>
              <th className="p-4">Estado Orden</th>
              <th className="p-4">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((item: any) => (
              <tr
                key={item.id}
                className="hover:bg-white/[0.01] transition-colors"
              >
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={item.product?.images?.[0]}
                      className="w-8 h-8 rounded bg-night"
                      alt=""
                    />
                    <p className="text-sm text-platinum truncate max-w-[150px]">
                      {item.product?.name}
                    </p>
                  </div>
                </td>
                <td className="p-4 text-sm text-platinum">
                  ${item.price_at_purchase?.toLocaleString()}
                </td>
                <td className="p-4">
                  <StatusBadge status={item.orders?.status} />
                </td>
                <td className="p-4 text-xs text-blue-light">
                  {new Date(item.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

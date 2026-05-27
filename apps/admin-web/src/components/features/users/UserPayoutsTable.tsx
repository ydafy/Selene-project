/* eslint-disable @typescript-eslint/no-explicit-any */
import { History } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';

interface Props {
  payouts: any[];
}

export const UserPayoutsTable = ({ payouts }: Props) => (
  <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl">
    <div className="p-6 border-b border-white/5 bg-white/5 flex justify-between items-center">
      <h3 className="font-bold text-platinum flex items-center gap-2">
        <History size={18} className="text-lion" /> Historial de Retiros
      </h3>
    </div>
    <div className="overflow-x-auto max-h-[300px]">
      <table className="w-full text-left">
        <thead className="bg-night/50 text-[10px] uppercase text-blue-light font-bold">
          <tr>
            <th className="p-4">Monto</th>
            <th className="p-4">Estatus</th>
            <th className="p-4">Fecha</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {payouts.map((p: any) => (
            <tr key={p.id} className="hover:bg-white/[0.01] transition-colors">
              <td className="p-4 font-bold text-platinum">
                ${(p.amount || 0).toLocaleString()}
              </td>
              <td className="p-4">
                <StatusBadge status={p.status} />
              </td>
              <td className="p-4 text-xs text-blue-light">
                {p.requested_at
                  ? new Date(p.requested_at).toLocaleDateString()
                  : 'N/A'}
              </td>
            </tr>
          ))}
          {payouts.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="p-12 text-center text-sm text-blue-light italic"
              >
                No hay retiros registrados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Gavel, ChevronRight, DollarSign, Calendar } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';

interface Props {
  disputes: any[] | undefined;
  isLoading: boolean;
  onViewDetails: (id: string) => void;
}

export const DisputesTable = ({
  disputes,
  isLoading,
  onViewDetails,
}: Props) => {
  if (isLoading) {
    return (
      <div className="p-20 text-center flex flex-col items-center bg-state-gray rounded-3xl border border-white/5">
        <div className="w-10 h-10 border-2 border-lion border-t-transparent animate-spin rounded-full mb-4" />
        <p className="text-blue-light animate-pulse font-medium">
          Sincronizando casos...
        </p>
      </div>
    );
  }

  if (!disputes || disputes.length === 0) {
    return (
      <div className="p-20 text-center flex flex-col items-center bg-state-gray rounded-3xl border border-white/5">
        <Gavel size={48} className="text-blue-light/10 mb-4" />
        <p className="text-sm text-blue-light italic">
          Bandeja de entrada vacía. No hay casos pendientes.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white/5 text-[10px] uppercase tracking-widest text-blue-light font-bold">
              <th className="p-4">Reporte</th>
              <th className="p-4">Orden / Monto</th>
              <th className="p-4">Involucrados</th>
              <th className="p-4">Motivo</th>
              <th className="p-4">Estatus</th>
              <th className="p-4 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {disputes.map((d) => (
              <tr
                key={d.dispute_id}
                className="hover:bg-white/[0.02] transition-colors group"
              >
                <td className="p-4">
                  <div className="flex items-center gap-2 text-blue-light">
                    <Calendar size={12} />
                    <span className="text-xs">
                      {new Date(d.dispute_date).toLocaleDateString()}
                    </span>
                  </div>
                </td>
                <td className="p-4">
                  <p className="text-sm font-bold text-platinum">
                    #{(d.order_id || '--------').slice(0, 8).toUpperCase()}
                  </p>
                  <div className="flex items-center gap-1 text-forest font-bold text-xs mt-0.5">
                    <DollarSign size={10} />
                    {(d.total_amount || 0).toLocaleString()}
                  </div>
                </td>
                <td className="p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-blue-light/50 w-8">Com:</span>
                      <span className="text-platinum font-bold">
                        @{d.buyer_username || 'anon'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-blue-light/50 w-8">Ven:</span>
                      <span className="text-platinum/60">
                        @{d.seller_username || 'anon'}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <p className="text-xs text-platinum truncate max-w-[200px] capitalize">
                    {/* FIX: Regex global para reemplazar todos los underscores */}
                    {d.dispute_reason_preview?.replace(/_/g, ' ') ||
                      'Sin motivo'}
                  </p>
                </td>
                <td className="p-4">
                  <StatusBadge status={d.dispute_status} />
                </td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => onViewDetails(d.dispute_id)}
                    className="p-2 bg-lion/10 text-lion rounded-xl hover:bg-lion hover:text-night transition-all active:scale-95"
                  >
                    <ChevronRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

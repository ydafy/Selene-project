/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ArrowUpRight,
  ArrowDownLeft,
  ReceiptText,
  AlertCircle,
} from 'lucide-react';

export const UserTransactionsTable = ({
  transactions,
}: {
  transactions: any[];
}) => {
  const getTypeLabel = (type: string) => {
    const labels: Record<string, { text: string; color: string; icon: any }> = {
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
      release: { text: 'Liberación', color: 'text-forest', icon: ArrowUpRight },
    };
    return (
      labels[type] || { text: type, color: 'text-platinum', icon: ReceiptText }
    );
  };

  // 1. MANEJO DE ESTADO VACÍO (Sugerencia IA Local)
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

  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl">
      <div className="p-6 border-b border-white/5 bg-white/5 flex justify-between items-center">
        <h3 className="font-bold text-platinum flex items-center gap-2">
          <ReceiptText size={18} className="text-lion" /> Historial de
          Movimientos (Ledger)
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-night/50 text-[10px] uppercase text-blue-light font-bold">
            <tr>
              <th className="p-4">Fecha</th>
              <th className="p-4">Tipo / Descripción</th>
              <th className="p-4 text-right">Monto Bruto</th>
              <th className="p-4 text-right">Comisión Selene</th>
              <th className="p-4 text-right">Costo Envío</th>
              <th className="p-4 text-right">Neto</th>
              <th className="p-4 text-right bg-white/[0.02]">Saldo Final</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {transactions.map((t: any) => {
              const typeInfo = getTypeLabel(t.type);
              const Icon = typeInfo.icon;

              // 2. FALLBACKS DE SEGURIDAD (Sugerencia IA Local)
              const amount = t.amount || 0;
              const fee = t.fee_deducted || 0;
              const shipping = t.shipping_cost || 0;
              const net = t.net_amount || 0;
              const balance = t.balance_after || 0;

              return (
                <tr
                  key={t.id}
                  className="hover:bg-white/[0.01] transition-colors"
                >
                  <td className="p-4 text-xs text-blue-light">
                    {new Date(t.created_at).toLocaleString([], {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Icon size={14} className={typeInfo.color} />
                      <div>
                        <p className={`text-xs font-bold ${typeInfo.color}`}>
                          {typeInfo.text}
                        </p>
                        <p className="text-[10px] text-blue-light truncate max-w-[150px]">
                          {t.description || 'Sin descripción'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-right text-xs text-platinum font-medium">
                    ${amount.toLocaleString()}
                  </td>

                  <td className="p-4 text-right">
                    {fee > 0 ? (
                      <div className="flex items-center justify-end gap-1 text-fire">
                        <span className="text-xs font-medium">
                          -${fee.toLocaleString()}
                        </span>
                      </div>
                    ) : (
                      <span className="text-blue-light/30">—</span>
                    )}
                  </td>

                  <td className="p-4 text-right">
                    {shipping > 0 ? (
                      <div className="flex items-center justify-end gap-1 text-fire">
                        <span className="text-xs font-medium">
                          -${shipping.toLocaleString()}
                        </span>
                      </div>
                    ) : (
                      <span className="text-blue-light/30">—</span>
                    )}
                  </td>

                  {/* 3. LÓGICA DE COLOR PARA NETO (MVP++: Rojo si es negativo) */}
                  <td
                    className={`p-4 text-right text-sm font-bold ${
                      net < 0
                        ? 'text-fire'
                        : net > 0
                          ? 'text-forest'
                          : 'text-platinum'
                    }`}
                  >
                    {net > 0 ? '+' : ''}${net.toLocaleString()}
                  </td>

                  <td className="p-4 text-right text-xs font-mono text-lion bg-white/[0.02]">
                    ${balance.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

import { Receipt } from 'lucide-react';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import { centsToMoney } from '../../../lib/connectEarnings';

interface PaymentIntentsTableProps {
  data: any[];
  isLoading: boolean;
}

export const PaymentIntentsTable = ({
  data,
  isLoading,
}: PaymentIntentsTableProps) => {
  return (
    <section className="bg-state-gray border border-white/5 rounded-3xl overflow-hidden shadow-xl">
      <div className="border-b border-white/5 p-5 bg-night/30">
        <h2 className="text-sm font-bold text-platinum uppercase tracking-widest flex items-center gap-2">
          <Receipt size={16} className="text-lion" /> Historial de Transacciones
          Stripe Connect
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/5 text-blue-light uppercase text-[10px] font-bold tracking-wider">
            <tr>
              <th className="text-left p-4">Vendedor</th>
              <th className="text-left p-4">PaymentIntent ID</th>
              <th className="text-left p-4">Monto Bruto</th>
              <th className="text-left p-4">Comisión Selene</th>
              <th className="text-left p-4">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              <tr>
                <td className="p-8 text-center text-blue-light" colSpan={5}>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-lion border-t-transparent animate-spin rounded-full" />
                    Cargando transacciones de Stripe...
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  className="p-8 text-center text-blue-light italic"
                  colSpan={5}
                >
                  No se encontraron transacciones registradas.
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-white/[0.02] transition-colors"
                >
                  <td className="p-4 font-semibold text-platinum">
                    @{row.seller_name ?? row.seller_id}
                  </td>
                  <td className="p-4 font-mono text-blue-light text-[11px]">
                    {row.stripe_payment_intent_id}
                  </td>
                  <td className="p-4 font-bold text-platinum">
                    {formatCurrency(centsToMoney(row.amount))}
                  </td>
                  <td className="p-4 font-bold text-lion">
                    {formatCurrency(centsToMoney(row.application_fee_amount))}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        row.status === 'succeeded'
                          ? 'bg-forest/10 text-forest border border-forest/20'
                          : row.status === 'canceled'
                            ? 'bg-fire/10 text-fire border border-fire/20'
                            : 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

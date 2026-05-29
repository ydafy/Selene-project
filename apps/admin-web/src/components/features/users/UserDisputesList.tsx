import { Gavel, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { StatusBadge } from '../../ui/StatusBadge';

type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'waiting_return'
  | 'resolved'
  | 'rejected'
  | 'return_shipped'
  | 'return_delivered';

interface DisputeWithOutcome {
  id: string;
  resolution_type: string | null;
  seller_id: string;
  reason: string;
  status: DisputeStatus | null;
  created_at: string | null;
}

export const UserDisputesList = ({
  disputes,
  currentUserId,
}: {
  disputes: DisputeWithOutcome[];
  currentUserId: string;
}) => {
  // Lógica para determinar el resultado relativo al usuario que estamos viendo
  const getUserOutcome = (d: DisputeWithOutcome) => {
    if (!d.resolution_type)
      return {
        label: 'En Revisión',
        color: 'text-blue-light bg-white/5 border-white/10',
        icon: Clock,
      };

    const isSeller = d.seller_id === currentUserId;
    const won =
      (isSeller && d.resolution_type === 'seller') ||
      (!isSeller && d.resolution_type === 'buyer');

    return won
      ? {
          label: 'Ganada',
          color: 'text-forest bg-forest/10 border-forest/20',
          icon: CheckCircle2,
        }
      : {
          label: 'Perdida',
          color: 'text-fire bg-fire/10 border-fire/20',
          icon: XCircle,
        };
  };

  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl mb-6">
      <div className="p-6 border-b border-white/5 bg-lion/5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-lion/10 rounded-lg text-lion">
            <Gavel size={20} />
          </div>
          <div>
            <h3 className="font-bold text-platinum">Historial de Disputas</h3>
            <p className="text-[10px] text-blue-light uppercase tracking-widest font-bold">
              Justicia Selene
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
        {disputes.length > 0 ? (
          disputes.map((d: DisputeWithOutcome) => {
            const outcome = getUserOutcome(d);
            const OutcomeIcon = outcome.icon;
            const isSeller = d.seller_id === currentUserId;

            return (
              <div
                key={d.id}
                className="bg-night/40 p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-all"
              >
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-blue-light uppercase tracking-tighter bg-white/5 px-1.5 py-0.5 rounded">
                        {isSeller ? 'Vendedor' : 'Comprador'}
                      </span>
                      <p className="text-sm font-bold text-platinum capitalize">
                        {d.reason.replace('_', ' ')}
                      </p>
                    </div>
                    <p className="text-[10px] text-blue-light/50 font-mono">
                      ID: {d.id.slice(0, 18)}...
                    </p>
                  </div>
                  <StatusBadge status={d.status ?? 'open'} />
                </div>

                {/* RESULTADO DEL CASO PARA ESTE USUARIO */}
                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${outcome.color}`}
                  >
                    <OutcomeIcon size={12} />
                    {outcome.label}
                  </div>

                  <span className="text-[10px] text-blue-light/40 font-medium">
                    {d.created_at ? new Date(d.created_at).toLocaleDateString(undefined, {
                      dateStyle: 'medium',
                    }) : ''}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-12 text-center">
            <p className="text-sm text-blue-light italic">
              Este usuario no tiene registros de disputas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

import { CheckCircle2, XCircle, User, Clock } from 'lucide-react';
import { useAuditLogs } from '../../../hooks/useAuditLogs';

export const ActivityFeed = () => {
  const { data: logs, isLoading } = useAuditLogs();

  if (isLoading)
    return (
      <div className="animate-pulse text-blue-light text-sm">
        Cargando actividad...
      </div>
    );

  return (
    <div className="bg-state-gray rounded-2xl border border-white/5 overflow-hidden">
      <div className="p-4 border-b border-white/5 bg-white/5">
        <h3 className="text-sm font-bold text-platinum uppercase tracking-widest flex items-center gap-2">
          <Clock size={14} className="text-lion" /> Actividad Reciente
        </h3>
      </div>

      <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
        {logs?.map((log) => (
          <div
            key={log.id}
            className="p-4 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-start gap-3">
              {/* Icono de Acción */}
              <div
                className={`mt-1 ${log.action_type === 'PRODUCT_APPROVE' ? 'text-forest' : 'text-fire'}`}
              >
                {log.action_type === 'PRODUCT_APPROVE' ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <XCircle size={16} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs text-platinum leading-relaxed">
                  <span className="font-bold text-lion">
                    {log.admin?.username || 'Sistema/Admin'}
                  </span>
                  {log.action_type === 'PRODUCT_APPROVE'
                    ? ' aprobó '
                    : ' rechazó '}
                  <span className="font-medium text-platinum">
                    "{log.details?.product_name}"
                  </span>
                </p>
                <p className="text-[10px] text-blue-light mt-1 flex items-center gap-1">
                  <User size={10} /> Vendedor:{' '}
                  {log.details?.seller_name || 'Usuario de Google'}
                </p>
              </div>

              <span className="text-[10px] text-blue-light whitespace-nowrap">
                {new Date(log.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        ))}

        {logs?.length === 0 && (
          <div className="p-8 text-center text-xs text-blue-light italic">
            No hay actividad registrada hoy.
          </div>
        )}
      </div>
    </div>
  );
};

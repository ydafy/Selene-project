import { Clock, AlertCircle, Inbox, User } from 'lucide-react';
import { useAuditLogs } from '../../../hooks/useAuditLogs';
import { getActionMeta } from '../../../lib/constants/auditActions';
import { formatTime } from '../../../lib/utils/formatDate';
import type { Json } from '@selene/types';

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function SkeletonRow() {
  return (
    <div className="p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="mt-1 w-4 h-4 bg-white/10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-white/10 rounded w-3/4" />
          <div className="h-2 bg-white/5 rounded w-1/2" />
        </div>
        <div className="h-2 bg-white/5 rounded w-16" />
      </div>
    </div>
  );
}

export const ActivityFeed = () => {
  const { data: logs, isLoading, isError, refetch } = useAuditLogs();

  if (isError) {
    return (
      <div className="bg-state-gray rounded-2xl border border-white/5 p-6 flex flex-col items-center justify-center gap-3 text-center min-h-75">
        <AlertCircle size={24} className="text-fire" />
        <p className="text-sm text-blue-light">Error al cargar la actividad.</p>
        <button
          onClick={() => refetch()}
          className="text-xs font-semibold text-fire underline underline-offset-2 hover:text-platinum transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-state-gray rounded-2xl border border-white/5 overflow-hidden">
        <div className="p-4 border-b border-white/5 bg-white/5">
          <h3 className="text-sm font-bold text-platinum uppercase tracking-widest flex items-center gap-2">
            <Clock size={14} className="text-lion" /> Actividad Reciente
          </h3>
        </div>
        <div className="divide-y divide-white/5">
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-state-gray rounded-2xl border border-white/5 overflow-hidden">
      <div className="p-4 border-b border-white/5 bg-white/5">
        <h3 className="text-sm font-bold text-platinum uppercase tracking-widest flex items-center gap-2">
          <Clock size={14} className="text-lion" /> Actividad Reciente
        </h3>
      </div>

      <div className="divide-y divide-white/5 max-h-100 overflow-y-auto">
        {logs?.map((log) => {
          const details = isRecord(log.details) ? log.details : null;
          const productName =
            typeof details?.product_name === 'string'
              ? details.product_name
              : '';
          const sellerName =
            typeof details?.seller_name === 'string' ? details.seller_name : '';

          const action = getActionMeta(log.action_type);
          const ActionIcon = action.icon;

          return (
            <div
              key={log.id}
              className="p-4 hover:bg-white/2 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-1 ${action.color} shrink-0`}>
                  <ActionIcon size={16} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs text-platinum leading-relaxed">
                    <span className="font-bold text-lion">
                      {log.admin?.username || 'Sistema/Admin'}
                    </span>{' '}
                    {action.verb}{' '}
                    {productName && (
                      <span className="font-medium text-platinum">
                        &ldquo;{productName}&rdquo;
                      </span>
                    )}
                  </p>
                  {sellerName && (
                    <p className="text-[10px] text-blue-light mt-1 flex items-center gap-1">
                      <User size={10} /> Vendedor: {sellerName}
                    </p>
                  )}
                </div>

                <span className="text-[10px] text-blue-light whitespace-nowrap ml-2">
                  {formatTime(log.created_at)}
                </span>
              </div>
            </div>
          );
        })}

        {(!logs || logs.length === 0) && (
          <div className="p-8 flex flex-col items-center justify-center gap-2 text-center">
            <Inbox size={24} className="text-blue-light" />
            <p className="text-xs text-blue-light italic">
              No hay actividad registrada hoy.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

import { MessageSquare, Clock, AlertCircle } from 'lucide-react';
import type { AdminAuditLog } from '@selene/types';

interface AdminNote {
  id: string;
  content: string;
  created_at: string | null;
  admin: { username: string | null } | null;
}

export const UserAdminHistory = ({
  logs,
  notes,
}: {
  logs: AdminAuditLog[];
  notes: AdminNote[];
}) => {
  // 1. Traductor de Acciones (MVP++)
  const getActionLabel = (type: string) => {
    const actions: Record<string, string> = {
      PRODUCT_APPROVE: 'aprobó un producto',
      PRODUCT_REJECT: 'rechazó un producto',
      USER_STATUS_UPDATE: 'cambió el estatus de la cuenta',
      USER_VERIFICATION_TOGGLE: 'modificó el Sello VIP (Check Azul)',
      BANK_VERIFICATION_UPDATE: 'auditó la cuenta bancaria',
      USER_EMAIL_CHANGED: 'actualizó el correo electrónico',
    };
    return actions[type] || type;
  };

  return (
    <div className="space-y-6">
      {/* BITÁCORA DE ACCIONES */}
      <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl">
        <div className="p-6 border-b border-white/5 bg-white/5">
          <h3 className="font-bold text-platinum flex items-center gap-2 text-sm uppercase tracking-wider">
            <Clock size={18} className="text-lion" /> Historial de Auditoría
          </h3>
        </div>
        <div className="p-4 space-y-3 max-h-75 overflow-y-auto">
          {logs.length > 0 ? (
            logs.map((log: AdminAuditLog) => (
              <div
                key={log.id}
                className="flex gap-3 text-xs p-3 bg-night/30 rounded-xl border border-white/5 transition-colors"
              >
                <span className="text-blue-light/50 font-mono whitespace-nowrap">
                  {new Date(log.created_at!).toLocaleDateString()}
                </span>
                <p className="text-platinum">
                  <span className="font-bold text-lion">
                    {log.admin?.username || 'Sistema'}
                  </span>
                  {` ${getActionLabel(log.action_type)} `}
                </p>
              </div>
            ))
          ) : (
            <p className="text-center py-8 text-xs text-blue-light italic">
              Sin registro de acciones previas.
            </p>
          )}
        </div>
      </div>

      {/* NOTAS DE INTELIGENCIA */}
      <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl">
        <div className="p-6 border-b border-white/5 bg-white/5">
          <h3 className="font-bold text-platinum flex items-center gap-2 text-sm uppercase tracking-wider">
            <MessageSquare size={18} className="text-lion" /> Notas de
            Inteligencia
          </h3>
        </div>
        <div className="p-6 space-y-4 max-h-100 overflow-y-auto">
          {notes.length > 0 ? (
            notes.map((note: AdminNote) => (
              <div
                key={note.id}
                className="bg-night/30 p-4 rounded-2xl border-l-4 border-lion/40"
              >
                <p className="text-sm text-platinum leading-relaxed">
                  {note.content}
                </p>
                <div className="mt-3 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-lion uppercase">
                    Admin: {note.admin?.username || 'Staff'}
                  </span>
                  <span className="text-[9px] text-blue-light">
                    {note.created_at
                      ? new Date(note.created_at).toLocaleDateString()
                      : ''}
                  </span>
                </div>
              </div>
            ))
          ) : (
            /* FALLBACK PARA EMPTY STATE (Lo que pediste) */
            <div className="py-12 flex flex-col items-center text-center">
              <AlertCircle size={32} className="text-blue-light/20 mb-2" />
              <p className="text-sm text-blue-light italic">
                No hay notas internas sobre este usuario.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

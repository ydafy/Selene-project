import React, { useState } from 'react';
import { Mail, ChevronRight, Copy, Check, Fingerprint } from 'lucide-react';
import { UserAvatar } from '../../ui/UserAvatar';
import { getRank } from '../../../lib/utils/ranks';
import type { AdminUser } from '@selene/types';

export const UserCard = ({
  user,
  onClick,
}: {
  user: AdminUser;
  onClick: () => void;
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // 1. LÓGICA DE DATOS (Aplanados desde la Vista SQL)
  const soldCount = user.sold_count || 0;
  const verifiedCount = user.verified_count || 0;
  const processedCount = user.processed_count || 0;
  const availableBalance = user.available_balance || 0;

  const ratio =
    processedCount > 0 ? Math.round((verifiedCount / processedCount) * 100) : 0;

  const rank = getRank(soldCount, ratio);

  // 2. LÓGICA DE ROLES Y TIEMPO
  const isAdmin = user.role === 'admin';
  const isNew =
    new Date().getTime() - new Date(user.created_at ?? new Date().toISOString()).getTime() <
    72 * 60 * 60 * 1000;

  const handleCopy = (e: React.MouseEvent, text: string, field: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col items-center rounded-3xl p-6 transition-all duration-300 cursor-pointer border-2 ${
        isAdmin
          ? 'bg-lion/5 border-lion shadow-[0_0_30px_rgba(189,159,101,0.2)]' // Diseño VIP: Fondo tintado y borde oro
          : 'bg-state-gray border-white/5 hover:border-white/20' // Diseño Normal
      }`}
    >
      {/* BADGE DE STAFF (Esquina superior izquierda) */}
      {isAdmin && (
        <div className="absolute top-0 left-0 bg-lion px-4 py-1.5 rounded-br-2xl rounded-tl-3xl shadow-lg z-10 flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-night rounded-full animate-pulse" />
          <span className="text-[10px] font-black text-night uppercase tracking-tighter">
            Selene Staff
          </span>
        </div>
      )}

      {/* BADGE DE NUEVO (Solo si no es admin) */}
      {!isAdmin && isNew && (
        <div className="absolute top-4 left-4 flex items-center gap-1 bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30 z-10">
          <span className="text-[8px] font-bold uppercase animate-pulse">
            Nuevo
          </span>
        </div>
      )}

      {/* STATUS FLOATING (Esquina superior derecha) */}
      <div className="absolute top-4 right-4 z-10">
        <span
          className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
            user.status === 'active'
              ? 'bg-forest/10 text-forest border-forest/20'
              : 'bg-fire/10 text-fire border-fire/20'
          }`}
        >
          {user.status}
        </span>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex flex-col items-center w-full">
        <div className="relative mb-4">
          <UserAvatar
            path={user.avatar_url ?? undefined}
            fallback={user.username || 'U'}
            size="md"
          />
          {user.is_verified_seller && (
            <div className="absolute -bottom-1 -right-1 bg-night rounded-full p-0.5 shadow-lg">
              <div className="bg-lion text-night rounded-full p-0.5">
                <Check size={10} strokeWidth={4} />
              </div>
            </div>
          )}
        </div>

        <h4 className="text-xl font-bold text-platinum tracking-tight text-center">
          @{user.username || 'sin_nombre'}
        </h4>

        <span
          className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase mt-2 border ${rank.color}`}
        >
          {rank.icon} {rank.label}
        </span>

        {/* SECCIÓN DE COPIADOS (Productividad) */}
        <div className="w-full mt-6 space-y-2">
          <button
            onClick={(e) => handleCopy(e, user.email ?? '', 'email')}
            className="w-full flex items-center justify-between p-3 bg-night/40 rounded-xl border border-white/5 hover:border-white/20 transition-all group/btn"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Mail size={14} className="text-blue-light shrink-0" />
              <span className="text-[11px] text-blue-light truncate">
                {user.email || 'N/A'}
              </span>
            </div>
            {copiedField === 'email' ? (
              <Check size={14} className="text-forest" />
            ) : (
              <Copy
                size={12}
                className="text-white/10 group-hover/btn:text-lion"
              />
            )}
          </button>

          <button
            onClick={(e) => handleCopy(e, user.id ?? '', 'id')}
            className="w-full flex items-center justify-between p-3 bg-night/40 rounded-xl border border-white/5 hover:border-white/20 transition-all group/btn"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Fingerprint size={14} className="text-blue-light shrink-0" />
              <span className="text-[10px] text-blue-light/50 font-mono truncate">
                {user.id}
              </span>
            </div>
            {copiedField === 'id' ? (
              <Check size={14} className="text-forest" />
            ) : (
              <Copy
                size={12}
                className="text-white/10 group-hover/btn:text-lion"
              />
            )}
          </button>
        </div>

        {/* FOOTER: FINANZAS */}
        <div className="w-full mt-6 pt-4 border-t border-white/5 flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-[9px] text-blue-light font-bold uppercase tracking-tighter">
              Saldo Disp.
            </span>
            <span
              className={`text-lg font-bold ${availableBalance > 0 ? 'text-forest' : 'text-platinum/40'}`}
            >
              ${availableBalance.toLocaleString()}
            </span>
          </div>
          <div className="h-10 w-10 rounded-2xl bg-lion/10 flex items-center justify-center text-lion group-hover:bg-lion group-hover:text-night transition-all">
            <ChevronRight size={20} />
          </div>
        </div>
      </div>
    </div>
  );
};

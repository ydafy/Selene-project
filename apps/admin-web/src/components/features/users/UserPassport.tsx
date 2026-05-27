import React, { useState } from 'react';
import { Mail, ChevronRight, Copy, Check, Hash } from 'lucide-react';
import { UserAvatar } from '../../ui/UserAvatar';
import { getRank } from '../../../lib/utils/ranks';

export const UserPassport = ({
  user,
  onClick,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
  onClick: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const stats = user.stats?.[0] || {
    sold_count: 0,
    processed_count: 0,
    verified_count: 0,
  };
  const ratio =
    stats.processed_count > 0
      ? Math.round((stats.verified_count / stats.processed_count) * 100)
      : 0;
  const rank = getRank(stats.sold_count, ratio);

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={onClick}
      className="group flex bg-state-gray border-l-4 border-l-lion border-y border-r border-white/10 rounded-r-2xl overflow-hidden hover:bg-white/[0.02] transition-all cursor-pointer"
    >
      {/* LADO IZQUIERDO: FOTO Y RANGO */}
      <div className="w-32 bg-night/50 p-4 flex flex-col items-center justify-center border-r border-white/5 gap-3">
        <UserAvatar
          path={user.avatar_url}
          fallback={user.username || 'U'}
          size="md"
        />
        <span
          className={`text-[8px] px-2 py-0.5 rounded font-black uppercase border ${rank.color}`}
        >
          {rank.label}
        </span>
      </div>

      {/* LADO DERECHO: INFO TÉCNICA */}
      <div className="flex-1 p-4 flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-start">
            <h4 className="font-bold text-platinum text-lg">
              @{user.username || 'user'}
            </h4>
            <span
              className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                user.status === 'active'
                  ? 'text-forest bg-forest/10'
                  : 'text-fire bg-fire/10'
              }`}
            >
              {user.status}
            </span>
          </div>
          <p className="text-[10px] text-blue-light flex items-center gap-1 mt-1">
            <Mail size={10} /> {user.email || 'N/A'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="bg-night/30 p-2 rounded-lg border border-white/5">
            <p className="text-[8px] text-blue-light uppercase font-bold">
              Ventas
            </p>
            <p className="text-xs font-bold text-platinum">
              {stats.sold_count}
            </p>
          </div>
          <div className="bg-night/30 p-2 rounded-lg border border-white/5">
            <p className="text-[8px] text-blue-light uppercase font-bold">
              Efectividad
            </p>
            <p className="text-xs font-bold text-lion">{ratio}%</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={handleCopyId}
            className="text-[9px] font-mono text-blue-light/40 hover:text-lion transition-colors flex items-center gap-1"
          >
            <Hash size={10} /> {user.id.slice(0, 13)}...{' '}
            {copied ? (
              <Check size={10} className="text-forest" />
            ) : (
              <Copy size={10} />
            )}
          </button>
          <ChevronRight
            size={16}
            className="text-white/10 group-hover:text-lion group-hover:translate-x-1 transition-all"
          />
        </div>
      </div>
    </div>
  );
};

import { useState } from 'react';
import { Lock, AlertCircle, ShieldAlert, Cpu } from 'lucide-react';
import { UserAvatar } from '../../ui/UserAvatar';
import { UserSafetyActions } from './UserSafetyActions';
import { RankInfoPanel } from './RankInfoPanel';
import { ProductSpecsGrid } from './ProductSpecsGrid';
import { EvidenceViewer } from './EvidenceViewer';
import { VerificationActions } from './VerificationActions';
import { getRank } from '../../../lib/utils/ranks';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from 'sonner';
import type { PendingProduct, AccountStatus } from '@selene/types';
import { formatTime } from '../../../lib/utils/formatDate';

interface LockStatus {
  isLockedByOther: boolean;
  lockerName: string | null;
  lockedSince: string | null;
}

export interface ResolveProductVariables {
  id: string;
  verdict: 'APPROVE' | 'REJECT' | 'APPROVE_NOTE';
  note?: string;
  product: PendingProduct;
}

interface VerificationDetailProps {
  product: PendingProduct;
  lockStatus: LockStatus;
  isLocking: boolean;
  resolve: {
    mutate: (
      vars: ResolveProductVariables,
      options?: { onSuccess?: () => void; onError?: (error: Error) => void },
    ) => void;
    isPending: boolean;
  };
  refetch: () => void;
  onImageClick: (url: string) => void;
  onVerdictComplete: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const VerificationDetail = ({
  product,
  lockStatus,
  isLocking,
  resolve,
  refetch,
  onImageClick,
  onVerdictComplete,
}: VerificationDetailProps) => {
  const [showRankInfo, setShowRankInfo] = useState(false);
  const [internalNote, setInternalNote] = useState('');
  const { user } = useAuthStore();

  const vData = isRecord(product.verification_data)
    ? product.verification_data
    : null;

  const rank = getRank(product.seller_stats.sold, product.seller_stats.ratio);

  const saveInternalNote = async () => {
    if (!internalNote.trim()) return;

    const { error } = await supabase.from('admin_user_notes').insert({
      user_id: product.seller_id,
      admin_id: user?.id,
      content: internalNote,
    });

    if (!error) {
      toast.success('Nota interna guardada');
      setInternalNote('');
      refetch();
    }
  };

  return (
    <div className="bg-state-gray rounded-2xl border border-white/5 overflow-hidden sticky top-0">
      {/* CABECERA DEL DETALLE */}
      <div className="p-6 border-b border-white/5 bg-state-gray">
        <h3 className="text-xl font-bold text-platinum">
          Detalles de Verificación
        </h3>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-bold text-blue-light uppercase tracking-widest">
            ID Producto:
          </span>
          <code className="text-[10px] text-lion bg-lion/5 px-2 py-0.5 rounded border border-lion/10 font-mono">
            {product.id}
          </code>
        </div>
      </div>

      {/* A. BANNER DE BLOQUEO */}
      {lockStatus.isLockedByOther && (
        <div className="bg-fire/20 border-b border-fire/30 p-3 flex items-center gap-3 animate-in slide-in-from-top duration-300">
          <Lock size={18} className="text-fire" />
          <p className="text-xs font-bold text-fire">
            VISTA DE SOLO LECTURA: Este producto está siendo revisado por{' '}
            {lockStatus.lockerName}.
          </p>
        </div>
      )}

      {/* B. CONTEXTO DE RE-INTENTO */}
      {product.rejection_reason && (
        <div className="m-6 mb-0 bg-fire/5 border border-fire/20 rounded-xl p-4 flex gap-3">
          <AlertCircle size={20} className="text-fire shrink-0" />
          <div>
            <h5 className="text-xs font-bold text-fire uppercase tracking-widest">
              Motivo de rechazo anterior:
            </h5>
            <p className="text-sm text-platinum mt-1 italic">
              "{product.rejection_reason}"
            </p>
            <p className="text-[10px] text-blue-light mt-2 font-medium">
              Verifica si el usuario corrigió este punto antes de aprobar.
            </p>
          </div>
        </div>
      )}

      {/* SELLER PASSPORT */}
      <div className="p-6 bg-night/30 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <UserAvatar
            path={product.seller?.avatar_url ?? undefined}
            fallback={product.seller?.username || 'U'}
            size="md"
          />

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h4 className="text-lg font-bold text-platinum tracking-tight">
                {product.seller?.username || 'Usuario de Google'}
              </h4>

              {/* BOTÓN DE RANGO CON POPOVER */}
              <div className="relative">
                <button
                  className="flex items-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowRankInfo(!showRankInfo);
                  }}
                >
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider cursor-help transition-all hover:brightness-110 active:scale-95 ${rank.color}`}
                  >
                    {rank.icon} {rank.label}
                  </span>
                </button>

                {showRankInfo && (
                  <div className="absolute top-full left-0 mt-3 z-50">
                    <div
                      className="fixed inset-0"
                      onClick={() => setShowRankInfo(false)}
                    />
                    <div className="relative">
                      <RankInfoPanel />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-light/50 uppercase tracking-widest">
                ID Vendedor:
              </span>
              <code className="text-[10px] text-blue-light/70 font-mono italic">
                {product.seller_id}
              </code>
            </div>
          </div>
        </div>

        {/* ACCIONES DE SEGURIDAD */}
        <div className="flex items-center bg-night/40 p-1.5 rounded-2xl border border-white/5 shadow-inner">
          <UserSafetyActions
            user={{
              id: product.seller_id,
              status:
                (product.seller as { status?: AccountStatus })?.status ||
                'active',
              is_verified_seller: product.seller?.is_verified_seller ?? null,
            }}
            onUpdate={refetch}
          />
        </div>

        {/* MÉTRICAS DE CONFIANZA */}
        <div className="flex gap-6">
          <div className="text-center">
            <p className="text-[10px] text-blue-light uppercase font-bold mb-1">
              Verificados
            </p>
            <p className="text-lg font-bold text-forest">
              {product.seller_stats.verified}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-blue-light uppercase font-bold mb-1">
              Rechazados
            </p>
            <p className="text-lg font-bold text-fire">
              {product.seller_stats.rejected}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-blue-light uppercase font-bold mb-1">
              Vendidos
            </p>
            <p className="text-lg font-bold text-platinum">
              {product.seller_stats.sold}
            </p>
          </div>
          <div className="text-center border-l border-white/10 pl-6">
            <p className="text-[10px] text-lion uppercase font-bold mb-1">
              Efectividad
            </p>
            <p className="text-lg font-bold text-lion">
              {product.seller_stats.ratio}%
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* EVIDENCE VIEWER */}
        <EvidenceViewer
          verificationData={vData}
          images={product.images || []}
          onImageClick={onImageClick}
        />

        {/* DESCRIPCIÓN Y FICHA TÉCNICA */}
        <div className="bg-night/50 p-4 rounded-xl border border-white/5">
          <h5 className="text-sm font-bold text-platinum mb-2 uppercase tracking-tighter">
            Descripción del Vendedor
          </h5>
          <p className="text-sm text-blue-light leading-relaxed">
            {product.description || 'Sin descripción proporcionada.'}
          </p>
        </div>

        <div className="space-y-3">
          <h5 className="text-sm font-bold text-platinum uppercase tracking-tighter flex items-center gap-2">
            <Cpu size={16} className="text-lion" /> Ficha Técnica
          </h5>
          <ProductSpecsGrid
            specs={
              (isRecord(product.specifications)
                ? product.specifications
                : {}) as Record<string, unknown>
            }
          />
        </div>

        {/* INTELIGENCIA DE VENDEDOR (NOTAS PRIVADAS) */}
        <div className="bg-fire/5 border border-fire/20 rounded-xl p-4 space-y-3">
          <h5 className="text-xs font-bold text-fire uppercase tracking-widest flex items-center gap-2">
            <ShieldAlert size={14} /> Inteligencia de Vendedor (Privado)
          </h5>
          <textarea
            value={internalNote}
            disabled={lockStatus.isLockedByOther || isLocking}
            onChange={(e) => setInternalNote(e.target.value)}
            placeholder={
              lockStatus.isLockedByOther
                ? 'Modo solo lectura: no puedes agregar notas en este momento.'
                : 'Escribe una nota interna sobre este vendedor...'
            }
            className="w-full bg-night/40 border border-fire/10 rounded-lg p-3 text-xs text-platinum outline-none focus:border-fire/30 disabled:opacity-50 disabled:cursor-not-allowed"
            rows={2}
          />
          <button
            onClick={saveInternalNote}
            disabled={
              lockStatus.isLockedByOther || isLocking || !internalNote.trim()
            }
            className="text-[10px] bg-fire/20 text-fire px-3 py-1 rounded-md hover:bg-fire/30 transition-all font-bold uppercase outline-none focus:ring-2 focus:ring-lion/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Guardar Nota Privada
          </button>

          {/* HISTORIAL DE NOTAS INTERNAS */}
          {product.internal_notes && product.internal_notes.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-fire/10 pt-3">
              <p className="text-[10px] font-bold text-fire/60 uppercase tracking-widest">
                Historial de notas:
              </p>
              {product.internal_notes.map((note, idx) => (
                <div
                  key={idx}
                  className="bg-night/30 p-2 rounded-lg border border-white/5"
                >
                  <p className="text-[11px] text-platinum leading-tight">
                    {note.content}
                  </p>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-blue-light">
                      Por: {note.admin?.username || 'Admin'}
                    </span>
                    <span className="text-[9px] text-blue-light">
                      {formatTime(note.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* VERIFICATION ACTIONS */}
        <VerificationActions
          product={product}
          lockStatus={lockStatus}
          isLocking={isLocking}
          resolve={resolve}
          onVerdictComplete={onVerdictComplete}
        />
      </div>
    </div>
  );
};

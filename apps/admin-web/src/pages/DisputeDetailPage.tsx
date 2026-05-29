import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Package,
  Video,
  Scale,
  Lock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// Hooks
import { useDisputeDetail } from '../hooks/useDisputeDetail';

import { useDisputeActions, useDisputeLock } from '../hooks/useDisputeActions';
// UI Components
import { StatusBadge } from '../components/ui/StatusBadge';
import { SecureImage } from '../components/ui/SecureImage';
import { SecureVideo } from '../components/ui/SecureVideo';
import { ErrorState } from '../components/ui/ErrorState';
import { ImageModal } from '../components/ui/ImageModal';
import { InputModal } from '../components/ui/InputModal';
import { Skeleton } from '../components/ui/Skeleton';

export const DisputeDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [activeImage, setActiveImage] = useState<string | null>(null);
  const { resolveDispute, isLoading: isResolving } = useDisputeActions(id!);
  const [showResolveModal, setShowResolveModal] = useState(false);

  const [verdictTarget, setVerdictTarget] = useState<'seller' | 'buyer' | null>(
    null,
  );

  // 1. Hooks de Datos y Seguridad
  const { data: dispute, isLoading, isError, refetch } = useDisputeDetail(id!);
  const { acquireLock, releaseLock, lockStatus } = useDisputeLock();

  const handleConfirmSellerVerdict = async (note: string) => {
    try {
      await resolveDispute({
        verdict: 'seller',
        adminNote: note,
      });
      setShowResolveModal(false);
      navigate('/disputes'); // Opcional: volver a la lista tras cerrar el caso
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // El error ya lo maneja el toast del hook
    }
  };

  const handleConfirmBuyerVerdict = async (note: string) => {
    try {
      await resolveDispute({
        verdict: 'buyer',
        adminNote: note,
        // YA NO ENVIAMOS tracking ni url desde aquí
      });
      setShowResolveModal(false); // Usamos el mismo modal de "Sentencia"
    } catch (error) {
      // Error manejado por el hook
    }
  };

  // 2. Gestión de Bloqueo (Soft Lock)
  useEffect(() => {
    if (id) {
      acquireLock(id);
    }
    return () => {
      if (id) {
        releaseLock(id);
      }
    };
  }, [id, acquireLock, releaseLock]); // Fix IA Local: Dependencias completas

  // 3. Estados de Carga y Error
  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Back button skeleton */}
        <Skeleton className="w-48 h-5" />

        {/* Evidence panels skeleton */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="bg-state-gray p-6 rounded-3xl border border-white/5">
            <Skeleton className="w-32 h-5 mb-6" />
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton
                  key={i}
                  variant="rectangular"
                  className="aspect-square rounded-2xl"
                />
              ))}
            </div>
          </div>

          <div className="bg-state-gray p-6 rounded-3xl border border-white/5">
            <Skeleton className="w-32 h-5 mb-6" />
            <Skeleton
              variant="rectangular"
              className="aspect-video rounded-2xl mb-6"
            />
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  variant="rectangular"
                  className="aspect-square rounded-xl"
                />
              ))}
            </div>
          </div>
        </div>

        {/* Description panel skeleton */}
        <div className="bg-state-gray p-8 rounded-3xl border border-white/5">
          <Skeleton className="w-40 h-4 mb-4" />
          <Skeleton className="h-6 w-full mb-2" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      </div>
    );
  }

  if (isError || !dispute) return <ErrorState onRetry={() => refetch()} />;

  // 4. Extracción Segura de Evidencias
  const order = dispute?.order || {};
  const buyer = dispute?.buyer || {}; // <--- Ahora vienen de aquí
  const seller = dispute?.seller || {}; // <--- Ahora vienen de aquí

  const buyerEvidence = dispute?.buyer_evidence || {};
  const sellerEvidence = order?.shipping_evidence || {};

  return (
    <div className="space-y-6 pb-32">
      {/* HEADER: Navegación e Identificadores */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <button
          onClick={() => navigate('/disputes')}
          className="flex items-center gap-2 text-blue-light hover:text-platinum transition-colors group outline-none focus:ring-2 focus:ring-lion/50 rounded cursor-pointer"
        >
          <ArrowLeft
            size={18}
            className="group-hover:-translate-x-1 transition-transform"
          />
          Volver a la bandeja de disputas
        </button>

        <div className="flex items-center gap-3 bg-state-gray p-2 rounded-2xl border border-white/5">
          <StatusBadge status={dispute.status} />
          <div className="h-4 w-[1px] bg-white/10" />
          <code className="text-[10px] text-blue-light/60 font-mono uppercase tracking-tighter">
            ID: {dispute.id}
          </code>
        </div>
      </div>
      {/* BANNER DE BLOQUEO (Soft Lock) */}
      {lockStatus.isLockedByOther && (
        <div className="bg-fire/10 border border-fire/20 p-4 rounded-2xl flex items-center gap-4 animate-in slide-in-from-top duration-300">
          <div className="bg-fire/20 p-2 rounded-lg">
            <Lock className="text-fire" size={20} />
          </div>
          <div>
            <p className="text-sm font-bold text-fire uppercase tracking-tight">
              Acceso Restringido
            </p>
            <p className="text-xs text-platinum/70">
              Este caso está siendo auditado por{' '}
              <span className="text-fire font-bold">
                {lockStatus.lockerName}
              </span>
              . Tus acciones están deshabilitadas para evitar colisiones.
            </p>
          </div>
        </div>
      )}
      {/* BLOQUE DE SENTENCIA (Solo si está resuelto) */}
      {dispute.status === 'resolved' && (
        <div className="bg-lion/10 border border-lion/20 rounded-3xl p-6 flex gap-5 items-start animate-in fade-in zoom-in-95 duration-500">
          <div className="bg-lion/20 p-3 rounded-2xl">
            <Scale size={24} className="text-lion" />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-start">
              <h4 className="text-xs font-black text-lion uppercase tracking-[0.2em]">
                Sentencia de Mediación
              </h4>
              <span className="text-[10px] text-blue-light font-mono uppercase">
                Caso Cerrado
              </span>
            </div>
            <p className="text-lg text-platinum mt-2 italic leading-relaxed font-medium">
              "{dispute.admin_notes}"
            </p>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-forest" />
                <span className="text-[10px] text-platinum font-bold uppercase">
                  Veredicto:{' '}
                  {dispute.resolution_type === 'seller'
                    ? 'Vendedor Gana'
                    : 'Comprador Gana'}
                </span>
              </div>

              <span className="text-[10px] font-bold text-lion uppercase">
                Sentenciado por: @{dispute.resolved_admin?.username || 'Staff'}
              </span>
              <span className="text-[10px] text-blue-light/50">
                Resolución emitida el{' '}
                {new Date(dispute.updated_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}
      {/* CUERPO DEL JUICIO: SPLIT VIEW */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        {/* LADO IZQUIERDO: VENDEDOR (SÓLO FOTOS) */}
        <div className="space-y-4">
          <div className="bg-state-gray p-6 rounded-3xl border border-white/5 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-platinum flex items-center gap-2">
                <Package size={20} className="text-lion" />
                Evidencia de
                <button
                  onClick={() => navigate(`/users/${seller.id}`)}
                  className="text-lion hover:underline decoration-lion/30 underline-offset-4 transition-all"
                >
                  @{seller.username}
                </button>
              </h3>
              <span className="text-[10px] font-bold text-blue-light bg-white/5 px-2 py-1 rounded uppercase tracking-widest">
                Caja Negra
              </span>
            </div>

            {/* Grid de Fotos del Vendedor */}
            <div className="grid grid-cols-2 gap-4">
              {(sellerEvidence?.images || []).map((path: string, i: number) => (
                <div
                  key={i}
                  className="aspect-square bg-night rounded-2xl overflow-hidden border border-white/5 group relative"
                >
                  <SecureImage
                    path={path}
                    alt={`Vendedor ${i}`}
                    bucket="evidence"
                    className="w-full h-full object-cover"
                    onClick={(url) => setActiveImage(url)}
                  />
                </div>
              ))}
            </div>

            <p className="text-[11px] text-blue-light/60 mt-6 leading-relaxed italic border-t border-white/5 pt-4">
              * Fotos capturadas por el vendedor antes del envío para certificar
              el estado de los pines y el empaque.
            </p>
          </div>
        </div>

        {/* LADO DERECHO: COMPRADOR (VIDEO + FOTOS) */}
        <div className="space-y-4">
          <div className="bg-state-gray p-6 rounded-3xl border border-white/5 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-platinum flex items-center gap-2">
                <Video size={20} className="text-fire" />
                Evidencia de
                <button
                  onClick={() => navigate(`/users/${buyer.id}`)}
                  className="text-fire hover:underline decoration-fire/30 underline-offset-4 transition-all"
                >
                  @{buyer.username}
                </button>
              </h3>
              <span className="text-[10px] font-bold text-fire bg-fire/10 px-2 py-1 rounded uppercase tracking-widest">
                Unboxing
              </span>
            </div>

            {/* VIDEO: La prueba reina */}
            {buyerEvidence?.video_url ? (
              <div className="aspect-video bg-night rounded-2xl overflow-hidden border border-white/10 mb-6 shadow-2xl">
                <SecureVideo
                  path={buyerEvidence.video_url}
                  bucket="evidence"
                  className="w-full h-full"
                />
              </div>
            ) : (
              <div className="aspect-video bg-night/50 rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center text-blue-light mb-6">
                <Video size={40} className="opacity-10 mb-2" />
                <p className="text-xs italic opacity-50">
                  No se proporcionó video de unboxing.
                </p>
              </div>
            )}

            {/* FOTOS ADICIONALES DEL COMPRADOR (Si las hay) */}
            <div className="grid grid-cols-3 gap-3">
              {(buyerEvidence?.images || []).map((path: string, i: number) => (
                <div
                  key={i}
                  className="aspect-square bg-night rounded-xl overflow-hidden border border-white/5"
                >
                  <SecureImage
                    path={path}
                    alt={`Comprador ${i}`}
                    bucket="evidence"
                    className="w-full h-full object-cover"
                    onClick={(url) => setActiveImage(url)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* PANEL DE DESCRIPCIÓN Y TRIAGE */}
      <div className="bg-state-gray p-8 rounded-3xl border border-white/5 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <Scale size={18} className="text-blue-light" />
          <h4 className="text-sm font-bold text-blue-light uppercase tracking-widest">
            Declaración del Comprador
          </h4>
        </div>
        <p className="text-lg text-platinum leading-relaxed italic font-medium">
          "{dispute.description || 'Sin descripción detallada.'}"
        </p>

        {/* Aquí podríamos mapear el Triage Técnico en el futuro */}
        {buyerEvidence?.tech_checklist && (
          <div className="mt-6 pt-6 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(buyerEvidence.tech_checklist).map(
              ([key, value]) => (
                <div
                  key={key}
                  className="bg-night/30 p-3 rounded-xl border border-white/5"
                >
                  <p className="text-[9px] text-blue-light uppercase font-bold mb-1">
                    {key.replace(/_/g, ' ')}
                  </p>
                  <p
                    className={`text-xs font-bold ${value ? 'text-forest' : 'text-fire'}`}
                  >
                    {value ? 'SÍ / CORRECTO' : 'NO / FALLÓ'}
                  </p>
                </div>
              ),
            )}
          </div>
        )}
      </div>
      {/* BARRA DE ACCIONES FIJA (EL MARTILLO DEL JUEZ) */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-night/80 backdrop-blur-xl border-t border-white/10 p-6 flex justify-center gap-6 z-40 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        {/* BOTÓN: VALIDAR COMPRADOR */}
        <button
          disabled={
            lockStatus.isLockedByOther ||
            isResolving ||
            !['open', 'under_review'].includes(dispute.status) // <--- FIX: Permitir en ambos estados
          }
          onClick={() => {
            setVerdictTarget('buyer');
            setShowResolveModal(true);
          }}
          className="px-8 py-3 rounded-xl bg-fire/10 text-fire font-bold hover:bg-fire/20 transition-all border border-fire/20 disabled:opacity-30 flex items-center gap-2 outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
        >
          <XCircle size={18} /> Validar Comprador
        </button>

        {/* BOTÓN: VALIDAR VENDEDOR */}
        <button
          disabled={
            lockStatus.isLockedByOther ||
            isResolving ||
            !['open', 'under_review'].includes(dispute.status) // <--- FIX: Permitir en ambos estados
          }
          onClick={() => {
            setVerdictTarget('seller');
            setShowResolveModal(true);
          }}
          className="px-8 py-3 rounded-xl bg-forest text-night font-bold hover:bg-forest/90 transition-all shadow-lg shadow-forest/20 disabled:opacity-30 flex items-center gap-2 outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
        >
          <CheckCircle2 size={18} /> Validar Vendedor
        </button>
      </div>

      {/* VISOR DE IMÁGENES (Lightbox) */}
      <ImageModal url={activeImage} onClose={() => setActiveImage(null)} />

      {/* UNICO MODAL DINÁMICO */}
      <InputModal
        isOpen={showResolveModal}
        onClose={() => {
          setShowResolveModal(false);
          setVerdictTarget(null);
        }}
        onConfirm={
          verdictTarget === 'seller'
            ? handleConfirmSellerVerdict
            : handleConfirmBuyerVerdict
        }
        isLoading={isResolving}
        title={
          verdictTarget === 'seller'
            ? 'Veredicto: Vendedor Gana'
            : 'Veredicto: Comprador Gana (Devolución)'
        }
        description={
          verdictTarget === 'seller'
            ? 'Los fondos se liberarán al vendedor inmediatamente y el caso se cerrará.'
            : 'Se notificará al vendedor que debe pagar la guía de retorno para recuperar su producto.'
        }
        placeholder="Escribe la justificación técnica del veredicto..."
        confirmLabel={
          verdictTarget === 'seller'
            ? 'Emitir Sentencia y Pagar'
            : 'Emitir Sentencia y Notificar'
        }
      />
    </div>
  );
};

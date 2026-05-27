import { useEffect, useMemo, useState } from 'react';
import { usePendingProducts } from '../hooks/usePendingProducts';
import {
  CheckCircle,
  XCircle,
  Eye,
  Clock,
  TrendingUp,
  ShieldCheck,
  Cpu,
  Search,
  Maximize2,
  ShieldAlert,
  ImageIcon,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';

import { UserAvatar } from '../components/ui/UserAvatar';
import { ProductSpecsGrid } from '../components/features/verify/ProductSpecsGrid';
import { SecureImage } from '../components/ui/SecureImage';
import { ImageModal } from '../components/ui/ImageModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorState } from '../components/ui/ErrorState';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../lib/supabase';
import { getRank } from '../lib/utils/ranks';
import { UserSafetyActions } from '../components/features/verify/UserSafetyActions';
import { RankInfoPanel } from '../components/features/verify/RankInfoPanel';
import { useProductLock } from '../hooks/useProductLock';

const getTimeInQueue = (date: string) => {
  const diff = Math.floor(
    (new Date().getTime() - new Date(date).getTime()) / 60000,
  );
  if (diff < 60) return `${diff}m`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return `${Math.floor(diff / 1440)}d`;
};

export const VerificationPage = () => {
  //Estados
  const { products, isLoading, isError, refetch, resolve } =
    usePendingProducts();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [confirmData, setConfirmData] = useState<{
    show: boolean;
    verdict?: 'APPROVE' | 'REJECT' | 'APPROVE_NOTE';
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | 'ALL'>('ALL');
  const [internalNote, setInternalNote] = useState('');
  const [showRankInfo, setShowRankInfo] = useState(false);
  const { acquireLock, releaseLock, lockStatus, isLocking } = useProductLock();
  const selectedProduct = useMemo(() => {
    return products?.find((p: any) => p.id === selectedId) || null;
  }, [products, selectedId]);

  useEffect(() => {
    return () => {
      if (selectedProduct) {
        releaseLock(selectedProduct.id);
      }
    };
  }, [selectedProduct, releaseLock]);

  // Función para manejar la selección de producto con bloqueo
  const handleSelectProduct = async (product: any) => {
    if (selectedId === product.id) return;

    if (selectedId) {
      await releaseLock(selectedId);
    }

    const success = await acquireLock(product.id);
    if (success) {
      setSelectedId(product.id); // Guardamos solo el ID
      setAdminNote('');
    }
  };

  const saveInternalNote = async () => {
    if (!internalNote.trim()) return;
    const { user } = useAuthStore.getState();

    const { error } = await supabase.from('admin_user_notes').insert({
      user_id: selectedProduct.seller_id,
      admin_id: user?.id,
      content: internalNote,
    });

    if (!error) {
      toast.success('Nota interna guardada');
      setInternalNote('');
      refetch();
    }
  };

  // 2. Lógica de filtrado (MVP++)
  const filteredProducts = useMemo(() => {
    if (!products) return [];

    return products.filter((product: any) => {
      const matchesSearch =
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.seller?.username
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase());

      const matchesCategory =
        activeCategory === 'ALL' || product.category === activeCategory;

      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, activeCategory]);

  if (isError) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-lion/20 border-t-lion animate-spin rounded-full" />
          <p className="text-blue-light font-medium animate-pulse">
            Sincronizando con Selene DB...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        HEADER: Resumen de la cola de trabajo y estado de sincronización
      */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Verificación de Hardware</h2>
          <p className="text-blue-light">
            Revisa la legitimidad de los productos antes de publicarlos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-forest/10 text-forest px-3 py-1 rounded-full text-[10px] font-bold border border-forest/20 animate-pulse">
            <div className="w-1.5 h-1.5 bg-forest rounded-full" />
            Sincronizado
          </div>
          <div className="bg-lion/10 text-lion px-4 py-2 rounded-full text-sm font-bold border border-lion/20">
            {products?.length || 0} En Revisión
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/*
          COLUMNA IZQUIERDA: Navegación y Filtrado
        */}
        <div className="xl:col-span-1 space-y-4 flex flex-col max-h-[calc(100vh-200px)]">
          {/* BUSCADOR Y FILTROS */}
          <div className="space-y-3 pr-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-light"
                size={18}
              />
              <input
                type="text"
                placeholder="Buscar producto o vendedor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-state-gray border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-sm text-platinum focus:border-lion/50 outline-none transition-all"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {['ALL', 'GPU', 'CPU', 'RAM', 'Motherboard'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${
                    activeCategory === cat
                      ? 'bg-lion text-night border-lion'
                      : 'bg-white/5 text-blue-light border-transparent hover:bg-white/10'
                  }`}
                >
                  {cat === 'ALL' ? 'Todos' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* LISTA DE PRODUCTOS FILTRADA */}
          <div className="flex-1 space-y-4 overflow-y-auto pr-2">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                disabled={isLocking}
                onClick={() => handleSelectProduct(product)}
                className={`w-full text-left p-4 rounded-2xl border transition-all ${
                  selectedProduct?.id === product.id
                    ? 'bg-lion/10 border-lion shadow-[0_0_15px_rgba(189,159,101,0.1)]'
                    : 'bg-state-gray border-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-light bg-night px-2 py-1 rounded">
                    {product.category}
                  </span>
                  <span className="text-lion font-bold">
                    ${product.price.toLocaleString()}
                  </span>
                </div>
                <h4 className="font-semibold truncate text-platinum">
                  {product.name}
                </h4>
                <div className="flex items-center gap-2 mt-3 text-xs text-blue-light">
                  <UserAvatar
                    path={product.seller?.avatar_url}
                    fallback={product.seller?.username || 'U'}
                  />
                  <span className="truncate max-w-[120px] font-medium text-platinum">
                    {product.seller?.username ||
                      `User_${product.seller_id.slice(0, 5)}`}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-blue-light bg-white/5 px-2 py-1 rounded-full border border-white/5">
                    <Clock size={10} /> {getTimeInQueue(product.created_at)}
                  </span>
                </div>
              </button>
            ))}

            {/* ESTADOS VACÍOS */}
            {products &&
              products.length > 0 &&
              filteredProducts.length === 0 && (
                <div className="text-center py-12 bg-state-gray/50 rounded-2xl border border-dashed border-white/10">
                  <p className="text-sm text-blue-light">
                    No se encontraron resultados.
                  </p>
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setActiveCategory('ALL');
                    }}
                    className="mt-2 text-xs text-lion hover:underline"
                  >
                    Limpiar filtros
                  </button>
                </div>
              )}

            {products?.length === 0 && (
              <div className="text-center py-12 bg-state-gray rounded-2xl border border-dashed border-white/10">
                <p className="text-blue-light">
                  No hay productos por verificar. ¡Buen trabajo!
                </p>
              </div>
            )}
          </div>
        </div>

        {/*
          COLUMNA DERECHA: Visor de Evidencia y Consola de Decisión
        */}
        <div className="xl:col-span-2">
          {selectedProduct ? (
            <div className="bg-state-gray rounded-2xl border border-white/5 overflow-hidden sticky top-0">
              {/* CABECERA DEL DETALLE: Identificadores técnicos */}
              <div className="p-6 border-b border-white/5 bg-state-gray">
                <h3 className="text-xl font-bold text-platinum">
                  Detalles de Verificación
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-bold text-blue-light uppercase tracking-widest">
                    ID Producto:
                  </span>
                  <code className="text-[10px] text-lion bg-lion/5 px-2 py-0.5 rounded border border-lion/10 font-mono">
                    {selectedProduct.id}
                  </code>
                </div>
              </div>

              {/* A. BANNER DE BLOQUEO (Soft Lock) */}
              {lockStatus.isLockedByOther && (
                <div className="bg-fire/20 border-b border-fire/30 p-3 flex items-center gap-3 animate-in slide-in-from-top duration-300">
                  <Lock size={18} className="text-fire" />
                  <p className="text-xs font-bold text-fire">
                    VISTA DE SOLO LECTURA: Este producto está siendo revisado
                    por {lockStatus.lockerName}.
                  </p>
                </div>
              )}

              {/* B. CONTEXTO DE RE-INTENTO (Must-Have 1) */}
              {selectedProduct.rejection_reason && (
                <div className="m-6 mb-0 bg-fire/5 border border-fire/20 rounded-xl p-4 flex gap-3">
                  <AlertCircle size={20} className="text-fire shrink-0" />
                  <div>
                    <h5 className="text-xs font-bold text-fire uppercase tracking-widest">
                      Motivo de rechazo anterior:
                    </h5>
                    <p className="text-sm text-platinum mt-1 italic">
                      "{selectedProduct.rejection_reason}"
                    </p>
                    <p className="text-[10px] text-blue-light mt-2 font-medium">
                      Verifica si el usuario corrigió este punto antes de
                      aprobar.
                    </p>
                  </div>
                </div>
              )}

              {/* SELLER PASSPORT: Inteligencia del Vendedor (MVP++) */}
              <div className="p-6 bg-night/30 border-b border-white/5 flex items-center justify-between">
                {/* BLOQUE IZQUIERDO: IDENTIDAD */}
                <div className="flex items-center gap-4">
                  <UserAvatar
                    path={selectedProduct.seller?.avatar_url}
                    fallback={selectedProduct.seller?.username || 'U'}
                    size="md"
                  />

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <h4 className="text-lg font-bold text-platinum tracking-tight">
                        {selectedProduct.seller?.username ||
                          'Usuario de Google'}
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
                          {(() => {
                            const rank = getRank(
                              selectedProduct.seller_stats.sold,
                              selectedProduct.seller_stats.ratio,
                            );
                            return (
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider cursor-help transition-all hover:brightness-110 active:scale-95 ${rank.color}`}
                              >
                                {rank.icon} {rank.label}
                              </span>
                            );
                          })()}
                        </button>

                        {/* POPOVER DE RANGOS (Ajustado para no tapar el nombre) */}
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

                    {/* ID DEL VENDEDOR (Estilo Técnico) */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-blue-light/50 uppercase tracking-widest">
                        ID Vendedor:
                      </span>
                      <code className="text-[10px] text-blue-light/70 font-mono italic">
                        {selectedProduct.seller_id}
                      </code>
                    </div>
                  </div>
                </div>

                {/* BLOQUE DERECHO: ACCIONES DE SEGURIDAD */}
                <div className="flex items-center bg-night/40 p-1.5 rounded-2xl border border-white/5 shadow-inner">
                  <UserSafetyActions
                    user={{
                      id: selectedProduct.seller_id,
                      status: selectedProduct.seller?.status || 'active',
                      is_verified_seller:
                        selectedProduct.seller?.is_verified_seller,
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
                      {selectedProduct.seller_stats.verified}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-blue-light uppercase font-bold mb-1">
                      Rechazados
                    </p>
                    <p className="text-lg font-bold text-fire">
                      {selectedProduct.seller_stats.rejected}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-blue-light uppercase font-bold mb-1">
                      Vendidos
                    </p>
                    <p className="text-lg font-bold text-platinum">
                      {selectedProduct.seller_stats.sold}
                    </p>
                  </div>
                  <div className="text-center border-l border-white/10 pl-6">
                    <p className="text-[10px] text-lion uppercase font-bold mb-1">
                      Efectividad
                    </p>
                    <p className="text-lg font-bold text-lion">
                      {selectedProduct.seller_stats.ratio}%
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* 1. GALERÍA DE EVIDENCIA TÉCNICA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-blue-light flex items-center gap-2">
                      <Eye size={14} /> Prueba Física (Papelito)
                    </p>
                    <div className="aspect-video bg-night rounded-xl overflow-hidden border border-white/5 flex items-center justify-center">
                      <SecureImage
                        path={selectedProduct.verification_data?.proof_physical}
                        alt="Prueba física"
                        className="w-full h-full object-contain"
                        onClick={(url) => setActiveImage(url)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-blue-light flex items-center gap-2">
                      <TrendingUp size={14} /> Rendimiento (Benchmark)
                    </p>
                    <div className="aspect-video bg-night rounded-xl overflow-hidden border border-white/5 relative flex items-center justify-center">
                      <SecureImage
                        path={
                          selectedProduct.verification_data?.proof_performance
                        }
                        className="w-full h-full object-contain"
                        alt="Benchmark"
                        onClick={(url) => setActiveImage(url)}
                      />
                      {selectedProduct.verification_data?.benchmark_score && (
                        <div className="absolute bottom-3 right-3 bg-lion text-night px-3 py-1 rounded-lg font-bold text-sm shadow-2xl">
                          Score:{' '}
                          {selectedProduct.verification_data.benchmark_score}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. GALERÍA PÚBLICA DE VENTA */}
                <div className="space-y-3 pt-4 border-t border-white/5">
                  <h5 className="text-xs font-bold text-blue-light uppercase tracking-widest flex items-center gap-2">
                    <ImageIcon size={14} /> Galería de Venta (Pública)
                  </h5>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                    {selectedProduct.images?.map(
                      (img: string, index: number) => (
                        <div
                          key={index}
                          className="w-24 h-24 flex-shrink-0 bg-night rounded-xl overflow-hidden border border-white/5 relative group"
                        >
                          <img
                            src={img}
                            className="w-full h-full object-cover"
                            alt={`Venta ${index}`}
                          />
                          <button
                            onClick={() => setActiveImage(img)}
                            className="absolute inset-0 bg-night/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all"
                          >
                            <Maximize2 size={14} className="text-platinum" />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* 3. DESCRIPCIÓN Y FICHA TÉCNICA */}
                <div className="bg-night/50 p-4 rounded-xl border border-white/5">
                  <h5 className="text-sm font-bold text-platinum mb-2 uppercase tracking-tighter">
                    Descripción del Vendedor
                  </h5>
                  <p className="text-sm text-blue-light leading-relaxed">
                    {selectedProduct.description ||
                      'Sin descripción proporcionada.'}
                  </p>
                </div>

                <div className="space-y-3">
                  <h5 className="text-sm font-bold text-platinum uppercase tracking-tighter flex items-center gap-2">
                    <Cpu size={16} className="text-lion" /> Ficha Técnica
                  </h5>
                  <ProductSpecsGrid specs={selectedProduct.specifications} />
                </div>

                {/* 4. INTELIGENCIA DE VENDEDOR (NOTAS PRIVADAS) */}
                <div className="bg-fire/5 border border-fire/20 rounded-xl p-4 space-y-3">
                  <h5 className="text-xs font-bold text-fire uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert size={14} /> Inteligencia de Vendedor (Privado)
                  </h5>
                  <textarea
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="Escribe una nota interna sobre este vendedor..."
                    className="w-full bg-night/40 border border-fire/10 rounded-lg p-3 text-xs text-platinum outline-none focus:border-fire/30"
                    rows={2}
                  />
                  <button
                    onClick={saveInternalNote}
                    className="text-[10px] bg-fire/20 text-fire px-3 py-1 rounded-md hover:bg-fire/30 transition-all font-bold uppercase"
                  >
                    Guardar Nota Privada
                  </button>

                  {/* HISTORIAL DE NOTAS INTERNAS */}
                  {selectedProduct.internal_notes?.length > 0 && (
                    <div className="mt-4 space-y-2 border-t border-fire/10 pt-3">
                      <p className="text-[10px] font-bold text-fire/60 uppercase tracking-widest">
                        Historial de notas:
                      </p>
                      {selectedProduct.internal_notes.map(
                        (note: any, idx: number) => (
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
                                {new Date(note.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>

                {/* 5. ZONA DE VEREDICTO FINAL */}
                <div className="pt-6 border-t border-white/5 space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-blue-light uppercase tracking-widest">
                      Nota de revisión (Pública para el vendedor)
                    </label>
                    <textarea
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Escribe aquí el motivo del rechazo o sugerencias de mejora..."
                      className="w-full bg-night border border-white/10 rounded-xl p-4 text-sm text-platinum focus:border-lion outline-none transition-all min-h-[100px]"
                    />
                  </div>

                  <div className="flex gap-4">
                    <button
                      disabled={
                        resolve.isPending ||
                        lockStatus.isLockedByOther ||
                        isLocking
                      }
                      onClick={() =>
                        setConfirmData({ show: true, verdict: 'REJECT' })
                      }
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-fire/10 text-fire hover:bg-fire/20 transition-all font-bold disabled:opacity-50"
                    >
                      <XCircle size={20} /> Rechazar Producto
                    </button>

                    <button
                      disabled={
                        resolve.isPending ||
                        lockStatus.isLockedByOther ||
                        isLocking
                      }
                      onClick={() =>
                        setConfirmData({
                          show: true,
                          verdict: adminNote ? 'APPROVE_NOTE' : 'APPROVE',
                        })
                      }
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-4 rounded-xl font-bold text-night transition-all disabled:opacity-50 ${
                        adminNote
                          ? 'bg-lion hover:bg-lion/90'
                          : 'bg-forest hover:bg-forest/90'
                      }`}
                    >
                      {resolve.isPending ? (
                        <div className="w-5 h-5 border-2 border-night border-t-transparent animate-spin rounded-full" />
                      ) : (
                        <>
                          <CheckCircle size={20} />
                          {adminNote ? 'Aprobar con Nota' : 'Aprobar Producto'}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ESTADO INICIAL: Sin selección */
            <div className="h-full min-h-[500px] flex flex-col items-center justify-center bg-state-gray rounded-2xl border border-dashed border-white/10 text-blue-light">
              <div className="p-6 bg-white/5 rounded-full mb-4">
                <ShieldCheck size={48} className="opacity-20" />
              </div>
              <p className="font-medium">
                Selecciona un producto de la lista para auditarlo.
              </p>
              <p className="text-xs opacity-50 mt-1">
                La confianza de Selene empieza aquí.
              </p>
            </div>
          )}
        </div>
      </div>

      {/*
        MODALES GLOBALES: Visores y Diálogos de Confirmación
      */}
      <ImageModal url={activeImage} onClose={() => setActiveImage(null)} />

      <ConfirmModal
        isOpen={!!confirmData?.show}
        onClose={() => setConfirmData(null)}
        isLoading={resolve.isPending}
        type={confirmData?.verdict === 'REJECT' ? 'danger' : 'success'}
        title={
          confirmData?.verdict === 'REJECT'
            ? '¿Rechazar Producto?'
            : '¿Aprobar Producto?'
        }
        description={
          confirmData?.verdict === 'REJECT'
            ? `Estás a punto de rechazar "${selectedProduct?.name}". Se le notificará al vendedor con el motivo: "${adminNote || 'No cumple requisitos'}".`
            : `Vas a publicar "${selectedProduct?.name}" en el marketplace. ${adminNote ? `Se enviará la nota: "${adminNote}"` : ''}`
        }
        confirmLabel={
          confirmData?.verdict === 'REJECT'
            ? 'Confirmar Rechazo'
            : 'Confirmar Aprobación'
        }
        onConfirm={() => {
          if (confirmData?.verdict) {
            resolve.mutate(
              {
                id: selectedProduct.id,
                verdict: confirmData.verdict,
                note: adminNote,
                product: selectedProduct,
              },
              {
                onSuccess: () => {
                  // 1. Liberamos el candado en la DB antes de limpiar el estado
                  if (selectedId) {
                    releaseLock(selectedId);
                  }

                  // 2. EL FIX: Usamos el setter del ID (que sí es una función)
                  setSelectedId(null);

                  // 3. Limpiamos la nota y el modal
                  setAdminNote('');
                  setConfirmData(null);
                },
              },
            );
          }
        }}
      />
    </div>
  );
};

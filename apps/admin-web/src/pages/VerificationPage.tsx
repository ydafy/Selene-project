import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';

import { usePendingProducts } from '../hooks/usePendingProducts';
import { useProductLock } from '../hooks/useProductLock';

import { VerificationList } from '../components/features/verify/VerificationList';
import { VerificationDetail } from '../components/features/verify/VerificationDetail';
import { ImageModal } from '../components/ui/ImageModal';
import { ErrorState } from '../components/ui/ErrorState';
import type { PendingProduct } from '@selene/types';

export const VerificationPage = () => {
  const { products, isLoading, isError, refetch, resolve } =
    usePendingProducts();
  const { acquireLock, releaseLock, lockStatus, isLocking } = useProductLock();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<string | null>(null);

  // Selección tipada de forma estricta (sin 'any')
  const selectedProduct = useMemo(
    () => products?.find((p: PendingProduct) => p.id === selectedId) || null,
    [products, selectedId],
  );

  // Liberación segura del candado al salir o desmontar la pantalla
  useEffect(() => {
    return () => {
      if (selectedId) releaseLock(selectedId);
    };
  }, [selectedId, releaseLock]);

  // Selección protegida contra carreras de red entre administradores
  const handleSelectProduct = async (product: PendingProduct) => {
    if (selectedId === product.id) return;

    // 1. Intentamos bloquear el nuevo producto primero
    const success = await acquireLock(product.id);
    if (success) {
      // 2. Si lo conseguimos, liberamos el anterior y actualizamos la UI
      if (selectedId) await releaseLock(selectedId);
      setSelectedId(product.id);
    }
  };

  const handleVerdictComplete = () => {
    if (selectedId) releaseLock(selectedId);
    setSelectedId(null);
  };

  if (isError) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-lion/20 border-t-lion animate-spin rounded-full" />
          <p className="text-blue-light font-medium animate-pulse">
            Sincronizando cola de moderación...
          </p>
        </div>
      </div>
    );
  }

  const pendingCount = products?.length || 0;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-platinum">
            Verificación de Hardware
          </h1>
          <p className="text-blue-light mt-1">
            Auditoría técnica de publicaciones y benchmarks antes de salir a la
            venta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-forest/10 text-forest px-3 py-1.5 rounded-full text-xs font-bold border border-forest/20">
            <div className="w-2 h-2 bg-forest rounded-full animate-pulse" />
            En Vivo
          </div>
          <div className="bg-lion/10 text-lion px-4 py-2 rounded-full text-sm font-bold border border-lion/20">
            {pendingCount} En Revisión
          </div>
        </div>
      </div>

      {/* ESTADO INBOX ZERO (Cola Vacía) */}
      {pendingCount === 0 ? (
        <div className="bg-state-gray p-12 rounded-3xl border border-white/5 flex flex-col items-center justify-center text-center min-h-100">
          <div className="p-4 bg-forest/10 rounded-full mb-4">
            <CheckCircle2 size={48} className="text-forest" />
          </div>
          <h3 className="text-xl font-bold text-platinum mb-2">
            ¡Todo al día en Moderación!
          </h3>
          <p className="text-sm text-blue-light max-w-md">
            No hay productos esperando revisión en este momento. Las
            publicaciones aprobadas ya están activas en el marketplace.
          </p>
        </div>
      ) : (
        /* CONTENT GRID (Master - Detail) */
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <VerificationList
            products={products || []}
            selectedId={selectedId}
            isLocking={isLocking}
            onSelectProduct={handleSelectProduct}
          />

          <div className="xl:col-span-2">
            {selectedProduct ? (
              <VerificationDetail
                product={selectedProduct}
                lockStatus={lockStatus}
                isLocking={isLocking}
                resolve={resolve}
                refetch={refetch}
                onImageClick={(url) => setActiveImage(url)}
                onVerdictComplete={handleVerdictComplete}
              />
            ) : (
              <div className="h-full min-h-125 flex flex-col items-center justify-center bg-state-gray rounded-2xl border border-dashed border-white/10 text-blue-light p-6 text-center">
                <div className="p-6 bg-white/5 rounded-full mb-4">
                  <ShieldCheck size={48} className="opacity-20" />
                </div>
                <p className="font-medium text-platinum">
                  Selecciona un producto de la lista izquierda para auditarlo.
                </p>
                <p className="text-xs opacity-50 mt-1">
                  El candado de seguridad se activará automáticamente en
                  Postgres.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <ImageModal url={activeImage} onClose={() => setActiveImage(null)} />
    </div>
  );
};

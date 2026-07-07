import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

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

  const selectedProduct = useMemo(
    () =>
      (products?.find((p: any) => p.id === selectedId) ||
        null) as PendingProduct | null,
    [products, selectedId],
  );

  useEffect(() => {
    return () => {
      if (selectedProduct) releaseLock(selectedProduct.id);
    };
  }, [selectedProduct, releaseLock]);

  const handleSelectProduct = async (product: any) => {
    if (selectedId === product.id) return;
    if (selectedId) await releaseLock(selectedId);
    const success = await acquireLock(product.id);
    if (success) setSelectedId(product.id);
  };

  const handleVerdictComplete = () => {
    if (selectedId) releaseLock(selectedId);
    setSelectedId(null);
  };

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
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Verificación de Hardware</h1>
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

      {/* CONTENT GRID */}
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

      <ImageModal url={activeImage} onClose={() => setActiveImage(null)} />
    </div>
  );
};

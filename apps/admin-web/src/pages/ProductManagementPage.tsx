import { useState } from 'react';
import { Package, Trash2, Lock, Search } from 'lucide-react';
import { useAdminProduct } from '../hooks/useAdminProduct';
import { StatusBadge } from '../components/ui/StatusBadge';
import { InputModal } from '../components/ui/InputModal';
import { ErrorState } from '../components/ui/ErrorState';

export const ProductManagementPage = () => {
  const {
    products,
    isLoading,
    isError,
    refetch,
    softDelete,
    isDeleting,
    restoreProduct,
    isRestoring,
    total,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAdminProduct();
  const [search, setSearch] = useState('');
  const [modalProduct, setModalProduct] = useState<{
    id: string;
    name: string;
    status: string;
  } | null>(null);

  const filtered = products?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSoftDelete = async (reason: string) => {
    if (!modalProduct) return;
    try {
      await softDelete({ productId: modalProduct.id, reason });
      setModalProduct(null);
    } catch {
      // Error handled by mutation onError
    }
  };

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-lion/20 border-t-lion animate-spin rounded-full" />
          <p className="text-blue-light font-medium animate-pulse">
            Cargando productos...
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold">Gestión de Productos</h2>
          <p className="text-blue-light text-sm">
            Administrar publicaciones y soft-delete.
          </p>
        </div>
        <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/5 text-right">
          <p className="text-[10px] text-blue-light font-bold uppercase tracking-widest">
            Total Productos
          </p>
          <p className="text-xl font-bold text-lion">{total}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative w-full md:w-96">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-light"
          size={18}
        />
        <input
          type="text"
          placeholder="Buscar por nombre o ID..."
          className="w-full bg-state-gray border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-platinum focus:border-lion outline-none transition-all focus:ring-2 focus:ring-lion/50"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Empty state */}
      {filtered?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-state-gray/30 rounded-3xl border border-dashed border-white/10">
          <div className="p-6 bg-white/5 rounded-full mb-4">
            <Package size={48} className="opacity-20 text-blue-light" />
          </div>
          <p className="font-medium text-blue-light">
            No se encontraron productos.
          </p>
          <p className="text-xs opacity-50 mt-1 text-blue-light">
            Intenta con otro término de búsqueda.
          </p>
        </div>
      ) : (
        /* Table */
        <div className="bg-state-gray rounded-2xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-4 text-blue-light font-semibold">
                    Producto
                  </th>
                  <th className="text-left p-4 text-blue-light font-semibold">
                    Vendedor
                  </th>
                  <th className="text-left p-4 text-blue-light font-semibold">
                    Estado
                  </th>
                  <th className="text-right p-4 text-blue-light font-semibold">
                    Precio
                  </th>
                  <th className="text-left p-4 text-blue-light font-semibold">
                    Fecha
                  </th>
                  <th className="text-right p-4 text-blue-light font-semibold">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered?.map((product) => {
                  const isLocked = product.locked_by !== null;
                  const isDeleted = product.deleted_at !== null;
                  return (
                    <tr
                      key={product.id}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                        isDeleted ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {isDeleted && (
                            <span className="text-fire text-[10px] font-bold uppercase">
                              Eliminado
                            </span>
                          )}
                          <span className="font-medium text-platinum truncate max-w-[200px]">
                            {product.name}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-blue-light">
                        {product.seller?.username ?? '—'}
                      </td>
                      <td className="p-4">
                        <StatusBadge status={product.status as any} />
                      </td>
                      <td className="p-4 text-right text-platinum">
                        ${product.price.toLocaleString()}
                      </td>
                      <td className="p-4 text-blue-light text-xs">
                        {new Date(product.created_at).toLocaleDateString(
                          'es-MX',
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {isDeleted ? (
                          <button
                            onClick={() => restoreProduct(product.id)}
                            disabled={isRestoring}
                            className="inline-flex items-center gap-1 text-xs text-forest hover:text-forest/80 transition-all outline-none focus:ring-2 focus:ring-lion/50 disabled:opacity-40"
                            aria-label={`Restaurar producto ${product.name}`}
                          >
                            <Package size={14} />
                            Restaurar
                          </button>
                        ) : isLocked ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-blue-light opacity-60"
                            title={`Bloqueado por ${product.locker?.username ?? 'otro admin'}`}
                          >
                            <Lock size={14} />
                            Bloqueado
                          </span>
                        ) : (
                          <button
                            onClick={() =>
                              setModalProduct({
                                id: product.id,
                                name: product.name,
                                status: product.status,
                              })
                            }
                            disabled={isDeleting}
                            aria-label={`Ocultar producto ${product.name} (${product.status})`}
                            className="p-2 rounded-lg bg-white/5 text-blue-light hover:bg-fire/20 hover:text-fire transition-all outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {hasNextPage && (
            <div className="flex justify-center py-4">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-6 py-2.5 bg-white/5 text-blue-light rounded-xl border border-white/10 hover:bg-white/10 hover:text-platinum transition-all outline-none focus:ring-2 focus:ring-lion/50 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
              >
                {isFetchingNextPage ? 'Cargando...' : `Cargar más (${products.length} de ${total})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Soft-delete confirmation modal */}
      {modalProduct && (
        <InputModal
          isOpen={!!modalProduct}
          onClose={() => setModalProduct(null)}
          onConfirm={handleSoftDelete}
          isLoading={isDeleting}
          title="Ocultar Producto"
          description={`Estás por ocultar "${modalProduct.name}". Esta acción cambiará el estado a HIDDEN y solo un admin puede revertirla.`}
          placeholder="Motivo de la ocultación (mínimo 5 caracteres)..."
          confirmLabel="Ocultar Producto"
          minLength={5}
        />
      )}
    </div>
  );
};

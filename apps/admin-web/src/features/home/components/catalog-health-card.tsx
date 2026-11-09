import { Boxes, CheckCircle, Package, Users } from 'lucide-react';

interface CatalogHealthCardProps {
  stats?: {
    verifiedProducts: number;
    totalProducts: number;
    totalUsers: number;
  };
  isLoading: boolean;
  isFetching?: boolean;
}

export const CatalogHealthCard = ({
  stats,
  isLoading,
  isFetching,
}: CatalogHealthCardProps) => {
  return (
    <div className="bg-state-gray p-6 rounded-2xl border border-white/5 flex flex-col justify-between">
      <div>
        <h3 className="text-sm font-bold text-platinum uppercase tracking-widest flex items-center gap-2 mb-4">
          <Boxes size={16} className="text-lion" /> Salud del Catálogo
        </h3>
        <div className="space-y-4 text-sm">
          {/* Fila 1: Verificados */}
          <div className="flex justify-between items-center py-2 border-b border-white/5">
            <span className="text-blue-light flex items-center gap-2">
              <CheckCircle size={15} className="text-forest" /> Productos
              Verificados (En Venta)
            </span>
            {isLoading ? (
              <div className="h-5 w-12 bg-white/5 animate-pulse rounded" />
            ) : (
              <span className="text-forest font-semibold text-base">
                {stats?.verifiedProducts ?? 0}
              </span>
            )}
          </div>

          {/* Fila 2: Total Productos */}
          <div className="flex justify-between items-center py-2 border-b border-white/5">
            <span className="text-blue-light flex items-center gap-2">
              <Package size={15} className="text-lion" /> Total Publicaciones
              Activas
            </span>
            {isLoading ? (
              <div className="h-5 w-12 bg-white/5 animate-pulse rounded" />
            ) : (
              <span className="text-lion font-semibold text-base">
                {stats?.totalProducts ?? 0}
              </span>
            )}
          </div>

          {/* Fila 3: Usuarios */}
          <div className="flex justify-between items-center py-2">
            <span className="text-blue-light flex items-center gap-2">
              <Users size={15} className="text-purple-400" /> Usuarios
              Registrados
            </span>
            {isLoading ? (
              <div className="h-5 w-12 bg-white/5 animate-pulse rounded" />
            ) : (
              <span className="text-purple-400 font-semibold text-base">
                {stats?.totalUsers ?? 0}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6 pt-4 border-t border-white/5 text-xs text-text-muted flex justify-between items-center">
        <span>Auto-refresh cada 2 min</span>
        <div className="flex items-center gap-1.5 font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              isFetching ? 'bg-lion animate-ping' : 'bg-forest'
            }`}
          />
          <span className={isFetching ? 'text-lion' : 'text-forest'}>
            {isFetching ? 'SYNCING...' : 'LIVE'}
          </span>
        </div>
      </div>
    </div>
  );
};

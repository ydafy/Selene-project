import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUsers } from '../hooks/useUsers';
import { useDebounce } from '../hooks/useDebounce';
import { UserCard } from '../components/features/users/UserCard';
import { Skeleton } from '../components/ui/Skeleton';
import type { AdminUser } from '@selene/types';
import { ErrorState } from '../components/ui/ErrorState';

export const UsersPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // 1. Aplicamos el Debounce (300ms es el estándar industrial)
  const debouncedSearch = useDebounce(search, 300);

  // 2. Pasamos el valor debounced al hook
  const { data, isLoading, isError, refetch } = useUsers(
    debouncedSearch,
    page,
    statusFilter,
    sortBy,
  );

  if (isError)
    return (
      <div className="p-8">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );

  const totalPages = Math.ceil(
    (data?.totalCount || 0) / (data?.pageSize || 20),
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-platinum">Comunidad Selene</h2>
          <p className="text-blue-light">
            Explora y gestiona los perfiles de los usuarios.
          </p>
        </div>
        <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
          <p className="text-[10px] text-blue-light font-bold uppercase tracking-widest">
            Registrados
          </p>
          <p className="text-xl font-bold text-lion">{data?.totalCount || 0}</p>
        </div>
      </div>

      {/* BUSCADOR */}
      <div className="relative">
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-light"
          size={20}
        />
        <input
          type="text"
          placeholder="Buscar por nombre, email o ID..."
          className="w-full bg-state-gray border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-platinum focus:border-lion outline-none transition-all shadow-xl"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center mb-6">
        {/* PILLS DE ESTADO */}
        <div className="flex gap-2 p-1 bg-white/5 rounded-2xl border border-white/5 overflow-x-auto max-w-full scrollbar-hide">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'active', label: 'Activos' },
            { id: 'vip', label: 'VIPs' },
            { id: 'suspended', label: 'Suspendidos' },
            { id: 'banned', label: 'Baneados' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setStatusFilter(tab.id);
                setPage(0);
              }}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-lion text-night shadow-lg'
                  : 'text-blue-light hover:text-platinum'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* SELECTOR DE ORDEN */}
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value);
            setPage(0);
          }}
          className="bg-state-gray border border-white/10 text-platinum text-xs font-bold rounded-xl px-4 py-2 outline-none focus:border-lion transition-all focus:ring-2 focus:ring-lion/50"
        >
          <option value="newest">Más recientes</option>
          <option value="oldest">Más antiguos</option>
          <option value="balance">Mayor saldo</option>
          <option value="sales">Más ventas</option>
        </select>
      </div>

      {/* GRID DE CARDS (MVP++) */}
      <div className="relative min-h-[400px]">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={`skeleton-${i}`}
                className="bg-state-gray rounded-3xl border border-white/5 p-6"
              >
                <div className="flex flex-col items-center">
                  <Skeleton variant="circular" width={64} height={64} className="mb-4" />
                  <Skeleton className="w-28 h-5 mb-2" />
                  <Skeleton className="w-20 h-3 mb-6" />

                  <div className="w-full space-y-2">
                    <Skeleton className="h-10 rounded-xl" />
                    <Skeleton className="h-10 rounded-xl" />
                  </div>

                  <div className="w-full mt-6 pt-4 border-t border-white/5">
                    <Skeleton className="w-20 h-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {data?.users?.map((u) => (
              <UserCard
                key={(u as AdminUser).id}
                user={u as AdminUser}
                onClick={() => navigate(`/users/${(u as AdminUser).id}`)}
              />
            ))}
          </div>
        )}

        {/* ESTADOS VACÍOS */}
        {data?.users?.length === 0 && !isLoading && (
          <div className="text-center py-20 bg-state-gray/50 rounded-3xl border border-dashed border-white/10">
            <p className="text-blue-light">
              No se encontraron usuarios que coincidan con tu búsqueda.
            </p>
          </div>
        )}
      </div>

      {/* PAGINACIÓN (Abajo) */}
      <div className="flex justify-between items-center pt-6 border-t border-white/5">
        <p className="text-xs text-blue-light font-medium">
          Mostrando página{' '}
          <span className="text-platinum font-bold">{page + 1}</span> de{' '}
          {totalPages || 1}
        </p>
        <div className="flex gap-3">
          <button
            disabled={page === 0 || isLoading}
            onClick={() => setPage((p) => p - 1)}
            className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl disabled:opacity-30 hover:bg-white/10 transition-all border border-white/5 text-sm outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
          >
            <ChevronLeft size={16} /> Anterior
          </button>
          <button
            disabled={page >= totalPages - 1 || isLoading}
            onClick={() => setPage((p) => p + 1)}
            className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl disabled:opacity-30 hover:bg-white/10 transition-all border border-white/5 text-sm outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
          >
            Siguiente <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

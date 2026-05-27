/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUsers } from '../hooks/useUsers';
import { useDebounce } from '../hooks/useDebounce';
import { UserCard } from '../components/features/users/UserCard';

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
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
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
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-state-gray border border-white/10 text-platinum text-xs font-bold rounded-xl px-4 py-2 outline-none focus:border-lion transition-all"
        >
          <option value="newest">Más recientes</option>
          <option value="oldest">Más antiguos</option>
          <option value="balance">Mayor saldo</option>
          <option value="sales">Más ventas</option>
        </select>
      </div>

      {/* GRID DE CARDS (MVP++) */}
      <div className="relative min-h-[400px]">
        {isLoading && (
          <div className="absolute inset-0 bg-night/20 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="w-10 h-10 border-2 border-lion border-t-transparent animate-spin rounded-full" />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {data?.users?.map((user: any) => (
            <UserCard
              key={user.id}
              user={user}
              onClick={() => navigate(`/users/${user.id}`)}
            />
          ))}
        </div>

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
            className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl disabled:opacity-30 hover:bg-white/10 transition-all border border-white/5 text-sm"
          >
            <ChevronLeft size={16} /> Anterior
          </button>
          <button
            disabled={page >= totalPages - 1 || isLoading}
            onClick={() => setPage((p) => p + 1)}
            className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl disabled:opacity-30 hover:bg-white/10 transition-all border border-white/5 text-sm"
          >
            Siguiente <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

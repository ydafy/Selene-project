import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveDisputes } from '../hooks/useActiveDisputes';
import { DisputesTable } from '../components/features/disputes/DisputesTable';
import { useDebounce } from '../hooks/useDebounce';
import { Search } from 'lucide-react';
import { ErrorState } from '../components/ui/ErrorState';

export const DisputesPage = () => {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const debouncedSearch = useDebounce(search, 300);
  const { data: disputes, isLoading, isError, refetch } = useActiveDisputes(
    filter,
    debouncedSearch,
    sortBy,
  );
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Centro de Disputas</h1>
          <p className="text-blue-light text-sm">
            Gestión de reclamos y mediación técnica.
          </p>
        </div>
        <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/5 text-right">
          <p className="text-[10px] text-blue-light font-bold uppercase tracking-widest">
            Casos en Pantalla
          </p>
          <p className="text-xl font-bold text-lion">{disputes?.length || 0}</p>
        </div>
      </div>

      {isError && <ErrorState onRetry={() => refetch()} />}

      {/* TABS DE FILTRADO */}
      <div className="flex gap-2 p-1 bg-white/5 w-fit rounded-xl border border-white/5">
        {['open', 'resolved', 'all'].map((id) => (
          <button
            key={id}
            onClick={() => setFilter(id as 'open' | 'resolved' | 'all')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all capitalize outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer ${
              filter === id
                ? 'bg-lion text-night shadow-lg'
                : 'text-blue-light hover:text-platinum'
            }`}
          >
            {id === 'open'
              ? 'Activos'
              : id === 'resolved'
                ? 'Historial'
                : 'Todos'}
          </button>
        ))}
      </div>
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
        <div className="relative w-full md:w-96">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-light"
            size={18}
          />
          <input
            type="text"
            placeholder="Buscar por ID, Comprador o Vendedor..."
            className="w-full bg-state-gray border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-platinum focus:border-lion outline-none transition-all focus:ring-2 focus:ring-lion/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-4 w-full md:w-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-state-gray border border-white/10 text-platinum text-xs font-bold rounded-xl px-4 py-2 outline-none focus:border-lion focus:ring-2 focus:ring-lion/50"
          >
            <option value="newest">Más recientes</option>
            <option value="oldest">Más antiguas (Urgentes)</option>
            <option value="amount_desc">Monto: Mayor a menor</option>
            <option value="amount_asc">Monto: Menor a mayor</option>
          </select>
        </div>
      </div>
      {/* COMPONENTE EXTRAÍDO (MVP++ CLEAN) */}
      <DisputesTable
        disputes={disputes}
        isLoading={isLoading}
        onViewDetails={(id) => navigate(`/disputes/${id}`)}
      />
    </div>
  );
};

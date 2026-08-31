/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { Search, Clock } from 'lucide-react';
import { UserAvatar } from '../../ui/UserAvatar';
import type { PendingProduct } from '@selene/types';

interface VerificationListProps {
  products: PendingProduct[];
  selectedId: string | null;
  isLocking: boolean;
  onSelectProduct: (product: PendingProduct) => void;
}

const getTimeInQueue = (date: string) => {
  const diff = Math.floor(
    (new Date().getTime() - new Date(date).getTime()) / 60000,
  );
  if (diff < 60) return `${diff}m`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return `${Math.floor(diff / 1440)}d`;
};

const CATEGORIES = ['ALL', 'GPU', 'CPU', 'RAM', 'Motherboard'] as const;

export const VerificationList = ({
  products,
  selectedId,
  isLocking,
  onSelectProduct,
}: VerificationListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('ALL');

  const filteredProducts = useMemo(() => {
    if (!products) return [];

    return products.filter((product: any) => {
      const matchesSearch =
        product.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.seller?.username
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase());

      const matchesCategory =
        activeCategory === 'ALL' || product.category === activeCategory;

      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, activeCategory]);

  const clearFilters = () => {
    setSearchTerm('');
    setActiveCategory('ALL');
  };

  return (
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
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer ${
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
        {filteredProducts.map((product: any) => (
          <button
            key={product.id}
            disabled={isLocking}
            onClick={() => onSelectProduct(product)}
            className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 outline-none focus:ring-2 focus:ring-lion/50 ${
              selectedId === product.id
                ? 'bg-lion/10 border-lion shadow-[0_0_15px_rgba(189,159,101,0.1)]'
                : 'bg-state-gray border-white/5 hover:border-white/20'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-light bg-night px-2 py-1 rounded">
                {product.category}
              </span>
              <span className="text-lion font-bold">
                ${product.price?.toLocaleString()}
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
                  `User_${product.seller_id?.slice(0, 5)}`}
              </span>
              <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-blue-light bg-white/5 px-2 py-1 rounded-full border border-white/5">
                <Clock size={10} /> {getTimeInQueue(product.created_at)}
              </span>
            </div>
          </button>
        ))}

        {/* ESTADOS VACÍOS */}
        {products && products.length > 0 && filteredProducts.length === 0 && (
          <div className="text-center py-12 bg-state-gray/50 rounded-2xl border border-dashed border-white/10">
            <p className="text-sm text-blue-light">
              No se encontraron resultados.
            </p>
            <button
              onClick={clearFilters}
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
  );
};

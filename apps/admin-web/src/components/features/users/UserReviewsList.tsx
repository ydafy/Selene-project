import { Star, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface Props {
  reviews: any[];
  avgRating: number;
}

export const UserReviewsList = ({ reviews, avgRating }: Props) => {
  const [currentPage, setCurrentPage] = useState(0);
  const ITEMS_PER_PAGE = 10;

  const totalPages = Math.ceil(reviews.length / ITEMS_PER_PAGE);
  const currentReviews = reviews.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE,
  );

  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl">
      {/* HEADER */}
      <div className="p-6 border-b border-white/5 bg-white/5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-lion/10 rounded-lg text-lion">
            <MessageSquare size={20} />
          </div>
          <div>
            <h3 className="font-bold text-platinum">Reseñas de Clientes</h3>
            <p className="text-[10px] text-blue-light uppercase tracking-widest font-bold">
              {reviews.length} comentarios totales
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-night/50 px-4 py-2 rounded-2xl border border-white/5">
          <span className="text-xl font-black text-platinum">
            {avgRating.toFixed(1)}
          </span>
          <div className="flex text-lion">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                size={14}
                fill={i < Math.round(avgRating) ? 'currentColor' : 'none'}
                className={
                  i < Math.round(avgRating) ? 'text-lion' : 'text-white/10'
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* GRID DE RESEÑAS */}
      <div className="p-6">
        {reviews.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentReviews.map((rev: any) => (
                <div
                  key={rev.id}
                  className="bg-night/40 p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-lion/20 flex items-center justify-center text-[10px] font-bold text-lion uppercase">
                        {rev.reviewer?.username?.[0] || 'U'}
                      </div>
                      <span className="text-sm font-bold text-platinum">
                        @{rev.reviewer?.username || 'Usuario'}
                      </span>
                    </div>
                    <div className="flex text-lion/60">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          size={10}
                          fill={i < rev.rating ? 'currentColor' : 'none'}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-blue-light italic leading-relaxed">
                    "{rev.comment || 'Sin comentario.'}"
                  </p>
                  <p className="text-[9px] text-white/20 mt-4 uppercase font-bold">
                    {new Date(rev.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>

            {/* CONTROLES DE PAGINACIÓN (Solo si hay más de 1 página) */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center items-center gap-4">
                <button
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="p-2 bg-night rounded-xl border border-white/5 disabled:opacity-20 hover:bg-white/5 transition-all"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="text-xs text-blue-light font-bold">
                  Página {currentPage + 1} de {totalPages}
                </span>
                <button
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="p-2 bg-night rounded-xl border border-white/5 disabled:opacity-20 hover:bg-white/5 transition-all"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="py-12 text-center">
            <p className="text-blue-light italic text-sm">
              Este vendedor aún no ha recibido reseñas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

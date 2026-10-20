import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAYOUT_PAGE_SIZE = 20;
export const workbenchFocus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lion focus-visible:ring-offset-2 focus-visible:ring-offset-night';
export const workbenchGrid = 'grid min-w-0 items-stretch gap-5 lg:grid-cols-2';
export const workbenchPanel =
  'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-white/5 bg-state-gray shadow-xl shadow-black/10 lg:h-[min(65vh,640px)]';
export const workbenchScroll =
  'min-h-0 flex-1 max-h-[55vh] overflow-y-auto overscroll-contain lg:max-h-none';

interface PayoutPaginationProps {
  page: number;
  total: number;
  label: string;
  disabled?: boolean;
  display?: 'range' | 'pages';
  onPageChange: (page: number) => void;
}

export function PayoutPagination({
  page,
  total,
  label,
  disabled = false,
  display = 'range',
  onPageChange,
}: PayoutPaginationProps) {
  const lastPage = Math.max(0, Math.ceil(total / PAYOUT_PAGE_SIZE) - 1);
  const current = Math.max(0, Math.min(page, lastPage));
  const first = total === 0 ? 0 : current * PAYOUT_PAGE_SIZE + 1;
  const last = Math.min((current + 1) * PAYOUT_PAGE_SIZE, total);
  const previousDisabled = disabled || current === 0;
  const nextDisabled = disabled || current === lastPage;
  const button = `rounded-lg border border-white/10 p-2 text-blue-light transition-colors hover:text-platinum disabled:opacity-30 ${workbenchFocus}`;

  return (
    <nav
      aria-label={`Paginación de ${label}`}
      className="flex shrink-0 items-center justify-between gap-3 border-t border-white/5 px-5 py-3"
    >
      <p
        className="text-[11px] tabular-nums text-blue-light"
        aria-live="polite"
      >
        {display === 'pages'
          ? `Página ${current + 1} de ${lastPage + 1}`
          : `${first}–${last} de ${total}`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label={`Página anterior de ${label}`}
          disabled={previousDisabled}
          onClick={() => {
            if (!previousDisabled) onPageChange(current - 1);
          }}
          className={button}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          aria-label={`Página siguiente de ${label}`}
          disabled={nextDisabled}
          onClick={() => {
            if (!nextDisabled) onPageChange(current + 1);
          }}
          className={button}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}

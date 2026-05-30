import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type PaginationState,
} from '@tanstack/react-table';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  enableSorting?: boolean;
  pagination?: PaginationState;
  onPaginationChange?: (pagination: PaginationState) => void;
  pageCount?: number;
  header?: React.ReactNode;
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
  skeletonRowCount?: number;
}

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <ArrowUp size={12} className="text-lion shrink-0" />;
  if (sorted === 'desc') return <ArrowDown size={12} className="text-lion shrink-0" />;
  return <ArrowUpDown size={12} className="text-blue-light/30 shrink-0" />;
}

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: columns }, (_, i) => (
        <td key={i} className="p-4">
          <div
            className={`h-4 animate-pulse bg-white/5 rounded ${
              i === 0 ? 'w-3/4' : i === columns - 1 ? 'w-1/4' : 'w-1/2'
            }`}
          />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<TData>({
  columns,
  data,
  isLoading = false,
  sorting: controlledSorting,
  onSortingChange,
  enableSorting = true,
  pagination: controlledPagination,
  onPaginationChange,
  pageCount,
  header,
  onRowClick,
  emptyMessage = 'No data',
  skeletonRowCount = 5,
}: DataTableProps<TData>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = controlledSorting ?? internalSorting;
  const setSorting = onSortingChange ?? setInternalSorting;

  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const pagination = controlledPagination ?? internalPagination;
  const setPagination = onPaginationChange ?? setInternalPagination;

  const handleSortingChange = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      const newValue =
        typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(newValue);
    },
    [sorting, setSorting],
  );

  const handlePaginationChange = useCallback(
    (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
      const newValue =
        typeof updater === 'function' ? updater(pagination) : updater;
      setPagination(newValue);
    },
    [pagination, setPagination],
  );

  const isManualSorting = !!onSortingChange;
  const isManualPagination = !!pageCount;

  const table = useReactTable({
    data: data ?? [],
    columns: columns ?? [],
    state: {
      sorting,
      pagination,
    },
    onSortingChange: handleSortingChange,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: isManualPagination ? undefined : getPaginationRowModel(),
    enableSorting: enableSorting && !isManualSorting,
    manualSorting: isManualSorting,
    manualPagination: isManualPagination,
    pageCount: pageCount ?? -1,
    debugTable: false,
  });

  const columnCount = useMemo(
    () => columns?.length ?? 0,
    [columns],
  );

  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl">
      {header && (
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
          {header}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-night/50 text-[10px] uppercase text-blue-light font-bold">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  if (!canSort) {
                    return (
                      <th key={header.id} className="p-4 text-left">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </th>
                    );
                  }

                  const label =
                    typeof header.column.columnDef.header === 'string'
                      ? header.column.columnDef.header
                      : header.column.id;

                  return (
                    <th key={header.id} className="p-4 text-left">
                      <button
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${label}`}
                        className="flex items-center gap-1.5 uppercase cursor-pointer transition-opacity duration-150 outline-none focus:ring-2 focus:ring-lion/50 rounded"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <SortIcon sorted={sorted} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-white/5">
            {isLoading || data === undefined ? (
              Array.from({ length: skeletonRowCount }, (_, i) => (
                <SkeletonRow key={`skeleton-${i}`} columns={columnCount} />
              ))
            ) : data.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                    className={`transition-colors duration-150 ${
                      onRowClick ? 'cursor-pointer hover:bg-white/[0.02]' : ''
                    }`}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-4 text-sm">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columnCount || 1}
                  className="p-12 text-center text-sm text-blue-light italic"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination - client-side */}
      {!isManualPagination &&
        data &&
        data.length > pagination.pageSize && (
          <div className="p-4 border-t border-white/5 flex items-center justify-between">
            <p className="text-xs text-blue-light font-medium">
              Mostrando página {table.getState().pagination.pageIndex + 1} de{' '}
              {table.getPageCount()}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label="Previous page"
                className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl border border-white/5 text-sm disabled:opacity-30 hover:bg-white/10 transition-all outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
              >
                <ChevronLeft size={14} />
                Previous
              </button>

              <button
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label="Next page"
                className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl border border-white/5 text-sm disabled:opacity-30 hover:bg-white/10 transition-all outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

      {/* Pagination - controlled */}
      {isManualPagination && pagination && (
        <div className="p-4 border-t border-white/5 flex items-center justify-between">
          <p className="text-xs text-blue-light font-medium">
            Mostrando página {pagination.pageIndex + 1} de {pageCount ?? 1}
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                handlePaginationChange({
                  ...pagination,
                  pageIndex: pagination.pageIndex - 1,
                })
              }
              disabled={pagination.pageIndex === 0}
              aria-label="Previous page"
              className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl border border-white/5 text-sm disabled:opacity-30 hover:bg-white/10 transition-all outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
            >
              <ChevronLeft size={14} />
              Previous
            </button>

            <button
              onClick={() =>
                handlePaginationChange({
                  ...pagination,
                  pageIndex: pagination.pageIndex + 1,
                })
              }
              disabled={
                pageCount !== undefined &&
                pagination.pageIndex >= pageCount - 1
              }
              aria-label="Next page"
              className="flex items-center gap-2 px-4 py-2 bg-state-gray rounded-xl border border-white/5 text-sm disabled:opacity-30 hover:bg-white/10 transition-all outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

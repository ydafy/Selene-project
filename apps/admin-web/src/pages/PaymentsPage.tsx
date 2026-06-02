import { useState, useCallback } from 'react';
import { Search, FileDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { usePayoutRequests, type PayoutStatus } from '../hooks/usePayoutRequests';
import { useUpdatePayoutStatus } from '../hooks/useUpdatePayoutStatus';
import { generateBBVAFile } from '../lib/bbva/generateBBVAFile';
import { KPIPaymentsCards } from '../components/features/payments/KPIPaymentsCards';
import { PayoutsTable } from '../components/features/payments/PayoutsTable';
import { PreExportModal } from '../components/features/payments/PreExportModal';
import { useDebounce } from '../hooks/useDebounce';
import { ErrorState } from '../components/ui/ErrorState';

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const statusFilters: { id: PayoutStatus | 'all'; label: string }[] = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'processing', label: 'En Proceso' },
  { id: 'completed', label: 'Completados' },
  { id: 'rejected', label: 'Rechazados' },
  { id: 'all', label: 'Todos' },
];

export const PaymentsPage = () => {
  const [statusFilter, setStatusFilter] = useState<PayoutStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'amount' | 'requested_at'>('requested_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [preExportOpen, setPreExportOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  const { data: payouts, isLoading, isError, refetch } = usePayoutRequests({
    status: statusFilter,
    search: debouncedSearch,
    sortBy,
    sortDir,
  });

  const { markAsProcessing } = useUpdatePayoutStatus();

  const handleStatusChange = useCallback(() => {
    refetch();
    setSelectedIds(new Set());
  }, [refetch]);

  const handleGenerateFile = () => {
    if (selectedIds.size === 0) {
      toast.error('Selecciona al menos un retiro para generar el archivo');
      return;
    }

    const selectedPayouts = (payouts ?? []).filter((p) => selectedIds.has(p.id));
    if (selectedPayouts.length === 0) {
      toast.error('No se encontraron retiros seleccionados');
      return;
    }

    // Open pre-export validation modal
    setPreExportOpen(true);
  };

  const handleConfirmExport = async () => {
    setPreExportOpen(false);

    const selectedPayouts = (payouts ?? []).filter((p) => selectedIds.has(p.id));
    if (selectedPayouts.length === 0) return;

    try {
      // DB-first: mark as processing
      const { updated, skipped, updatedIds } = await markAsProcessing([
        ...selectedIds,
      ]);
      if (updated === 0) {
        toast.warning(
          'Ningún retiro pudo ser procesado. Es posible que ya no estén en estado pendiente.',
        );
        return;
      }
      if (skipped > 0) {
        toast.info(
          `${skipped} retiro(s) no estaban en estado pendiente y fueron omitidos.`,
        );
      }

      // Generate BBVA file only for successfully updated rows
      const successfulPayouts = selectedPayouts.filter((p) =>
        updatedIds.includes(p.id),
      );
      if (successfulPayouts.length === 0) {
        toast.warning('No hay retiros válidos para exportar después de la actualización.');
        handleStatusChange();
        return;
      }

      const bbvaRows = successfulPayouts.map((p) => ({
        bankName: p.bank_name,
        clabe: p.clabe,
        amount: p.amount,
        beneficiaryName: p.account_holder_name,
        reference: p.id,
      }));

      const file = generateBBVAFile(bbvaRows);
      downloadFile(file.content, file.filename);
      toast.success(`Archivo BBVA generado: ${file.filename}`);

      handleStatusChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(`Error al generar archivo: ${message}`);
    }
  };

  const handleRegenerateFile = () => {
    const visiblePayouts = payouts ?? [];
    if (visiblePayouts.length === 0) {
      toast.error('No hay retiros en proceso para regenerar el archivo');
      return;
    }

    try {
      const bbvaRows = visiblePayouts.map((p) => ({
        bankName: p.bank_name,
        clabe: p.clabe,
        amount: p.amount,
        beneficiaryName: p.account_holder_name,
        reference: p.id,
      }));

      const file = generateBBVAFile(bbvaRows);
      downloadFile(file.content, file.filename);
      toast.success(`Archivo BBVA re-generado: ${file.filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(`Error al regenerar archivo: ${message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold">Pagos a Vendedores</h2>
          <p className="text-blue-light text-sm">
            Gestión de retiros y dispersiones bancarias.
          </p>
        </div>
        <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/5 text-right">
          <p className="text-[10px] text-blue-light font-bold uppercase tracking-widest">
            Retiros en Pantalla
          </p>
          <p className="text-xl font-bold text-lion">{payouts?.length || 0}</p>
        </div>
      </div>

      {isError && <ErrorState onRetry={() => refetch()} />}

      <KPIPaymentsCards payouts={payouts ?? []} />

      {/* Filter tabs */}
      <div className="flex gap-2 p-1 bg-white/5 w-fit rounded-xl border border-white/5">
        {statusFilters.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setStatusFilter(f.id);
              setSelectedIds(new Set());
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer ${
              statusFilter === f.id
                ? 'bg-lion text-night shadow-lg'
                : 'text-blue-light hover:text-platinum'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Search + sort + batch actions */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-96">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-light"
            size={18}
          />
          <input
            type="text"
            placeholder="Buscar por nombre..."
            className="w-full bg-state-gray border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-platinum focus:border-lion outline-none transition-all focus:ring-2 focus:ring-lion/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={`${sortBy}_${sortDir}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split('_') as [typeof sortBy, typeof sortDir];
              setSortBy(field);
              setSortDir(dir);
            }}
            className="bg-state-gray border border-white/10 text-platinum text-xs font-bold rounded-xl px-4 py-2 outline-none focus:border-lion focus:ring-2 focus:ring-lion/50 cursor-pointer"
          >
            <option value="requested_at_desc">Más recientes</option>
            <option value="requested_at_asc">Más antiguos</option>
            <option value="amount_desc">Monto: Mayor a menor</option>
            <option value="amount_asc">Monto: Menor a mayor</option>
          </select>

          <div className="flex gap-2">
            <button
              onClick={handleGenerateFile}
              disabled={selectedIds.size === 0 || isLoading}
              title={
                selectedIds.size === 0
                  ? 'Selecciona al menos un retiro'
                  : 'Generar archivo BBVA para los seleccionados'
              }
              className="flex items-center gap-2 px-4 py-2 bg-lion text-night rounded-xl text-sm font-bold hover:bg-lion/90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <FileDown size={16} />
              Generar Archivo BBVA
            </button>

            {statusFilter === 'processing' && (
              <button
                onClick={handleRegenerateFile}
                disabled={isLoading || (payouts ?? []).length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-state-gray border border-white/10 text-platinum rounded-xl text-sm font-bold hover:bg-white/10 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={16} />
                Re-generar Archivo
              </button>
            )}
          </div>
        </div>
      </div>

      <PayoutsTable
        payouts={payouts ?? []}
        selectedIds={selectedIds}
        onSelectedChange={setSelectedIds}
        isLoading={isLoading}
        onStatusChange={handleStatusChange}
      />

      <PreExportModal
        isOpen={preExportOpen}
        onClose={() => setPreExportOpen(false)}
        onConfirm={handleConfirmExport}
        payouts={payouts ?? []}
        selectedIds={selectedIds}
        isLoading={isLoading}
      />
    </div>
  );
};

import { useMemo, useState, useCallback } from 'react';
import {
  CheckCircle2,
  RotateCcw,
  XCircle,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '../../ui/DataTable';
import { StatusBadge } from '../../ui/StatusBadge';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { InputModal } from '../../ui/InputModal';
import { useUpdatePayoutStatus } from '../../../hooks/useUpdatePayoutStatus';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import type { ColumnDef } from '@tanstack/react-table';
import type { PayoutOverviewRow } from '../../../hooks/usePayoutRequests';
import type { StatusType } from '../../ui/StatusBadge';

interface PayoutsTableProps {
  payouts: PayoutOverviewRow[];
  selectedIds: Set<string>;
  onSelectedChange: (ids: Set<string>) => void;
  isLoading: boolean;
  onStatusChange: () => void;
}

export const PayoutsTable = ({
  payouts,
  selectedIds,
  onSelectedChange,
  isLoading,
  onStatusChange,
}: PayoutsTableProps) => {
  const { markAsCompleted, revertToPending, rejectPayout, isLoading: isMutating } =
    useUpdatePayoutStatus();

  const [completeModal, setCompleteModal] = useState<string | null>(null);
  const [revertModal, setRevertModal] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<string | null>(null);

  const toggleRow = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectedChange(next);
    },
    [selectedIds, onSelectedChange],
  );

  const toggleAllPending = useCallback(() => {
    const pendingIds = payouts
      .filter((p) => p.status === 'pending')
      .map((p) => p.id);
    const allSelected =
      pendingIds.length > 0 && pendingIds.every((id) => selectedIds.has(id));

    const next = new Set(selectedIds);
    if (allSelected) {
      pendingIds.forEach((id) => next.delete(id));
    } else {
      pendingIds.forEach((id) => next.add(id));
    }
    onSelectedChange(next);
  }, [payouts, selectedIds, onSelectedChange]);

  const handleComplete = async () => {
    if (!completeModal) return;
    try {
      await markAsCompleted(completeModal);
      setCompleteModal(null);
      onStatusChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(`Error al completar retiro: ${message}`);
    }
  };

  const handleRevert = async () => {
    if (!revertModal) return;
    try {
      await revertToPending(revertModal);
      setRevertModal(null);
      onStatusChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(`Error al revertir retiro: ${message}`);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectModal) return;
    try {
      await rejectPayout({ id: rejectModal, reason });
      setRejectModal(null);
      onStatusChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(`Error al rechazar retiro: ${message}`);
    }
  };

  const columns: ColumnDef<PayoutOverviewRow>[] = useMemo(
    () => [
      {
        id: 'select',
        header: () => {
          const pendingIds = payouts
            .filter((p) => p.status === 'pending')
            .map((p) => p.id);
          const allSelected =
            pendingIds.length > 0 &&
            pendingIds.every((id) => selectedIds.has(id));
          const someSelected = pendingIds.some((id) => selectedIds.has(id));

          return (
            <input
              type="checkbox"
              className="rounded border-white/20 bg-night text-lion focus:ring-lion cursor-pointer"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={toggleAllPending}
              aria-label="Seleccionar todos los pendientes"
            />
          );
        },
        cell: ({ row }) => {
          const isPending = row.original.status === 'pending';
          return (
            <input
              type="checkbox"
              className="rounded border-white/20 bg-night text-lion focus:ring-lion cursor-pointer disabled:opacity-30"
              disabled={!isPending}
              checked={selectedIds.has(row.original.id)}
              onChange={() => toggleRow(row.original.id)}
              aria-label={`Seleccionar retiro ${row.original.seller_name}`}
            />
          );
        },
      },
      {
        accessorKey: 'seller_name',
        header: 'Vendedor',
        cell: ({ getValue }) => (
          <span className="text-sm font-bold text-platinum">
            {getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Monto',
        cell: ({ getValue }) => (
          <span className="text-sm font-bold text-platinum">
            {formatCurrency((getValue() as number) ?? 0)}
          </span>
        ),
      },
      {
        id: 'bank',
        header: 'Banco',
        cell: ({ row }) => {
          const { bank_name, clabe, is_verified } = row.original;
          const last3 = clabe?.slice(-3) ?? '---';
          return (
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-light">
                {bank_name} •••{last3}
              </span>
              {!is_verified && (
                <span
                  title="Cuenta bancaria no verificada"
                  className="text-fire cursor-help"
                >
                  <AlertTriangle size={14} />
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'requested_at',
        header: 'Fecha',
        cell: ({ getValue }) => {
          const date = getValue() as string | null;
          return (
            <span className="text-xs text-blue-light">
              {date ? new Date(date).toLocaleDateString() : '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Estatus',
        cell: ({ getValue }) => (
          <StatusBadge status={(getValue() ?? 'pending') as StatusType} />
        ),
      },
      {
        id: 'actions',
        header: 'Acción',
        cell: ({ row }) => {
          const { status, id, processed_by_name, completed_at, rejected_reason } =
            row.original;

          if (status === 'completed') {
            return (
              <div className="text-xs text-blue-light space-y-0.5">
                <p>
                  Por: <span className="text-platinum">{processed_by_name || '—'}</span>
                </p>
                <p>
                  {completed_at
                    ? new Date(completed_at).toLocaleDateString()
                    : '—'}
                </p>
              </div>
            );
          }

          if (status === 'rejected') {
            return (
              <p className="text-xs text-fire truncate max-w-[180px]">
                {rejected_reason || '—'}
              </p>
            );
          }

          return (
            <div className="flex items-center gap-2">
              {status === 'processing' && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCompleteModal(id);
                    }}
                    disabled={isMutating}
                    title="Completar retiro"
                    className="p-1.5 bg-forest/10 text-forest rounded-lg hover:bg-forest hover:text-night transition-all active:scale-95 disabled:opacity-50"
                  >
                    <CheckCircle2 size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRevertModal(id);
                    }}
                    disabled={isMutating}
                    title="Revertir a pendiente"
                    className="p-1.5 bg-blue-light/10 text-blue-light rounded-lg hover:bg-blue-light hover:text-night transition-all active:scale-95 disabled:opacity-50"
                  >
                    <RotateCcw size={16} />
                  </button>
                </>
              )}
              {status === 'pending' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Single-row process: select it then parent can generate file
                    toggleRow(id);
                  }}
                  disabled={isMutating}
                  title="Seleccionar para procesar"
                  className="p-1.5 bg-lion/10 text-lion rounded-lg hover:bg-lion hover:text-night transition-all active:scale-95 disabled:opacity-50"
                >
                  <FileText size={16} />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRejectModal(id);
                }}
                disabled={isMutating}
                title="Rechazar retiro"
                className="p-1.5 bg-fire/10 text-fire rounded-lg hover:bg-fire hover:text-night transition-all active:scale-95 disabled:opacity-50"
              >
                <XCircle size={16} />
              </button>
            </div>
          );
        },
      },
    ],
    [payouts, selectedIds, toggleRow, toggleAllPending, isMutating],
  );

  if (isLoading) {
    return (
      <DataTable<PayoutOverviewRow>
        columns={columns}
        data={[]}
        isLoading={true}
        skeletonRowCount={5}
      />
    );
  }

  if (payouts.length === 0) {
    return (
      <div className="p-20 text-center flex flex-col items-center bg-state-gray rounded-3xl border border-white/5">
        <FileText size={48} className="text-blue-light/10 mb-4" />
        <p className="text-sm text-blue-light italic">
          No hay retiros que coincidan con los filtros.
        </p>
      </div>
    );
  }

  return (
    <>
      <DataTable<PayoutOverviewRow>
        columns={columns}
        data={payouts}
        emptyMessage="No hay retiros que coincidan con los filtros."
      />

      <ConfirmModal
        isOpen={!!completeModal}
        onClose={() => setCompleteModal(null)}
        onConfirm={handleComplete}
        title="Confirmar Completado"
        description="¿Marcar este retiro como completado? Esta acción indica que el dinero ya fue transferido al vendedor."
        confirmLabel="Completar"
        type="success"
        isLoading={isMutating}
      />

      <ConfirmModal
        isOpen={!!revertModal}
        onClose={() => setRevertModal(null)}
        onConfirm={handleRevert}
        title="Revertir a Pendiente"
        description="¿Estás seguro? El retiro volverá al estado pendiente y podrá ser procesado nuevamente."
        confirmLabel="Revertir"
        type="danger"
        isLoading={isMutating}
      />

      <InputModal
        isOpen={!!rejectModal}
        onClose={() => setRejectModal(null)}
        onConfirm={handleReject}
        title="Rechazar Retiro"
        description="Indica el motivo del rechazo. Esta información será visible para el vendedor."
        placeholder="Ej: Datos bancarios incorrectos, CLABE no válida..."
        confirmLabel="Rechazar"
        isLoading={isMutating}
        minLength={5}
      />
    </>
  );
};

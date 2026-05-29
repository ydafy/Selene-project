import { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { ConfirmModal } from '../../ui/ConfirmModal';
import type { PendingProduct } from '@selene/types';

interface LockStatus {
  isLockedByOther: boolean;
  lockerName: string | null;
  lockedSince: string | null;
}

interface VerificationActionsProps {
  product: PendingProduct;
  lockStatus: LockStatus;
  isLocking: boolean;
  resolve: { mutate: (vars: any, options?: any) => void; isPending: boolean };
  onVerdictComplete: () => void;
}

export const VerificationActions = ({
  product,
  lockStatus,
  isLocking,
  resolve,
  onVerdictComplete,
}: VerificationActionsProps) => {
  const [adminNote, setAdminNote] = useState('');
  const [confirmData, setConfirmData] = useState<{
    show: boolean;
    verdict?: 'APPROVE' | 'REJECT' | 'APPROVE_NOTE';
  } | null>(null);

  const handleConfirm = () => {
    if (!confirmData?.verdict) return;

    resolve.mutate(
      {
        id: product.id,
        verdict: confirmData.verdict,
        note: adminNote,
        product,
      },
      {
        onSuccess: () => {
          onVerdictComplete();
          setAdminNote('');
          setConfirmData(null);
        },
      },
    );
  };

  const isDisabled = resolve.isPending || lockStatus.isLockedByOther || isLocking;

  return (
    <>
      <div className="pt-6 border-t border-white/5 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-blue-light uppercase tracking-widest">
            Nota de revisión (Pública para el vendedor)
          </label>
          <textarea
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Escribe aquí el motivo del rechazo o sugerencias de mejora..."
            className="w-full bg-night border border-white/10 rounded-xl p-4 text-sm text-platinum focus:border-lion outline-none transition-all min-h-[100px]"
          />
        </div>

        <div className="flex gap-4">
          <button
            disabled={isDisabled}
            onClick={() =>
              setConfirmData({ show: true, verdict: 'REJECT' })
            }
            className="flex-1 flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-fire/10 text-fire hover:bg-fire/20 transition-all font-bold disabled:opacity-50 outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
          >
            <XCircle size={20} /> Rechazar Producto
          </button>

          <button
            disabled={isDisabled}
            onClick={() =>
              setConfirmData({
                show: true,
                verdict: adminNote ? 'APPROVE_NOTE' : 'APPROVE',
              })
            }
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-4 rounded-xl font-bold text-night transition-all disabled:opacity-50 outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer ${
              adminNote
                ? 'bg-lion hover:bg-lion/90'
                : 'bg-forest hover:bg-forest/90'
            }`}
          >
            {resolve.isPending ? (
              <div className="w-5 h-5 border-2 border-night border-t-transparent animate-spin rounded-full" />
            ) : (
              <>
                <CheckCircle size={20} />
                {adminNote ? 'Aprobar con Nota' : 'Aprobar Producto'}
              </>
            )}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!confirmData?.show}
        onClose={() => setConfirmData(null)}
        isLoading={resolve.isPending}
        type={confirmData?.verdict === 'REJECT' ? 'danger' : 'success'}
        title={
          confirmData?.verdict === 'REJECT'
            ? '¿Rechazar Producto?'
            : '¿Aprobar Producto?'
        }
        description={
          confirmData?.verdict === 'REJECT'
            ? `Estás a punto de rechazar "${product.name}". Se le notificará al vendedor con el motivo: "${adminNote || 'No cumple requisitos'}".`
            : `Vas a publicar "${product.name}" en el marketplace. ${adminNote ? `Se enviará la nota: "${adminNote}"` : ''}`
        }
        confirmLabel={
          confirmData?.verdict === 'REJECT'
            ? 'Confirmar Rechazo'
            : 'Confirmar Aprobación'
        }
        onConfirm={handleConfirm}
      />
    </>
  );
};

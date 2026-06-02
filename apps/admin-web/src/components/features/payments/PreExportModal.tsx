import { CheckCircle2, AlertTriangle, XCircle, FileDown } from 'lucide-react';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import type { PayoutOverviewRow } from '../../../hooks/usePayoutRequests';
import { validateCLABE } from '../../../lib/bbva/validateCLABE';
import { getBankCode } from '../../../lib/bbva/bankCodes';

interface PreExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  payouts: PayoutOverviewRow[];
  selectedIds: Set<string>;
  isLoading?: boolean;
}

interface ValidationItem {
  payout: PayoutOverviewRow;
  status: 'valid' | 'warning' | 'error';
  messages: string[];
}

function validatePayouts(
  payouts: PayoutOverviewRow[],
  selectedIds: Set<string>,
): {
  items: ValidationItem[];
  totalAmount: number;
  hasErrors: boolean;
  hasWarnings: boolean;
} {
  const selected = payouts.filter((p) => selectedIds.has(p.id));
  const items: ValidationItem[] = [];
  const refs = new Set<string>();
  let hasErrors = false;
  let hasWarnings = false;
  let totalAmount = 0;

  for (const payout of selected) {
    const messages: string[] = [];

    // CLABE validation
    const clabeResult = validateCLABE(payout.clabe);
    if (!clabeResult.valid) {
      messages.push(clabeResult.error || 'CLABE inválida');
    }

    // Bank validation
    try {
      getBankCode(payout.bank_name);
    } catch {
      messages.push('Banco no soportado');
    }

    // Duplicate reference check
    if (refs.has(payout.id)) {
      messages.push('Referencia duplicada');
    } else {
      refs.add(payout.id);
    }

    let status: 'valid' | 'warning' | 'error' = 'valid';
    if (messages.length > 0) {
      status = 'error';
      hasErrors = true;
    } else if (!payout.is_verified) {
      status = 'warning';
      hasWarnings = true;
      messages.push('Cuenta no verificada');
    }

    totalAmount += payout.amount;
    items.push({ payout, status, messages });
  }

  return { items, totalAmount, hasErrors, hasWarnings };
}

export const PreExportModal = ({
  isOpen,
  onClose,
  onConfirm,
  payouts,
  selectedIds,
  isLoading,
}: PreExportModalProps) => {
  if (!isOpen) return null;

  const { items, totalAmount, hasErrors, hasWarnings } = validatePayouts(
    payouts,
    selectedIds,
  );

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-night/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg bg-state-gray border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
        <div className="p-6 border-b border-white/10">
          <h3 className="text-xl font-bold text-platinum mb-1">
            Validación Pre-Exportación
          </h3>
          <p className="text-sm text-blue-light">
            Revisa los retiros seleccionados antes de generar el archivo BBVA.
          </p>
        </div>

        <div className="overflow-y-auto p-6 space-y-3">
          {items.map((item) => (
            <div
              key={item.payout.id}
              className={`p-3 rounded-xl border ${
                item.status === 'error'
                  ? 'bg-fire/5 border-fire/20'
                  : item.status === 'warning'
                    ? 'bg-lion/5 border-lion/20'
                    : 'bg-forest/5 border-forest/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {item.status === 'error' ? (
                    <XCircle size={18} className="text-fire" />
                  ) : item.status === 'warning' ? (
                    <AlertTriangle size={18} className="text-lion" />
                  ) : (
                    <CheckCircle2 size={18} className="text-forest" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-bold text-platinum truncate">
                      {item.payout.seller_name}
                    </p>
                    <span className="text-sm font-bold text-platinum shrink-0">
                      {formatCurrency(item.payout.amount)}
                    </span>
                  </div>
                  <p className="text-xs text-blue-light mt-0.5">
                    {item.payout.bank_name} •••{item.payout.clabe.slice(-3)}
                  </p>
                  {item.messages.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {item.messages.map((msg, i) => (
                        <li
                          key={i}
                          className={`text-xs ${
                            item.status === 'error' ? 'text-fire' : 'text-lion'
                          }`}
                        >
                          {msg}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-white/10 bg-night/30">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-xs text-blue-light">Retiros seleccionados</p>
              <p className="text-sm font-bold text-platinum">{items.length}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-blue-light">Monto total</p>
              <p className="text-lg font-bold text-lion">
                {formatCurrency(totalAmount)}
              </p>
            </div>
          </div>

          {hasErrors && (
            <p className="text-xs text-fire mb-4">
              Corrige los errores o deselecciona las filas inválidas para
              continuar.
            </p>
          )}
          {hasWarnings && !hasErrors && (
            <p className="text-xs text-lion mb-4">
              Algunas cuentas no están verificadas. Puedes continuar, pero
              verifica los datos.
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-platinum font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading || hasErrors}
              className="flex-1 px-4 py-2 rounded-xl bg-lion text-night font-bold transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-night border-t-transparent animate-spin rounded-full" />
              ) : (
                <>
                  <FileDown size={16} />
                  Confirmar y Exportar
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

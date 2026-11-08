import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  type: 'success' | 'danger';
  isLoading?: boolean;
}

export const ConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  type,
  isLoading,
}: Props) => {
  if (!isOpen) return null;

  const isDanger = type === 'danger';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      {/* Backdrop con desenfoque */}
      <div
        className="absolute inset-0 bg-night/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card del Modal */}
      <div className="relative w-full max-w-md bg-state-gray border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <div
              className={`p-3 rounded-full ${isDanger ? 'bg-fire/10 text-fire' : 'bg-forest/10 text-forest'}`}
            >
              {isDanger ? (
                <AlertTriangle size={24} />
              ) : (
                <CheckCircle2 size={24} />
              )}
            </div>
            <h3 className="text-xl font-bold text-platinum">{title}</h3>
          </div>

          <p className="text-blue-light text-sm leading-relaxed mb-6">
            {description}
          </p>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-platinum font-semibold transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`flex-1 px-4 py-2 rounded-xl font-bold text-night transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 ${
                isDanger
                  ? 'bg-fire hover:bg-fire/90'
                  : 'bg-forest hover:bg-forest/90'
              }`}
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-night border-t-transparent animate-spin rounded-full" />
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

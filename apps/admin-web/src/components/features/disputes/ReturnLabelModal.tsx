import { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { note: string; tracking: string; url: string }) => void;
  isLoading: boolean;
}

export const ReturnLabelModal = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}: Props) => {
  const [form, setForm] = useState({ note: '', tracking: '', url: '' });

  if (!isOpen) return null;

  const isInvalid =
    !form.note.trim() || !form.tracking.trim() || !form.url.trim();

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-night/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg bg-state-gray border border-white/10 rounded-3xl shadow-2xl p-8 animate-in zoom-in-95 duration-200">
        <h3 className="text-2xl font-bold text-platinum mb-2">
          Iniciar Devolución
        </h3>
        <p className="text-sm text-blue-light mb-6">
          El comprador recibirá estas instrucciones y la guía para enviar el
          producto de vuelta.
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-lion uppercase tracking-widest mb-1 block">
              Sentencia / Instrucciones
            </label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Explica por qué procede la devolución..."
              className="w-full bg-night border border-white/10 rounded-xl p-3 text-sm text-platinum focus:border-lion outline-none min-h-[100px]"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-lion uppercase tracking-widest mb-1 block">
                Número de Guía
              </label>
              <input
                type="text"
                value={form.tracking}
                onChange={(e) => setForm({ ...form, tracking: e.target.value })}
                placeholder="Ej: 1Z999..."
                className="w-full bg-night border border-white/10 rounded-xl p-3 text-sm text-platinum focus:border-lion outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-lion uppercase tracking-widest mb-1 block">
                URL del PDF (Envia.com)
              </label>
              <input
                type="text"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://..."
                className="w-full bg-night border border-white/10 rounded-xl p-3 text-sm text-platinum focus:border-lion outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-platinum font-semibold hover:bg-white/10 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(form)}
            disabled={isLoading || isInvalid}
            className="flex-[2] px-4 py-3 rounded-xl bg-lion text-night font-bold disabled:opacity-30 transition-all shadow-lg shadow-lion/10"
          >
            {isLoading ? 'Procesando...' : 'Autorizar Devolución'}
          </button>
        </div>
      </div>
    </div>
  );
};

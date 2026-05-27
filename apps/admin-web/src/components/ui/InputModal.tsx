import { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  isLoading?: boolean;
}

export const InputModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  placeholder,
  confirmLabel,
  isLoading,
}: Props) => {
  const [value, setValue] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-night/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md bg-state-gray border border-white/10 rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
        <h3 className="text-xl font-bold text-platinum mb-2">{title}</h3>
        <p className="text-sm text-blue-light mb-4">{description}</p>

        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-night border border-white/10 rounded-xl p-4 text-sm text-platinum focus:border-lion outline-none mb-6 min-h-[100px]"
        />

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl bg-white/5 text-platinum font-semibold"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              onConfirm(value);
              setValue('');
            }}
            disabled={isLoading || !value.trim()}
            className="flex-1 px-4 py-2 rounded-xl bg-lion text-night font-bold disabled:opacity-50"
          >
            {isLoading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

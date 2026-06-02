import { useState, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  isLoading?: boolean;
  minLength?: number;
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
  minLength,
}: Props) => {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!isOpen) setValue('');
  }, [isOpen]);

  const trimmed = value.trim();
  const isTooShort = minLength !== undefined && trimmed.length > 0 && trimmed.length < minLength;
  const isValid = trimmed.length > 0 && (minLength === undefined || trimmed.length >= minLength);

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
          className={`w-full bg-night border rounded-xl p-4 text-sm text-platinum focus:border-lion outline-none mb-2 min-h-[100px] ${
            isTooShort ? 'border-fire' : 'border-white/10'
          }`}
        />

        {isTooShort && (
          <p className="text-xs text-fire mb-4">
            El motivo debe tener al menos {minLength} caracteres.
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl bg-white/5 text-platinum font-semibold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              onConfirm(value);
              setValue('');
            }}
            disabled={isLoading || !isValid}
            className="flex-1 px-4 py-2 rounded-xl bg-lion text-night font-bold disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

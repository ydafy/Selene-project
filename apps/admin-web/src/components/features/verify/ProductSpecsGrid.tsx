import { useState } from 'react';
import { Hash, Copy, Check } from 'lucide-react';

interface Props {
  specs?: Record<string, any>;
}

export const ProductSpecsGrid = ({ specs }: Props) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!specs || Object.keys(specs).length === 0) {
    return (
      <div className="p-4 bg-night/30 rounded-xl border border-dashed border-white/10 text-center">
        <p className="text-xs text-blue-light italic">
          No hay especificaciones técnicas registradas.
        </p>
      </div>
    );
  }

  const formatKey = (key: string) => {
    return key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);

    // Feedback háptico visual: regresamos al icono de copiar tras 2 segundos
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {Object.entries(specs).map(([key, value]) => {
        const isCopied = copiedKey === key;
        const stringValue = String(value);

        return (
          <button
            key={key}
            onClick={() => handleCopy(key, stringValue)}
            className={`group relative text-left bg-night/50 p-3 rounded-xl border transition-all hover:border-lion/50 active:scale-95 ${
              isCopied ? 'border-forest/50 bg-forest/5' : 'border-white/5'
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <span className="text-[10px] font-bold text-blue-light uppercase tracking-wider flex items-center gap-1">
                <Hash size={10} /> {formatKey(key)}
              </span>

              {/* Icono de Copiado Dinámico */}
              <div
                className={`transition-all ${isCopied ? 'text-forest' : 'text-blue-light opacity-0 group-hover:opacity-100'}`}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
              </div>
            </div>

            <span
              className={`text-sm font-medium truncate block ${isCopied ? 'text-forest' : 'text-platinum'}`}
            >
              {stringValue}
            </span>

            {/* Tooltip sutil */}
            {isCopied && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-forest text-night text-[8px] font-bold px-2 py-0.5 rounded-full animate-bounce">
                COPIADO
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

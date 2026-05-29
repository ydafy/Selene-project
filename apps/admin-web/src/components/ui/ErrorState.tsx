import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  title?: string;
  message?: string;
  onRetry: () => void;
}

export const ErrorState = ({
  title = 'Error de Conexión',
  message = 'No pudimos obtener los datos de la base de datos. Por favor, verifica tu conexión o intenta de nuevo.',
  onRetry,
}: Props) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 bg-state-gray/30 rounded-3xl border border-fire/10 border-dashed animate-in fade-in duration-300">
      <div className="p-4 bg-fire/10 rounded-full mb-4">
        <AlertCircle size={40} className="text-fire" />
      </div>

      <h3 className="text-xl font-bold text-platinum mb-2">{title}</h3>
      <p className="text-sm text-blue-light text-center max-w-md mb-8 leading-relaxed">
        {message}
      </p>

      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-platinum font-semibold transition-all active:scale-95 group outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
      >
        <RefreshCcw
          size={18}
          className="group-hover:rotate-180 transition-transform duration-500"
        />
        Reintentar Carga
      </button>
    </div>
  );
};

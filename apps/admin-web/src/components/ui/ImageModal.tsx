import { useState } from 'react';
import { X, ZoomIn, ZoomOut, Download } from 'lucide-react';

interface Props {
  url: string | null;
  onClose: () => void;
}

export const ImageModal = ({ url, onClose }: Props) => {
  const [isZoomed, setIsZoomed] = useState(false);

  if (!url) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-night/98 animate-in fade-in duration-200">
      {/* BARRA DE HERRAMIENTAS SUPERIOR */}
      <div className="flex justify-between items-center p-4 border-b border-white/5 bg-state-gray/50">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
          <span className="text-sm font-medium text-blue-light">
            Modo Inspección Técnica
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsZoomed(!isZoomed)}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm"
          >
            {isZoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
            {isZoomed ? 'Ajustar' : 'Tamaño Real'}
          </button>
          <a
            href={url}
            download
            target="_blank"
            className="p-2 bg-lion/10 text-lion hover:bg-lion/20 rounded-lg transition-colors"
          >
            <Download size={20} />
          </a>
        </div>
      </div>

      {/* CONTENEDOR DE IMAGEN */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <img
          src={url}
          className={`transition-all duration-300 shadow-2xl rounded-sm ${
            isZoomed
              ? 'max-w-none cursor-zoom-out'
              : 'max-w-full max-h-full object-contain cursor-zoom-in'
          }`}
          onClick={() => setIsZoomed(!isZoomed)}
          alt="Evidencia"
        />
      </div>
    </div>
  );
};

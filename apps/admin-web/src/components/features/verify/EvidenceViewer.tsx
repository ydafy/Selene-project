import {
  Eye,
  TrendingUp,
  ImageIcon,
  Maximize2,
  FileQuestion,
} from 'lucide-react';
import { SecureImage } from '../../ui/SecureImage';
import type { VerificationData } from '@selene/types';

interface EvidenceViewerProps {
  verificationData: VerificationData | Record<string, unknown> | null;
  images: string[];
  onImageClick: (url: string) => void;
}

export const EvidenceViewer = ({
  verificationData,
  images,
  onImageClick,
}: EvidenceViewerProps) => {
  // Tipado seguro con la interfaz real de Selene (sin ningún 'any')
  const vData = (verificationData || {}) as Partial<VerificationData>;

  return (
    <div className="space-y-6">
      {/* 1. GALERÍA DE EVIDENCIA TÉCNICA */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Prueba Física con Papelito */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-blue-light flex items-center gap-2">
            <Eye size={14} /> Prueba Física (Papelito con Usuario)
          </p>
          <div className="aspect-video bg-night rounded-xl overflow-hidden border border-white/5 flex items-center justify-center relative">
            {vData.proof_physical ? (
              <SecureImage
                path={vData.proof_physical}
                alt="Prueba física"
                className="w-full h-full object-contain cursor-pointer hover:scale-105 transition-transform"
                onClick={(url) => onImageClick(url)}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <FileQuestion size={24} />
                <span className="text-xs">Sin prueba física</span>
              </div>
            )}
          </div>
        </div>

        {/* Prueba de Rendimiento / Benchmark */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-blue-light flex items-center gap-2">
            <TrendingUp size={14} /> Rendimiento (Benchmark / FurMark)
          </p>
          <div className="aspect-video bg-night rounded-xl overflow-hidden border border-white/5 relative flex items-center justify-center">
            {vData.proof_performance ? (
              <>
                <SecureImage
                  path={vData.proof_performance}
                  className="w-full h-full object-contain cursor-pointer hover:scale-105 transition-transform"
                  alt="Benchmark"
                  onClick={(url) => onImageClick(url)}
                />
                {typeof vData.benchmark_score === 'number' && (
                  <div className="absolute bottom-3 right-3 bg-lion text-night px-3 py-1 rounded-lg font-bold text-xs shadow-2xl">
                    Score: {vData.benchmark_score}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <FileQuestion size={24} />
                <span className="text-xs">Sin benchmark adjunto</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. GALERÍA PÚBLICA DE VENTA */}
      <div className="space-y-3 pt-4 border-t border-white/5">
        <h5 className="text-xs font-bold text-blue-light uppercase tracking-widest flex items-center gap-2">
          <ImageIcon size={14} /> Galería de Venta (Pública)
        </h5>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {images?.map((img: string, index: number) => (
            <div
              key={index}
              className="w-24 h-24 shrink-0 bg-night rounded-xl overflow-hidden border border-white/5 relative group"
            >
              <SecureImage
                path={img}
                className="w-full h-full object-cover"
                alt={`Foto de venta ${index + 1}`}
              />
              <button
                type="button"
                onClick={() => onImageClick(img)}
                aria-label={`Ampliar foto ${index + 1}`}
                className="absolute inset-0 bg-night/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all cursor-pointer"
              >
                <Maximize2 size={16} className="text-platinum" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

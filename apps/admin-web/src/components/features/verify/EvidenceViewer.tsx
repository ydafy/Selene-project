import { Eye, TrendingUp, ImageIcon, Maximize2 } from 'lucide-react';
import { SecureImage } from '../../ui/SecureImage';

interface EvidenceViewerProps {
  verificationData: Record<string, unknown> | null;
  images: string[];
  onImageClick: (url: string) => void;
}

export const EvidenceViewer = ({
  verificationData,
  images,
  onImageClick,
}: EvidenceViewerProps) => {
  const vData = verificationData || {};

  return (
    <div className="space-y-6">
      {/* 1. GALERÍA DE EVIDENCIA TÉCNICA */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-blue-light flex items-center gap-2">
            <Eye size={14} /> Prueba Física (Papelito)
          </p>
          <div className="aspect-video bg-night rounded-xl overflow-hidden border border-white/5 flex items-center justify-center">
            <SecureImage
              path={
                typeof (vData as any)?.proof_physical === 'string'
                  ? (vData as any).proof_physical
                  : ''
              }
              alt="Prueba física"
              className="w-full h-full object-contain"
              onClick={(url) => onImageClick(url)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-blue-light flex items-center gap-2">
            <TrendingUp size={14} /> Rendimiento (Benchmark)
          </p>
          <div className="aspect-video bg-night rounded-xl overflow-hidden border border-white/5 relative flex items-center justify-center">
            <SecureImage
              path={
                typeof (vData as any)?.proof_performance === 'string'
                  ? (vData as any).proof_performance
                  : ''
              }
              className="w-full h-full object-contain"
              alt="Benchmark"
              onClick={(url) => onImageClick(url)}
            />
            {typeof (vData as any)?.benchmark_score === 'number' && (
              <div className="absolute bottom-3 right-3 bg-lion text-night px-3 py-1 rounded-lg font-bold text-sm shadow-2xl">
                Score: {(vData as any).benchmark_score}
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
              className="w-24 h-24 flex-shrink-0 bg-night rounded-xl overflow-hidden border border-white/5 relative group"
            >
              <img
                src={img}
                className="w-full h-full object-cover"
                alt={`Venta ${index}`}
              />
              <button
                onClick={() => onImageClick(img)}
                className="absolute inset-0 bg-night/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all"
              >
                <Maximize2 size={14} className="text-platinum" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Maximize2 } from 'lucide-react';
import { getStoragePath } from '../../lib/utils/StoragePath';

interface Props {
  path: string;
  alt: string;
  className?: string;
  onClick?: (url: string) => void;
  bucket?: string; // <--- Propiedad opcional
}

// FIX: Pasamos 'bucket' como prop con un default
export const SecureImage = ({
  path,
  alt,
  className,
  onClick,
  bucket = 'verification',
}: Props) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) { setError(true); return; }
    const getSignedUrl = async () => {
      const cleanPath = getStoragePath(path, bucket);
      const { data } = await supabase.storage
        .from(bucket)
        .createSignedUrl(cleanPath, 3600);
      if (data) {
        setUrl(data.signedUrl);
      } else {
        setError(true);
      }
    };
    getSignedUrl();
  }, [path, bucket]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-white/5 ${className}`}>
        <span className="text-blue-light text-xs">No disponible</span>
      </div>
    );
  }
  if (!url) return <div className={`animate-pulse bg-white/5 ${className}`} />;

  return (
    <div className="relative group w-full h-full">
      <img src={url} alt={alt} className={className} onError={() => setError(true)} />

      {/* Overlay sutil que indica que es clickeable */}
      <button
        onClick={() => onClick?.(url)}
        className="absolute inset-0 bg-lion/10 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all cursor-zoom-in"
      >
        <div className="bg-night/80 p-3 rounded-full border border-lion/50 shadow-2xl transform scale-90 group-hover:scale-100 transition-transform">
          <Maximize2 className="text-lion" size={24} />
        </div>
      </button>
    </div>
  );
};

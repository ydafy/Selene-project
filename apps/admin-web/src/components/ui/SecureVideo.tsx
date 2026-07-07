import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getStoragePath } from '../../lib/utils/StoragePath';

interface Props {
  path: string;
  className?: string;
  bucket?: string;
}

export const SecureVideo = ({
  path,
  className,
  bucket = 'evidence',
}: Props) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // --- Resetear estado durante la fase de Render ---
  // Oficial de React. Evita disparar efectos secundarios para limpiar estados.
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setUrl(null); // Limpiamos la URL vieja al instante
    setError(false); // Limpiamos el error viejo al instante
  }

  // Estados derivados (Ultra performantes)
  const isError = !path || error;
  const loading = !url && !isError; // Estamos cargando si no hay URL y no hay error

  useEffect(() => {
    if (!path) return;

    let isCurrent = true;

    const getSignedUrl = async () => {
      try {
        const cleanPath = getStoragePath(path, bucket);
        const { data, error: err } = await supabase.storage
          .from(bucket)
          .createSignedUrl(cleanPath, 3600);

        if (!isCurrent) return;

        if (err || !data) {
          setError(true);
        } else {
          setUrl(data.signedUrl);
        }
      } catch (e) {
        console.error('[SecureVideo Error] Falló la firma del video:', e);
        if (isCurrent) setError(true);
      }
    };

    getSignedUrl();

    return () => {
      isCurrent = false;
    };
  }, [path, bucket]);

  if (isError) {
    return (
      <div
        className={`flex items-center justify-center bg-white/5 ${className}`}
      >
        <span className="text-blue-light text-xs">No disponible</span>
      </div>
    );
  }

  if (loading) {
    return <div className={`animate-pulse bg-white/5 ${className}`} />;
  }

  return (
    <video
      src={url!}
      controls
      className={className}
      controlsList="nodownload"
      onError={() => setError(true)}
    />
  );
};

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
    <video src={url} controls className={className} controlsList="nodownload" onError={() => setError(true)} />
  );
};

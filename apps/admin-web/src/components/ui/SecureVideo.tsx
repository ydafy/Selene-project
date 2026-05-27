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

  useEffect(() => {
    if (!path) return;
    const getSignedUrl = async () => {
      const cleanPath = getStoragePath(path, bucket);
      const { data } = await supabase.storage

        .from(bucket) // <--- USAR PROP
        .createSignedUrl(cleanPath, 3600);
      if (data) setUrl(data.signedUrl);
    };
    getSignedUrl();
  }, [path, bucket]); // <--- DEPENDENCIAS

  if (!url) return <div className={`animate-pulse bg-white/5 ${className}`} />;

  return (
    <video src={url} controls className={className} controlsList="nodownload" />
  );
};

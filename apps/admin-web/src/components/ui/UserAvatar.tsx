import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  path?: string;
  fallback: string;
  size?: 'sm' | 'md';
}

export const UserAvatar = ({ path, fallback, size = 'sm' }: Props) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const dimensions =
    size === 'sm' ? 'w-5 h-5 text-[10px]' : 'w-10 h-10 text-sm';

  // LÓGICA DE ESTADO DERIVADO (MVP++):
  // Si el path empieza con http, es una URL externa (Google). La usamos directo.
  // Si no, usamos el signedUrl que obtendremos de Supabase.
  const isExternal = path?.startsWith('http');
  const finalUrl = isExternal ? path : signedUrl;

  useEffect(() => {
    // Solo ejecutamos el efecto si el path es interno (Supabase)
    if (!path || isExternal) return;

    const getAvatar = async () => {
      try {
        const { data, error } = await supabase.storage
          .from('Avatars')
          .createSignedUrl(path, 3600);

        if (error) throw error;
        if (data) setSignedUrl(data.signedUrl);
      } catch (err) {
        console.error('Error cargando avatar interno:', err);
      }
    };

    getAvatar();
  }, [path, isExternal]);

  if (!finalUrl) {
    return (
      <div
        className={`${dimensions} rounded-full bg-white/10 flex items-center justify-center font-bold text-blue-light uppercase`}
      >
        {fallback[0] || 'U'}
      </div>
    );
  }

  return (
    <img
      src={finalUrl}
      className={`${dimensions} rounded-full object-cover border border-white/10`}
      alt="Avatar"
      onError={() => setSignedUrl(null)} // Fallback si la imagen falla
    />
  );
};

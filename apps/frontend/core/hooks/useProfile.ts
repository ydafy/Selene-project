import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

// Definimos el tipo para un perfil público
export type PublicProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
};

const fetchProfileById = async (id: string): Promise<PublicProfile> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, created_at')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);

  return data as PublicProfile;
};

export const useProfile = (userId: string) => {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfileById(userId),
    enabled: !!userId, // Solo ejecuta si hay un ID
  });
};

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { UserRole } from '@selene/types'; // Importa el tipo que creamos antes

// Actualizamos el tipo local
export type PublicProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  role: UserRole; // <--- NUEVO CAMPO
};

const fetchProfileById = async (id: string): Promise<PublicProfile> => {
  const { data, error } = await supabase
    .from('profiles')
    // Agregamos 'role' a la selección
    .select('id, username, avatar_url, created_at, role')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);

  return data as PublicProfile;
};

export const useProfile = (userId: string) => {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfileById(userId),
    enabled: !!userId,
  });
};

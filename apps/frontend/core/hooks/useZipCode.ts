import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

export interface ZipLocationResult {
  state_code: string;
  state_name: string;
  city: string;
  districts: string[];
}

export const useZipCode = (zip: string) => {
  return useQuery({
    queryKey: ['zipcode', zip],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_get_location_by_zip', {
        p_zip: zip,
      });

      if (error) throw error;

      // Retornamos el primer resultado (Estado y Ciudad únicos) con su array de colonias
      return (data?.[0] as ZipLocationResult) || null;
    },
    enabled: zip.length === 5, // Solo dispara la búsqueda cuando el CP está completo
    staleTime: 1000 * 60 * 60, // 1 hora de caché (los CPs no cambian)
  });
};

/**
 * @file core/hooks/useSystemConfig.ts
 * @description Hook para obtener la configuración global del sistema (Comisiones, Mantenimiento).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

export interface PackagePreset {
  category: string;
  label: string;
  length: number;
  width: number;
  height: number;
  weight: number;
}

export type PackagePresetsMap = Record<string, PackagePreset>;

export const useSystemConfig = () => {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) throw error;
      return data;
    },
    staleTime: 1000 * 60 * 15,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 60,
  });
};

/**
 * @file shared/hooks/use-system-config.ts
 * @description Hook para obtener la configuración global del sistema (Comisiones, Mantenimiento).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface PackagePreset {
  category: string;
  label: string;
  length: number;
  width: number;
  height: number;
  weight: number;
}

export type PackagePresetsMap = Record<string, PackagePreset>;

// Clients hold SELECT only on these columns (supabase/schemas/public/tables/
// system_settings.sql); add a column here and to its grant together.
const SYSTEM_CONFIG_COLUMNS =
  'id, is_maintenance, min_version_android, min_version_ios, service_fee_pct, insurance_rate, shipping_buffer_cents, package_presets, order_expiration_hours, preparing_expiration_hours' as const;

export const useSystemConfig = () => {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select(SYSTEM_CONFIG_COLUMNS)
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

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const useAuditLogs = () => {
  return useQuery({
    queryKey: ['admin-audit-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select(
          `
          *,
         admin:profiles(username, avatar_url)
        `,
        )
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // Refrescar cada minuto
  });
};

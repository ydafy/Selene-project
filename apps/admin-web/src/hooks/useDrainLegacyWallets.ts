import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface DrainLegacyWalletsResult {
  success: boolean;
  dryRun?: boolean;
  transferredCount?: number;
  transferredCents?: number;
  failedCount?: number;
  skippedCount?: number;
  error?: string;
}

export function useDrainLegacyWallets() {
  return useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      const { data, error } = await supabase.functions.invoke(
        'drain-legacy-wallets',
        { body: { dryRun } },
      );
      if (error) throw error;
      return data as DrainLegacyWalletsResult;
    },
  });
}

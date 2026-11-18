import { useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { useAuthContext } from '@/shared/lib/auth/auth-provider';
import {
  buildReportInsert,
  reportOutcome,
  type ReportOutcome,
  type ReportReason,
  type ReportTarget,
} from './use-moderation.logic';

export const useModeration = () => {
  const { session } = useAuthContext();
  const [loading, setLoading] = useState(false);

  const reportEntity = async ({
    target,
    reason,
    details,
  }: {
    target: ReportTarget;
    reason: ReportReason;
    details?: string;
  }): Promise<ReportOutcome> => {
    if (!session) return 'error';

    setLoading(true);
    try {
      // A plain insert: `authenticated` cannot SELECT reports, so asking for
      // the inserted row (`.select()`) would fail with 42501.
      const { error } = await supabase.from('reports').insert(
        buildReportInsert({
          reporterId: session.user.id,
          target,
          reason,
          details,
        }),
      );
      return reportOutcome(error);
    } catch {
      return 'error';
    } finally {
      setLoading(false);
    }
  };

  const blockUser = async (userIdToBlock: string) => {
    if (!session) return { error: 'not_logged_in' };

    setLoading(true);
    const { error } = await supabase.from('blocked_users').insert({
      blocker_id: session.user.id,
      blocked_id: userIdToBlock,
    });
    setLoading(false);

    return { error };
  };

  return { reportEntity, blockUser, loading };
};

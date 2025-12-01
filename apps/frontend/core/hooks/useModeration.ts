import { useState } from 'react';
import { supabase } from '../db/supabase';
import { useAuthContext } from '../../components/auth/AuthProvider';
export const useModeration = () => {
  const { session } = useAuthContext();
  const [loading, setLoading] = useState(false);

  const reportEntity = async (targetId: string, type: 'product' | 'user') => {
    if (!session) return { error: 'not_logged_in' };

    setLoading(true);
    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_id: targetId,
      target_type: type,
    });
    setLoading(false);

    return { error };
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

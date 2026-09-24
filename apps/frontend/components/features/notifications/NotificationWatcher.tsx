import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import Toast from 'react-native-toast-message';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@selene/types';
import { useTranslation } from 'react-i18next';

import { useAuthContext } from '../../../components/auth/AuthProvider';
import { supabase } from '../../../core/db/supabase';
import { invalidateNotificationKeys } from '../../../core/hooks/useNotificationMutations';
import { NotificationLinking } from '../../../core/services/notification';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Box, Text } from '../../base';
import { createLaunchDigestGate, selectLaunchDigest } from './launchDigest';

const LAUNCH_LIMIT = 20;

export const NotificationWatcher = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const { t } = useTranslation(['common', 'notifications']);
  const queryClient = useQueryClient();
  const [digest, setDigest] = useState<{ owner: string; notice: Notification; hasMore: boolean } | null>(null);
  const gate = useRef(createLaunchDigestGate());
  const launchOwner = useRef<string | undefined>(undefined);
  const currentOwner = useRef(userId);
  currentOwner.current = userId;

  const showErrorToast = useCallback(() => {
    Toast.show({
      type: 'error',
      text1: t('common:states.errorTitle'),
      text2: t('common:errors.generic'),
    });
  }, [t]);

  useEffect(() => {
    if (launchOwner.current !== userId) {
      gate.current.reset();
      launchOwner.current = userId;
      setDigest(null);
    }
    if (!userId) return;
    let active = true;
    const attempt = gate.current.begin(userId);
    if (attempt) {
      void (async () => {
        try {
          const { data, error } = await supabase.from('notifications')
            .select('id,user_id,created_at,deleted_at,read,title,message,type,action_path')
            .eq('user_id', userId).is('deleted_at', null).or('read.is.null,read.eq.false')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(LAUNCH_LIMIT);
          if (error) throw error;
          if (!active || currentOwner.current !== userId || !gate.current.complete(attempt)) return;
          const rows = data ?? [];
          const notice = selectLaunchDigest(rows, userId);
          if (notice) setDigest({ owner: userId, notice, hasMore: rows.filter((row) => row.user_id === userId && row.deleted_at === null && row.read !== true).length > 1 });
        } catch (error) {
          if (active && currentOwner.current === userId && gate.current.complete(attempt)) {
            console.error('[NotificationWatcher] Launch fetch error:', error);
            showErrorToast();
          }
        }
      })();
    }

    const channel = supabase.channel(`notifications_realtime_watcher_${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}`,
      }, (payload) => {
        if (!active || currentOwner.current !== userId) return;
        try {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            invalidateNotificationKeys(queryClient, userId);
          }
        } catch (error) {
          console.error('[NotificationWatcher] Payload handler error:', error);
          showErrorToast();
        }
      }).subscribe((status, error) => {
        if (!active || currentOwner.current !== userId) return;
        if (error || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[NotificationWatcher] Subscription error:', error ?? status);
          showErrorToast();
        }
      });
    return () => {
      active = false;
      if (attempt) gate.current.cancel(attempt);
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient, showErrorToast]);

  const current = digest?.owner === userId ? digest : null;
  const dismiss = () => setDigest(null);
  const navigate = (path: string | null) => {
    setDigest(null);
    void NotificationLinking.navigate(path).catch((error) => {
      console.error('[NotificationWatcher] Navigation error:', error);
      showErrorToast();
    });
  };

  if (!current) return null;
  return (
    <ConfirmDialog
      visible title={t('notifications:digestTitle')}
      description={t('notifications:digestDescription')}
      onConfirm={() => navigate(current.notice.action_path)}
      onCancel={dismiss}
      confirmLabel={t('notifications:digestOpen')}
      cancelLabel={t('notifications:digestSkip')}
      icon="bell-outline"
    >
      <Box marginTop="m">
        <Text variant="caption-md" color="textSecondary">{current.notice.title}</Text>
        {current.hasMore && <Text variant="caption-md" color="textSecondary">{t('notifications:digestMore')}</Text>}
        <Pressable accessibilityRole="button" accessible focusable accessibilityLabel={t('notifications:digestInbox')} onPress={() => navigate('/profile/notifications')}>
          <Text color="primary">{t('notifications:digestInbox')}</Text>
        </Pressable>
      </Box>
    </ConfirmDialog>
  );
};

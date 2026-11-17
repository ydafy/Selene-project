import React, { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@selene/types';
import { useTranslation } from 'react-i18next';

import { useAuthContext } from '@/shared/lib/auth/auth-provider';
import { supabase } from '@/shared/lib/supabase';
import { invalidateNotificationKeys } from '../hooks/use-notification-mutations';
import { pushTapRouter } from '../lib/push-tap';
import { NotificationLinking } from '../lib/notification-linking';
import { ConfirmDialog } from '@/shared/ui/feedback/confirm-dialog';
import {
  createLaunchDigestGate,
  scanLaunchDigest,
} from '../logic/launch-digest';

const LAUNCH_LIMIT = 20;

export const NotificationWatcher = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const { t } = useTranslation(['common', 'notifications']);
  const queryClient = useQueryClient();
  const [digest, setDigest] = useState<{
    owner: string;
    notice: Notification;
    hasMore: boolean;
  } | null>(null);
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
          const result = await scanLaunchDigest(
            userId,
            async (cursor) => {
              let query = supabase
                .from('notifications')
                .select('*')
                .eq('user_id', userId)
                .is('deleted_at', null);
              if (cursor) {
                const older = `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
                query = query.or(
                  `and(read.is.null,or(${older})),and(read.eq.false,or(${older}))`,
                );
              } else {
                query = query.or('read.is.null,read.eq.false');
              }
              const { data, error } = await query
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(LAUNCH_LIMIT);
              if (error) throw error;
              return data ?? [];
            },
            LAUNCH_LIMIT,
            () => !active || currentOwner.current !== userId,
          );
          if (
            !active ||
            currentOwner.current !== userId ||
            !result ||
            !gate.current.complete(attempt)
          )
            return;
          // A launch opened by a push tap already shows a notice; skip the digest once.
          const openedByTap = pushTapRouter.consumeLaunchTap();
          if (result.notice && !openedByTap)
            setDigest({
              owner: userId,
              notice: result.notice,
              hasMore: result.hasMore,
            });
        } catch (error) {
          if (
            active &&
            currentOwner.current === userId &&
            gate.current.complete(attempt)
          ) {
            console.error('[NotificationWatcher] Launch fetch error:', error);
            showErrorToast();
          }
        }
      })();
    }

    // A database trigger sends `changed` on this private topic; RLS on
    // realtime.messages lets only the owner join it.
    const channel = supabase
      .channel(`user:${userId}:notifications`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, () => {
        if (!active || currentOwner.current !== userId) return;
        try {
          invalidateNotificationKeys(queryClient, userId);
        } catch (error) {
          console.error('[NotificationWatcher] Payload handler error:', error);
          showErrorToast();
        }
      });
    // A private channel needs the user's JWT on the socket before it joins.
    void supabase.realtime
      .setAuth()
      .catch((error) => {
        console.warn('[NotificationWatcher] Realtime auth', error);
      })
      .then(() => {
        if (!active || currentOwner.current !== userId) return;
        channel.subscribe((status, error) => {
          if (!active || currentOwner.current !== userId) return;
          // supabase-js rejoins by itself; a transient drop is not a user error.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
            console.warn(
              '[NotificationWatcher] Realtime channel',
              status,
              error,
            );
        });
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
      visible
      title={t('notifications:digestTitle')}
      description={t('notifications:digestDescription')}
      onConfirm={() => navigate('/profile/notifications')}
      onCancel={dismiss}
      confirmLabel={t('notifications:digestOpen')}
      cancelLabel={t('notifications:digestSkip')}
      icon="bell-outline"
    />
  );
};

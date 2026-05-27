/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

import { useAuthContext } from '../../../components/auth/AuthProvider';
import { supabase } from '../../../core/db/supabase';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Notification } from '@selene/types';
import { useTranslation } from 'react-i18next';
import { useNotifications } from '../../../core/hooks/useNotifications';
import { Box, Text } from '../../base';

export const NotificationWatcher = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const router = useRouter();
  const { t } = useTranslation('common');

  const { markAsRead } = useNotifications(userId);
  const [queue, setQueue] = useState<Notification[]>([]);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const isInitialLoadDone = useRef(false);

  const currentNotification = queue.length > 0 ? queue[0] : null;
  const isLast = queue.length === 1;

  const processIncoming = useCallback(
    async (notif: Notification, isSilent = false) => {
      const title = (notif.title || '').toLowerCase(); // Null safety
      const path = (notif.action_path || '').toLowerCase();

      const needsDialog =
        notif.type === 'error' ||
        notif.type === 'warning' ||
        title.includes('verific') ||
        title.includes('vendido') ||
        title.includes('compra') ||
        title.includes('pago') ||
        path.includes('orders') ||
        path.includes('wallet');

      if (needsDialog) {
        if (!isSilent)
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setQueue((prev) => {
          if (prev.find((item) => item.id === notif.id)) return prev;
          return [...prev, notif];
        });
      } else {
        if (!isSilent) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Toast.show({
            type: notif.type === 'success' ? 'success' : 'info',
            text1: notif.title ?? '',
            text2: notif.message ?? '',
            onPress: () => {
              if (notif.action_path) router.push(notif.action_path as any);
              Toast.hide();
            },
          });
          await markAsRead(notif.id);
        }
      }
    },
    [markAsRead, router],
  );

  useEffect(() => {
    if (userId && !isInitialLoadDone.current) {
      const fetchUnread = async () => {
        const { data } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .eq('read', false)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (data && data.length > 0) {
          processIncoming(data[0] as Notification, true);
          isInitialLoadDone.current = true;
        }
      };
      fetchUnread();
    }
  }, [userId, processIncoming]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications_realtime_watcher_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => processIncoming(payload.new as Notification),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, processIncoming]);

  const handleAction = async () => {
    if (!currentNotification || isProcessingAction) return;

    setIsProcessingAction(true);
    try {
      await markAsRead(currentNotification.id);

      if (currentNotification.action_path) {
        const path =
          currentNotification.action_path === '/profile'
            ? '/profile/listings'
            : currentNotification.action_path;
        router.push(path as any);
      }
      setQueue((prev) => prev.slice(1));
    } finally {
      setIsProcessingAction(false);
    }
  };

  if (!currentNotification) return null;

  const isError = currentNotification.type === 'error';
  const path = (currentNotification.action_path || '').toLowerCase();

  let confirmLabel = t('dialog.next');
  if (isLast) {
    if (isError) confirmLabel = t('dialog.fixNow');
    else if (path.includes('orders')) confirmLabel = t('dialog.viewOrder');
    else confirmLabel = t('dialog.understood');
  }

  return (
    <ConfirmDialog
      visible={!!currentNotification}
      title={currentNotification?.title ?? ''}
      description={currentNotification?.message ?? ''}
      onConfirm={handleAction}
      onCancel={() => setQueue([])}
      confirmLabel={confirmLabel}
      cancelLabel={isLast ? t('dialog.cancel') : t('dialog.skipAll')}
      icon={isError ? 'alert-circle-outline' : 'check-circle-outline'}
      isDangerous={isError}
      loading={isProcessingAction} // Pasamos el estado de carga al botón
    >
      {queue.length > 1 && (
        <Box marginTop="m" alignItems="center">
          <Text variant="caption-md" color="textSecondary">
            {`+${queue.length - 1} mensajes más`}
          </Text>
        </Box>
      )}
    </ConfirmDialog>
  );
};

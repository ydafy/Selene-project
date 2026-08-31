import React, { useEffect, useState, useCallback } from 'react';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthContext } from '../../../components/auth/AuthProvider';
import { supabase } from '../../../core/db/supabase';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Notification } from '@selene/types';
import { useTranslation } from 'react-i18next';
import {
  invalidateNotificationKeys,
  useNotificationMutations,
} from '../../../core/hooks/useNotificationMutations';
import { NotificationLinking } from '../../../core/services/notification';
import { classify } from './classify';
import { resolveDialogControls } from './dialogActions';
import { Box, Text } from '../../base';

const TOAST_VISIBILITY_MS = 4000;

export const NotificationWatcher = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const { t } = useTranslation(['common', 'notifications']);
  const queryClient = useQueryClient();

  const { markAsRead } = useNotificationMutations(userId);
  const [queue, setQueue] = useState<Notification[]>([]);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const currentNotification = queue.length > 0 ? queue[0] : null;
  const isLast = queue.length === 1;
  const hasMore = queue.length > 1;

  const showErrorToast = useCallback(() => {
    Toast.show({
      type: 'error',
      text1: t('common:states.errorTitle'),
      text2: t('common:errors.generic'),
    });
  }, [t]);

  const processIncoming = useCallback(
    async (notif: Notification, isSilent = false) => {
      const kind = classify(notif);

      if (kind === 'dialog') {
        if (!isSilent) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        setQueue((prev) => {
          if (prev.find((item) => item.id === notif.id)) return prev;
          return [...prev, notif];
        });
      } else {
        if (!isSilent) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const toastType =
            notif.type === 'success' ||
            notif.type === 'warning' ||
            notif.type === 'error'
              ? notif.type
              : 'info';
          Toast.show({
            type: toastType,
            visibilityTime: TOAST_VISIBILITY_MS,
            text1: notif.title ?? '',
            text2: notif.message ?? '',
            onPress: () => {
              NotificationLinking.navigate(notif.action_path);
            },
          });
          await markAsRead(notif.id);
        }
      }
    },
    [markAsRead],
  );

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications_realtime_watcher_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          try {
            const eventType = payload.eventType;
            if (eventType === 'INSERT') {
              const notif = payload.new as Notification;
              processIncoming(notif);
              invalidateNotificationKeys(queryClient, userId);
            } else if (eventType === 'UPDATE') {
              invalidateNotificationKeys(queryClient, userId);
            }
          } catch (error) {
            console.error('[NotificationWatcher] Payload handler error:', error);
            showErrorToast();
          }
        },
      )
      .subscribe((status, error) => {
        if (error) {
          console.error('[NotificationWatcher] Subscription error:', error);
          showErrorToast();
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, processIncoming, queryClient, showErrorToast]);

  const handleAction = async () => {
    if (!currentNotification || isProcessingAction) return;

    setIsProcessingAction(true);
    try {
      await markAsRead(currentNotification.id);
      await NotificationLinking.navigate(currentNotification.action_path);
      setQueue((prev) => prev.slice(1));
    } catch (error) {
      console.error('[NotificationWatcher] Action error:', error);
      showErrorToast();
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleSkip = () => {
    setQueue((prev) => prev.slice(1));
  };

  const handleSkipAll = () => {
    setQueue([]);
  };

  if (!currentNotification) return null;

  const isError = currentNotification.type === 'error';
  const path = (currentNotification.action_path || '').toLowerCase();

  const actionLabel = isError
    ? t('common:dialog.fixNow')
    : path.startsWith('/orders')
      ? t('common:dialog.viewOrder')
      : t('common:dialog.understood');

  const controls = resolveDialogControls(isLast);
  const confirmLabel =
    controls.confirmAction === 'action'
      ? actionLabel
      : t('common:dialog.skipAll');
  const cancelLabel =
    controls.cancelAction === 'cancel'
      ? t('common:dialog.cancel')
      : t('common:dialog.skip');
  const confirmAction =
    controls.confirmAction === 'action' ? handleAction : handleSkipAll;
  const cancelAction =
    controls.cancelAction === 'cancel' ? () => setQueue([]) : handleSkip;

  return (
    <ConfirmDialog
      visible={!!currentNotification}
      title={currentNotification?.title ?? ''}
      description={currentNotification?.message ?? ''}
      onConfirm={confirmAction}
      onCancel={cancelAction}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      icon={isError ? 'alert-circle-outline' : 'check-circle-outline'}
      isDangerous={isError}
      loading={isProcessingAction}
    >
      {hasMore && (
        <Box marginTop="m" alignItems="center">
          <Text variant="caption-md" color="textSecondary">
            {t('notifications:moreCount', { count: queue.length - 1 })}
          </Text>
        </Box>
      )}
    </ConfirmDialog>
  );
};

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  invalidateNotificationKeys,
  createMarkAsReadMutationOptions,
  createMarkAllAsReadMutationOptions,
  createDismissNotificationMutationOptions,
  createDismissAllMutationOptions,
} from './useNotificationMutations.logic';

export { invalidateNotificationKeys };

export const useNotificationMutations = (userId: string | undefined) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['common', 'notifications']);

  const showError = async () => {
    const { default: Toast } = await import('react-native-toast-message');
    Toast.show({
      type: 'error',
      text1: t('common:states.errorTitle'),
      text2: t('common:errors.generic'),
    });
  };

  const markAsReadMutation = useMutation(
    createMarkAsReadMutationOptions(queryClient, userId, t, showError),
  );

  const markAllAsReadMutation = useMutation(
    createMarkAllAsReadMutationOptions(queryClient, userId, t, showError),
  );

  const dismissNotificationMutation = useMutation(
    createDismissNotificationMutationOptions(queryClient, userId, t, showError),
  );

  const dismissAllMutation = useMutation(
    createDismissAllMutationOptions(queryClient, userId, t, showError),
  );

  return {
    markAsRead: (id: string) => markAsReadMutation.mutateAsync(id),
    markAllAsRead: () => markAllAsReadMutation.mutateAsync(undefined),
    dismissNotification: (id: string) => dismissNotificationMutation.mutateAsync(id),
    dismissAll: () => dismissAllMutation.mutateAsync(undefined),
    isMarkingRead: markAsReadMutation.isPending,
    isMarkingAllRead: markAllAsReadMutation.isPending,
    isDismissing: dismissNotificationMutation.isPending,
    isClearingAll: dismissAllMutation.isPending,
  };
};

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { useAuthContext } from '../../auth/AuthProvider';
import { useNotificationMutations } from '../../../core/hooks/useNotificationMutations';
import { pushTapRouter } from '../../../core/push/pushTap';
import { NotificationLinking } from '../../../core/services/notification';
import { createNotificationPressHandler } from './notificationPress';

/** UI-less: opens the notice of a tapped push, warm or cold start. */
export const PushTapHandler = () => {
  const { session, loading } = useAuthContext();
  const userId = session?.user.id;
  const navigatorReady = Boolean(useRootNavigationState()?.key);
  const { markAsRead } = useNotificationMutations(userId);

  // Same press as the inbox: navigate first, mark as read in the background.
  const markAsReadRef = useRef(markAsRead);
  markAsReadRef.current = markAsRead;
  const [press] = useState(() =>
    createNotificationPressHandler({
      markAsRead: (id) => markAsReadRef.current(id),
      navigate: (path) => NotificationLinking.navigate(path),
    }),
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => pushTapRouter.receive(response),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    pushTapRouter.update({
      ready: navigatorReady && !loading,
      press: userId ? press : null,
    });
    return () => pushTapRouter.update({ ready: false, press: null });
  }, [navigatorReady, loading, userId, press]);

  return null;
};

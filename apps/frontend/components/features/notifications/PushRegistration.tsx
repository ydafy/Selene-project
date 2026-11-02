import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';

import { useAuthContext } from '../../auth/AuthProvider';
import { pushRegistrar } from '../../../core/push/pushRegistration';
import { isNetworkReachable } from '../../../core/push/pushRegistration.logic';

/** UI-less: keeps this device's push token registered for the signed-in user. */
export const PushRegistration = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;

  useEffect(() => {
    void pushRegistrar.register(userId);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pushRegistrar.register(userId);
    });
    const tokenListener = Notifications.addPushTokenListener(() => {
      void pushRegistrar.register(userId);
    });
    // Back online: retry a pending unregister, then register this session.
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      if (isNetworkReachable(state)) void pushRegistrar.register(userId);
    });
    return () => {
      unsubscribeNetwork();
      appState.remove();
      tokenListener.remove();
    };
  }, [userId]);

  return null;
};

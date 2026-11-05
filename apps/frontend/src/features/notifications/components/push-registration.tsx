import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { useAuthContext } from '../../../shared/lib/auth/auth-provider';
import { pushRegistrar } from '../lib/push-registration';
import { createOnlineTransition } from '../logic/push-registration.logic';

/** UI-less: keeps this device's push token registered for the signed-in user. */
export const PushRegistration = () => {
  const { session } = useAuthContext();
  const userId = session?.user.id;

  useEffect(() => {
    void pushRegistrar.register(userId);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pushRegistrar.register(userId);
    });
    // No push token listener: Android emits it on every token request, which
    // would register again in a loop (#213), and Expo keeps the Expo push
    // token current when the FCM token rotates.
    // Back online: retry a pending unregister, then register this session.
    const backOnline = createOnlineTransition();
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      if (backOnline(state)) void pushRegistrar.register(userId);
    });
    return () => {
      unsubscribeNetwork();
      appState.remove();
    };
  }, [userId]);

  return null;
};

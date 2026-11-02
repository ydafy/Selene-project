import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import i18n from '../i18n';
import { supabase } from '../db/supabase';
import { createPushRegistrar } from './pushRegistration.logic';

const getProjectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

const createChannels = async (): Promise<void> => {
  await Notifications.setNotificationChannelAsync('orders', {
    name: i18n.t('notifications:channels.orders'),
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('activity', {
    name: i18n.t('notifications:channels.activity'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
};

/** One registrar per app so sign-out knows the token this device registered. */
export const pushRegistrar = createPushRegistrar({
  platform: Platform.OS,
  getProjectId,
  createChannels,
  hasPermission: async () =>
    (await Notifications.getPermissionsAsync()).granted,
  getExpoPushToken: async (projectId) =>
    (await Notifications.getExpoPushTokenAsync({ projectId })).data,
  registerToken: async (token, platform) => {
    const { error } = await supabase.rpc('fn_register_push_token', {
      p_token: token,
      p_platform: platform,
    });
    if (error) throw error;
  },
  unregisterToken: async (token) => {
    const { error } = await supabase.rpc('fn_unregister_push_token', {
      p_token: token,
    });
    if (error) throw error;
  },
  warn: (...args) => console.warn(...args),
});

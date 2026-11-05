import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';

import {
  createPushPermissionPrompt,
  type PushPermission,
  type PushPermissionMoment,
} from '../logic/push-permission.logic';

const toPermission = (
  response: Notifications.NotificationPermissionsStatus,
): PushPermission => ({
  status: response.status as PushPermission['status'],
  canAskAgain: response.canAskAgain,
});

export const getPushPermission = async (): Promise<PushPermission> =>
  toPermission(await Notifications.getPermissionsAsync());

export const pushPermissionPrompt = createPushPermissionPrompt({
  platform: Platform.OS,
  getPermission: getPushPermission,
  requestPermission: async () =>
    toPermission(await Notifications.requestPermissionsAsync()),
  storage: {
    get: (key) => AsyncStorage.getItem(key),
    set: (key, value) => AsyncStorage.setItem(key, value),
  },
  warn: (...args) => console.warn(...args),
});

/** The moment whose pre-prompt is on screen; read by `PushPermissionPrompt`. */
export const usePushPromptStore = create<{
  moment: PushPermissionMoment | null;
}>(() => ({ moment: null }));

/** Shows the push pre-prompt for this moment when L6 allows it. */
export const offerPushPermission = async (
  moment: PushPermissionMoment,
): Promise<void> => {
  // The prompt logic allows one dialog at a time; a skipped moment is not used up.
  if (await pushPermissionPrompt.offer(moment)) {
    usePushPromptStore.setState({ moment });
  }
};

/** Closes the pre-prompt on screen, so the next moment can be offered. */
export const closePushPermission = (): void => {
  usePushPromptStore.setState({ moment: null });
  pushPermissionPrompt.dismiss();
};

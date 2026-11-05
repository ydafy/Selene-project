import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  createPushTapRouter,
  FOREGROUND_PUSH_BEHAVIOR,
} from '../logic/push-tap.logic';

const isNative = Platform.OS !== 'web';

if (isNative) {
  Notifications.setNotificationHandler({
    handleNotification: async () => FOREGROUND_PUSH_BEHAVIOR,
  });
}

/** One router per app, so a remount neither loses a waiting tap nor repeats one. */
export const pushTapRouter = createPushTapRouter({
  defaultAction: Notifications.DEFAULT_ACTION_IDENTIFIER,
  getLaunchResponse: () =>
    isNative ? Notifications.getLastNotificationResponse() : null,
  clearLastResponse: () => {
    if (isNative) Notifications.clearLastNotificationResponse();
  },
  warn: (...args) => console.warn(...args),
});

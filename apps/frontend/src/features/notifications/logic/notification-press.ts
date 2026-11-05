type PressableNotification = {
  id: string;
  action_path: string | null;
};

type NotificationPressDeps = {
  markAsRead: (id: string) => Promise<unknown>;
  navigate: (actionPath: string | null) => Promise<void>;
};

// Navigates first and marks the notice as read in the background, so a tap
// never waits on the network. Taps while a navigation is in flight are ignored.
export function createNotificationPressHandler({
  markAsRead,
  navigate,
}: NotificationPressDeps) {
  let inFlight = false;

  return async (notif: PressableNotification): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      // The mutation reports its own failure; a missed read mark, async or
      // thrown synchronously, must not block navigation or keep the guard set.
      Promise.resolve()
        .then(() => markAsRead(notif.id))
        .catch(() => {});
      await navigate(notif.action_path);
    } finally {
      inFlight = false;
    }
  };
}

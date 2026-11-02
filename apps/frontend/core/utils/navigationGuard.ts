type BlockedAction = { type: string };

/**
 * Decides what happens to a removal that `usePreventRemove` blocked.
 *
 * A `REPLACE` is how the sell flow leaves after publishing, so it is replayed
 * at once. Every other removal (back gesture, header back, Android hardware
 * back, navigating away) waits for the user to answer the discard dialog.
 */
export const routeBlockedRemove = <A extends BlockedAction>(
  action: A,
  handlers: {
    proceed: (action: A) => void;
    confirmExit: (action: A) => void;
  },
): void => {
  if (action.type === 'REPLACE') {
    handlers.proceed(action);
    return;
  }
  handlers.confirmExit(action);
};

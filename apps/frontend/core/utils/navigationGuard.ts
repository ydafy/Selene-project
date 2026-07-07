/**
 * Subscribes to the React Navigation `beforeRemove` event and returns the
 * unsubscribe function exactly as provided by the emitter. Returning this
 * function from a `useEffect` cleanup is the documented cleanup pattern.
 */
export const subscribeBeforeRemove = (
  navigation: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addListener: (event: 'beforeRemove', listener: (e: any) => void) => () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listener: (e: any) => void,
): (() => void) => navigation.addListener('beforeRemove', listener);

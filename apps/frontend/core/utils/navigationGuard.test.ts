import { describe, expect, it } from 'bun:test';

import { subscribeBeforeRemove } from './navigationGuard';

describe('subscribeBeforeRemove', () => {
  it('returns the unsubscribe function provided by the navigation emitter', () => {
    const unsubscribe = () => {};
    const navigation = {
      addListener: () => unsubscribe,
    };

    const result = subscribeBeforeRemove(navigation, () => {});

    expect(result).toBe(unsubscribe);
  });

  it('registers the beforeRemove listener on the navigation object', () => {
    const listener = () => {};
    let registeredEvent: string | null = null;
    let registeredListener: ((e: unknown) => void) | null = null;

    const navigation = {
      addListener: (event: string, l: (e: unknown) => void) => {
        registeredEvent = event;
        registeredListener = l;
        return () => {};
      },
    };

    subscribeBeforeRemove(navigation, listener);

    expect(registeredEvent).toBe('beforeRemove');
    expect(registeredListener).toBe(listener);
  });
});

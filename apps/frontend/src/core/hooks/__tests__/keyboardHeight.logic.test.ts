import { describe, expect, test } from 'bun:test';

import { subscribeKeyboardHeight } from '../keyboardHeight.logic';

/**
 * L64: the password dialog must sit above the keyboard. The height comes from
 * the keyboard events, so the dialog can reserve that space itself.
 */
type Handler = (event: { endCoordinates: { height: number } }) => void;

const makeKeyboard = () => {
  const handlers = new Map<string, Handler>();
  const removed: string[] = [];
  return {
    handlers,
    removed,
    addListener: (event: string, handler: Handler) => {
      handlers.set(event, handler);
      return { remove: () => removed.push(event) };
    },
  };
};

describe('subscribeKeyboardHeight', () => {
  test('Android reports the height on keyboardDidShow and 0 on keyboardDidHide', () => {
    const keyboard = makeKeyboard();
    const heights: number[] = [];
    subscribeKeyboardHeight(keyboard, 'android', (h) => heights.push(h));

    keyboard.handlers.get('keyboardDidShow')!({
      endCoordinates: { height: 310 },
    });
    keyboard.handlers.get('keyboardDidHide')!({
      endCoordinates: { height: 0 },
    });

    expect(heights).toEqual([310, 0]);
  });

  test('iOS uses the will events so the dialog moves with the keyboard', () => {
    const keyboard = makeKeyboard();
    const heights: number[] = [];
    subscribeKeyboardHeight(keyboard, 'ios', (h) => heights.push(h));

    expect([...keyboard.handlers.keys()].sort()).toEqual([
      'keyboardWillHide',
      'keyboardWillShow',
    ]);
    keyboard.handlers.get('keyboardWillShow')!({
      endCoordinates: { height: 336 },
    });
    expect(heights).toEqual([336]);
  });

  test('unsubscribe removes both listeners', () => {
    const keyboard = makeKeyboard();
    const unsubscribe = subscribeKeyboardHeight(keyboard, 'android', () => {});
    unsubscribe();
    expect(keyboard.removed.sort()).toEqual([
      'keyboardDidHide',
      'keyboardDidShow',
    ]);
  });
});

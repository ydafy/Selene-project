/**
 * @file core/hooks/keyboardHeight.logic.ts
 * @description Keyboard height from React Native keyboard events. The keyboard
 * source is injected so the subscription is testable without React Native.
 */

type KeyboardEventLike = { endCoordinates: { height: number } };

type KeyboardEventName =
  | 'keyboardWillShow'
  | 'keyboardWillHide'
  | 'keyboardDidShow'
  | 'keyboardDidHide';

export type KeyboardSource = {
  addListener: (
    event: KeyboardEventName,
    handler: (event: KeyboardEventLike) => void,
  ) => { remove: () => void };
};

/**
 * Reports the keyboard height on show and 0 on hide. iOS has `will` events, so
 * the layout moves with the keyboard; Android only has `did` events.
 */
export const subscribeKeyboardHeight = (
  keyboard: KeyboardSource,
  platformOS: string,
  onChange: (height: number) => void,
): (() => void) => {
  const ios = platformOS === 'ios';
  const show = keyboard.addListener(
    ios ? 'keyboardWillShow' : 'keyboardDidShow',
    (event) => onChange(event.endCoordinates.height),
  );
  const hide = keyboard.addListener(
    ios ? 'keyboardWillHide' : 'keyboardDidHide',
    () => onChange(0),
  );
  return () => {
    show.remove();
    hide.remove();
  };
};

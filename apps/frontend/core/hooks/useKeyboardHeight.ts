/**
 * @file core/hooks/useKeyboardHeight.ts
 * @description Current keyboard height in points, or 0 when hidden or disabled.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

import { subscribeKeyboardHeight } from './keyboardHeight.logic';

export const useKeyboardHeight = (enabled = true): number => {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeKeyboardHeight(
      Keyboard,
      Platform.OS,
      setHeight,
    );
    return () => {
      unsubscribe();
      setHeight(0);
    };
  }, [enabled]);

  return height;
};

import type { ColorValue } from 'react-native';

/**
 * The tab bar hands icons a `ColorValue`, which also allows numbers and null.
 * Vector icons accept only a string, so anything else falls back to the
 * icon's default color.
 */
export const tabIconColor = (color: ColorValue): string | undefined =>
  typeof color === 'string' ? color : undefined;

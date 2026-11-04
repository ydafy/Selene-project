import { Theme } from '../../core/theme';

type ThemeColors = Theme['colors'];
type Variant = 'solid' | 'outline';

export const getBackgroundColor = (
  loading: boolean,
  disabled: boolean,
  variant: Variant,
  buttonColor: string | undefined,
  colors: ThemeColors,
): string => {
  if (loading) return buttonColor || colors.primary;
  if (disabled) return colors.background;
  if (variant === 'outline') return colors.background;
  return buttonColor || colors.primary;
};

export const getTextColor = (
  loading: boolean,
  variant: Variant,
  buttonColor: string | undefined,
  colors: ThemeColors,
): string => {
  // Dark text is designed for the gold fill; a custom loading fill gets light text.
  if (loading) return buttonColor ? colors.textPrimary : colors.background;
  if (variant === 'outline') return colors.primary;
  return colors.background;
};

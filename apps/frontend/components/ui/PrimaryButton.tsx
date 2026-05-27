import { Button as PaperButton, ButtonProps } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

type PrimaryButtonProps = Omit<ButtonProps, 'theme'> & {
  children: React.ReactNode;
  variant?: 'solid' | 'outline';
};

const PILL_RADIUS = 30;
const BORDER_WIDTH = 2;

const getBackgroundColor = (
  loading: boolean,
  disabled: boolean,
  variant: 'solid' | 'outline',
  buttonColor: string | undefined,
  theme: Theme,
): string => {
  if (loading) return buttonColor || theme.colors.primary;
  if (disabled) return theme.colors.background;
  if (variant === 'outline') return theme.colors.background;
  return buttonColor || theme.colors.primary;
};

const getTextColor = (
  loading: boolean,
  variant: 'solid' | 'outline',
  theme: Theme,
): string => {
  if (loading) return '#FFFFFF';
  if (variant === 'outline') return theme.colors.primary;
  return theme.colors.background;
};

const getOpacity = (loading: boolean, disabled: boolean): number => {
  if (loading) return 0.9;
  if (disabled) return 0.5;
  return 1;
};

export const PrimaryButton = ({
  children,
  variant = 'solid',
  disabled = false,
  loading = false,
  buttonColor,
  ...rest
}: PrimaryButtonProps) => {
  const theme = useTheme<Theme>();

  const isOutlineVariant = variant === 'outline';
  const mode = isOutlineVariant ? 'outlined' : 'contained';

  return (
    <PaperButton
      {...rest}
      disabled={disabled}
      loading={loading}
      mode={mode}
      textColor={getTextColor(loading, variant, theme)}
      style={[
        {
          borderRadius: PILL_RADIUS,
          borderWidth: BORDER_WIDTH,
          borderColor: theme.colors.primary,
          backgroundColor: getBackgroundColor(
            loading,
            disabled,
            variant,
            buttonColor,
            theme,
          ),
          opacity: getOpacity(loading, disabled),
        },
        rest.style,
      ]}
      labelStyle={{
        fontWeight: 'bold',
        fontSize: 16,
      }}
    >
      {children}
    </PaperButton>
  );
};

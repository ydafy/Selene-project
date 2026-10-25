import { Button as PaperButton, ButtonProps } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';
import { getBackgroundColor, getTextColor } from './primaryButtonColors';

type PrimaryButtonProps = Omit<ButtonProps, 'theme'> & {
  children: React.ReactNode;
  variant?: 'solid' | 'outline';
};

const PILL_RADIUS = 30;
const BORDER_WIDTH = 2;

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
      textColor={getTextColor(loading, variant, buttonColor, theme.colors)}
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
            theme.colors,
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

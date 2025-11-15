import { Button as PaperButton, ButtonProps } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

// Omitimos 'theme' y hacemos que 'children' sea obligatorio.
type PrimaryButtonProps = Omit<ButtonProps, 'theme'> & {
  children: React.ReactNode;
  variant?: 'solid' | 'outline';
};

/**
 * PrimaryButton es nuestro botón de acción principal estandarizado.
 */
export const PrimaryButton = ({
  children,
  variant = 'solid',
  disabled,
  ...rest
}: PrimaryButtonProps) => {
  const theme = useTheme<Theme>();

  // Determinamos el estilo basado en la variante Y el estado 'disabled'
  const isOutlined = variant === 'outline' || disabled;

  return (
    <PaperButton
      {...rest}
      disabled={disabled}
      mode={isOutlined ? 'outlined' : 'contained'}
      // Cambiamos los colores dinámicamente
      buttonColor={isOutlined ? 'transparent' : theme.colors.primary}
      textColor={isOutlined ? theme.colors.primary : theme.colors.background}
      // Añadimos un borde consistente
      style={[
        {
          borderRadius: 30,
          borderWidth: 2,
          borderColor: theme.colors.primary,
        },
        rest.style,
      ]}
      labelStyle={{ fontWeight: 'bold', paddingVertical: 8, fontSize: 16 }}
    >
      {children}
    </PaperButton>
  );
};

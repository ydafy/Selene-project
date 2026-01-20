import { Button as PaperButton, ButtonProps } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

type PrimaryButtonProps = Omit<ButtonProps, 'theme'> & {
  children: React.ReactNode;
  variant?: 'solid' | 'outline';
};

export const PrimaryButton = ({
  children,
  variant = 'solid',
  disabled,
  loading,
  buttonColor,
  ...rest
}: PrimaryButtonProps) => {
  const theme = useTheme<Theme>();

  // 1. Determinamos si debe verse como "Outline" (Borde y fondo transparente)
  //    Solo si es variante 'outline' O si está deshabilitado PERO NO cargando.
  const isOutlined = variant === 'outline' || (disabled && !loading);

  // 2. Calculamos el color de fondo exacto según el estado
  let backgroundColor;

  if (loading) {
    // ESTADO CARGANDO (CLICK): Usamos textSecondary (Gris)
    backgroundColor = theme.colors.background;
  } else if (isOutlined) {
    // ESTADO OUTLINE/DISABLED: Transparente
    backgroundColor = theme.colors.background;
  } else {
    // ESTADO NORMAL: Usamos el color pasado o el Primario (Lion)
    backgroundColor = buttonColor || theme.colors.primary;
  }

  // 3. Calculamos el color del texto
  const textColor = isOutlined ? theme.colors.primary : theme.colors.background;

  return (
    <PaperButton
      {...rest}
      disabled={disabled}
      loading={loading}
      mode={isOutlined ? 'outlined' : 'contained'}
      // Forzamos el color del texto
      textColor={textColor}
      style={[
        {
          borderRadius: 30,
          borderWidth: 2,
          borderColor: theme.colors.primary,

          // --- AQUÍ ESTÁ LA SOLUCIÓN ---
          // Inyectamos el color de fondo calculado directamente en el estilo.
          // Esto anula el comportamiento por defecto de Paper al estar disabled.
          backgroundColor: backgroundColor,
          // -----------------------------
        },
        rest.style,
      ]}
      labelStyle={{ fontWeight: 'bold', paddingVertical: 8, fontSize: 16 }}
    >
      {children}
    </PaperButton>
  );
};

import { Button as PaperButton, ButtonProps } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

// Omitimos 'theme' y hacemos que 'children' sea obligatorio.
type PrimaryButtonProps = Omit<ButtonProps, 'theme'> & {
  children: React.ReactNode;
};

/**
 * PrimaryButton es nuestro botón de acción principal estandarizado.
 */
export const PrimaryButton = ({ children, ...rest }: PrimaryButtonProps) => {
  // Obtenemos el tema para poder acceder a nuestros colores definidos.
  const theme = useTheme<Theme>();

  return (
    <PaperButton
      {...rest}
      mode="contained"
      // Usamos los colores de nuestro tema para el botón y el texto
      buttonColor={theme.colors.primary}
      textColor={theme.colors.background}
      // Estilos para el texto y el contenedor del botón
      labelStyle={{ fontWeight: 'bold', paddingVertical: 8, fontSize: 16 }}
      style={[{ borderRadius: 30 }, rest.style]} // Bordes muy redondeados
    >
      {children}
    </PaperButton>
  );
};

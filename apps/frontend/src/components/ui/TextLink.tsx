import { TextProps as RNTextProps } from 'react-native';
import { Text } from '../base';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

// Heredamos las props de Text de React Native y hacemos 'children' obligatorio.
type TextLinkProps = RNTextProps & {
  children: React.ReactNode;
};

/**
 * TextLink es un componente para texto clickeable.
 * Usa la prop 'onPress' del componente Text de React Native para una alineación perfecta.
 */
export const TextLink = ({ children, style, ...rest }: TextLinkProps) => {
  const theme = useTheme<Theme>();

  return (
    <Text
      // Pasamos todas las props restantes, incluyendo onPress
      {...rest}
      style={[
        {
          color: theme.colors.primary,
          fontWeight: 'bold',
          textDecorationLine: 'underline',
          fontSize: 15,
        },
        style, // Permite sobrescribir estilos desde fuera
      ]}
    >
      {children}
    </Text>
  );
};

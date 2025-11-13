import { TouchableOpacity, TouchableOpacityProps } from 'react-native';
import { Text } from '../base';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

// Heredamos las props de TouchableOpacity y hacemos 'children' obligatorio.
type TextLinkProps = TouchableOpacityProps & {
  children: React.ReactNode;
};

/**
 * TextLink es un componente para texto clickeable con el color primario del tema.
 */
export const TextLink = ({ children, style, ...rest }: TextLinkProps) => {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity {...rest} style={style}>
      <Text style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
        {children}
      </Text>
    </TouchableOpacity>
  );
};

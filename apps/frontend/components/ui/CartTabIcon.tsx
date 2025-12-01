import { MaterialCommunityIcons } from '@expo/vector-icons';
//import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../base';
//import { Theme } from '../../core/theme';

type CartTabIconProps = {
  color: string;
  size: number;
  count: number;
};

export const CartTabIcon = ({ color, size, count }: CartTabIconProps) => {
  //const theme = useTheme<Theme>();

  return (
    <Box>
      <MaterialCommunityIcons name="cart-outline" color={color} size={size} />

      {count > 0 && (
        <Box
          position="absolute"
          top={-5} // Ajuste fino vertical
          right={-10} // Ajuste fino horizontal
          minWidth={18}
          height={18}
          backgroundColor="error"
          borderRadius="m" // Hace que sea una píldora si el número crece
          alignItems="center"
          justifyContent="center"
          paddingHorizontal="xs"
          // EL TRUCO PREMIUM: Borde del color del fondo de la tab bar
          borderWidth={2}
          borderColor="cardBackground"
          style={{
            // Sombra sutil para levantar el badge
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.2,
            shadowRadius: 1,
          }}
        >
          <Text
            style={{
              color: 'white',
              fontSize: 10,
              fontWeight: 'bold',
              lineHeight: 12, // Alineación vertical precisa
            }}
          >
            {count > 99 ? '99+' : count}
          </Text>
        </Box>
      )}
    </Box>
  );
};

import { Button } from 'react-native-paper';
import { Box, Text } from '../../components/base';

export default function HomeScreen() {
  return (
    <Box
      flex={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor="background"
      padding="xl"
    >
      {/* CORRECCIÓN #1: Movemos los estilos no temáticos a propiedades de Restyle */}
      <Text variant="largeHeader" color="primary">
        ¡El Theming Funciona!
      </Text>

      {/* CORRECCIÓN #2: Usamos un espaciado del tema para la altura */}
      <Box height={26} />

      <Button mode="contained" onPress={() => console.log('Pressed')}>
        Botón de Paper
      </Button>
    </Box>
  );
}

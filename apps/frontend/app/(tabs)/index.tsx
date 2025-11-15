import { Button } from 'react-native-paper';
import { Link, router } from 'expo-router';
import { Box, Text } from '../../components/base';
import { supabase } from '../../core/db/supabase';
import { Alert } from 'react-native';

export default function HomeScreen() {
  // NUEVA FUNCIÓN DE LOGOUT
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Error', 'No se pudo cerrar la sesión.');
    } else {
      // Si el logout es exitoso, la lógica en nuestro _layout.tsx se encargará
      // de detectar el cambio de sesión y redirigirnos al login automáticamente.
      router.replace('/(auth)'); // Añadimos un replace por si acaso
    }
  };

  return (
    <Box
      flex={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor="background"
      padding="xl"
    >
      <Text variant="header" color="primary">
        ¡Estás dentro!
      </Text>
      <Text variant="subdued" marginVertical="l">
        Esta es la pantalla principal de la aplicación.
      </Text>

      {/* --- BOTÓN DE LOGOUT --- */}
      <Button
        mode="outlined"
        onPress={handleLogout}
        textColor="#E4E4E4" // Hardcodeamos el color para que sea visible
      >
        Cerrar Sesión
      </Button>

      {/* Mantenemos el link a registro por si necesitamos crear otro usuario */}
      <Box marginTop="xl">
        <Link href="/(auth)/register" asChild>
          <Button mode="contained">Ir a la Pantalla de Registro</Button>
        </Link>
      </Box>
    </Box>
  );
}

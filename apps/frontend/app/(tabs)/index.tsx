import { Button } from 'react-native-paper';
import { Link, router } from 'expo-router';
import { Box, Text } from '../../components/base';
import { supabase } from '../../core/db/supabase';
import { Alert } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export default function HomeScreen() {
  // NUEVA FUNCIÓN DE LOGOUT
  const handleFullLogout = async () => {
    try {
      // 1. Primero, cerramos la sesión de Google.
      //    Esto es crucial para que la próxima vez nos pida elegir una cuenta.
      await GoogleSignin.signOut();

      // 2. Luego, cerramos la sesión de Supabase.
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      // La redirección automática de _layout.tsx se encargará del resto.
      router.replace('/(auth)');
    } catch (error) {
      console.error('Error durante el logout completo:', error);
      Alert.alert('Error', 'No se pudo cerrar la sesión completamente.');
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
      <Text variant="header-xl" color="primary">
        ¡Estás dentro!
      </Text>
      <Text variant="body-sm" marginVertical="l">
        Esta es la pantalla principal de la aplicación.
      </Text>

      {/* --- BOTÓN DE LOGOUT --- */}
      <Button
        mode="outlined"
        onPress={handleFullLogout}
        textColor="#E4E4E4" // Hardcodeamos el color para que sea visible
      >
        Cerrar Sesión
      </Button>

      {/* Mantenemos el link a registro por si necesitamos crear otro usuario */}
      <Box marginTop="xl">
        <Link href="/(auth)/register" asChild>
          <Button mode="contained" textColor="#020202">
            Ir a la Pantalla de Registro
          </Button>
        </Link>
      </Box>
    </Box>
  );
}

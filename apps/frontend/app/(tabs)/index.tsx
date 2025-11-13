import { useEffect } from 'react';
import { Button } from 'react-native-paper';
import { Link } from 'expo-router'; // NUEVO: Importamos el componente Link
import { Box, Text } from '../../components/base';
import { supabase } from '../../core/db/supabase';

export default function HomeScreen() {
  // Mantendremos este código de prueba por ahora para seguir verificando la conexión
  useEffect(() => {
    const fetchProfiles = async () => {
      console.log('Intentando obtener perfiles de Supabase...');
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) {
        console.error('Error al obtener perfiles:', error);
      } else {
        console.log('Perfiles obtenidos con éxito:', data);
      }
    };
    fetchProfiles();
  }, []);

  return (
    <Box
      flex={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor="background"
      padding="xl"
    >
      <Text variant="header" color="primary">
        ¡El Theming Funciona!
      </Text>
      <Box height={40} />

      {/* --- NUEVO BOTÓN DE NAVEGACIÓN --- */}
      {/* El componente Link de Expo Router nos permite navegar a otras pantallas.
          El 'href' corresponde a la ruta del archivo en tu carpeta 'app'.
          Lo envolvemos en un componente Button de React Native Paper para que se vea bien. */}
      <Link href="/(auth)/login" asChild>
        <Button mode="contained">Ir a la Pantalla de Registro</Button>
      </Link>
      {/* --- FIN DEL NUEVO BOTÓN --- */}

      <Box height={40} />

      <Button
        mode="contained"
        buttonColor="#5B85AA"
        textColor="#E4E4E4"
        onPress={() => console.log('Pressed')}
      >
        COMPRAR
      </Button>
    </Box>
  );
}

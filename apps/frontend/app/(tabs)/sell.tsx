//  Nuestra pantalla de registro.
import { useState } from 'react';
import { Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import { Button, TextInput } from 'react-native-paper';
import { Box, Text } from '../../components/base';
import { supabase } from '../../core/db/supabase';

export default function RegisterScreen() {
  // Estados para manejar los inputs del formulario
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Función para manejar el registro
  const handleRegister = async () => {
    // Validación simple (podemos mejorarla con Zod después)
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Las contraseñas no coinciden.');
      return;
    }
    if (!username) {
      Alert.alert('Error', 'El nombre de usuario es requerido.');
      return;
    }

    setLoading(true);

    // Llamada a Supabase para registrar al usuario
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        // Aquí pasamos datos extra que nuestro trigger 'handle_new_user' usará
        data: {
          username: username,
        },
      },
    });

    setLoading(false);

    if (error) {
      // Si hay un error de Supabase (ej. el email ya existe), lo mostramos
      Alert.alert('Error en el registro', error.message);
    } else if (data.session) {
      // Si el registro es exitoso Y Supabase nos devuelve una sesión,
      // significa que el usuario está logueado. Lo redirigimos a la app principal.
      Alert.alert('¡Éxito!', '¡Bienvenido a Selene!');
      router.replace('/(tabs)'); // Redirige a la pantalla de inicio
    } else if (data.user) {
      // Si el registro es exitoso pero no hay sesión, significa que
      // la verificación de email está activada.
      Alert.alert(
        'Registro exitoso',
        'Hemos enviado un enlace de verificación a tu correo electrónico.',
      );
      router.replace('/(auth)'); // Lo mandamos al login para que espere
    }
  };

  return (
    <Box
      flex={1}
      justifyContent="center"
      padding="xl"
      backgroundColor="background"
    >
      <Stack.Screen options={{ title: 'Crear Cuenta' }} />

      <Text variant="header" textAlign="center" marginBottom="l">
        Únete a Selene PUTO
      </Text>

      <TextInput
        label="Nombre de Usuario"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        style={{ marginBottom: 16 }}
      />
      <TextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        style={{ marginBottom: 16 }}
      />
      <TextInput
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ marginBottom: 16 }}
      />
      <TextInput
        label="Confirmar Contraseña"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        style={{ marginBottom: 16 }}
      />

      <Button
        mode="contained"
        onPress={handleRegister}
        disabled={loading}
        loading={loading}
      >
        {loading ? 'Creando cuenta...' : 'Crear Cuenta'}
      </Button>
    </Box>
  );
}

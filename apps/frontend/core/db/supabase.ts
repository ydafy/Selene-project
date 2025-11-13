// Importamos un 'polyfill' necesario para que Supabase funcione correctamente en React Native.
// Debe estar al principio.
import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

// Obtenemos la URL y la llave anónima de las variables de entorno.
// El prefijo EXPO_PUBLIC_ es la forma en que Expo nos permite acceder a estas variables en la app.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Esta es una comprobación de seguridad. Si olvidamos definir las llaves en nuestro archivo .env,
// la aplicación fallará al iniciar con un error claro, en lugar de fallar de forma misteriosa más tarde.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase URL and Anon Key must be provided in your .env file.',
  );
}

// Creamos y exportamos el cliente de Supabase.
// Esta es la única instancia que importaremos y usaremos en toda la aplicación.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

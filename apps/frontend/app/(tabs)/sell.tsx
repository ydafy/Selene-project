import { View } from 'react-native';

/**
 * Este componente es un "Placeholder".
 * Existe solo para que Expo Router renderice la pestaña "Vender" en la barra inferior.
 *
 * Nunca se muestra al usuario porque el listener en _layout.tsx intercepta
 * el evento 'tabPress' y redirige al modal '/sell'.
 */
export default function SellTabPlaceholder() {
  return <View />;
}

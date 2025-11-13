import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ViewStyle,
} from 'react-native';
import { Box } from '../base';

// Definimos las props que nuestro componente aceptará.
type ScreenLayoutProps = {
  children: React.ReactNode; // 'children' es el contenido que irá dentro del layout.
  style?: ViewStyle; // Un 'style' opcional para personalizar el contenedor del scroll.
};

/**
 * ScreenLayout es el componente base para todas las pantallas.
 * Proporciona un comportamiento consistente para el teclado,
 * scroll y padding básico.
 */
export const ScreenLayout = ({ children, style }: ScreenLayoutProps) => {
  return (
    // KeyboardAvoidingView ajusta la pantalla para que el teclado no tape los inputs.
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      {/* El Box de Restyle nos da el color de fondo de nuestro tema. */}
      <Box flex={1} backgroundColor="background">
        {/* ScrollView permite que el contenido se desplace si es más alto que la pantalla. */}
        <ScrollView
          contentContainerStyle={[{ flexGrow: 1 }, style]} // Combina estilos para flexibilidad.
          keyboardShouldPersistTaps="handled" // Ayuda a que los toques funcionen bien con el teclado abierto.
        >
          {/* El contenido real de la pantalla se renderiza aquí. */}
          {children}
        </ScrollView>
      </Box>
    </KeyboardAvoidingView>
  );
};

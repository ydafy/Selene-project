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
    <Box flex={1} backgroundColor="background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[{ flexGrow: 1 }, style]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
};

import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context'; // <-- 1. Importamos el hook
import { Box } from '../base';

type ScreenLayoutProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  disableSafeArea?: boolean; // Opción por si alguna vez queremos control manual
};

/**
 * ScreenLayout es el componente base para todas las pantallas.
 * Proporciona un comportamiento consistente para el teclado,
 * scroll y padding básico.
 */

export const ScreenLayout = ({
  children,
  style,
  disableSafeArea,
}: ScreenLayoutProps) => {
  // 2. Obtenemos las medidas exactas de los bordes seguros del dispositivo
  const insets = useSafeAreaInsets();

  return (
    <Box
      flex={1}
      backgroundColor="background"
      // 3. Aplicamos el padding solo si no está deshabilitado
      style={{
        paddingTop: disableSafeArea ? 0 : insets.top,
        paddingBottom: disableSafeArea ? 0 : insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[{ flexGrow: 1 }, style]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
};

import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context'; // <-- 1. Importamos el hook
import { Box } from '../base';
import { useKeyboardHeight } from '../../core/hooks/useKeyboardHeight';

type ScreenLayoutProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  disableSafeArea?: boolean; // Opción por si alguna vez queremos control manual
  /**
   * Opt-in. Expo 54 is edge-to-edge, so Android no longer resizes the window
   * for the keyboard: the scroll content gets the keyboard height as bottom
   * padding instead. iOS keeps the KeyboardAvoidingView padding.
   */
  keyboardAware?: boolean;
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
  keyboardAware,
}: ScreenLayoutProps) => {
  // 2. Obtenemos las medidas exactas de los bordes seguros del dispositivo
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(
    !!keyboardAware && Platform.OS === 'android',
  );

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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            { flexGrow: 1 },
            style,
            keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
};

import { useState } from 'react';
import {
  TextInput as PaperTextInput,
  TextInputProps,
} from 'react-native-paper';

type FormTextInputProps = Omit<TextInputProps, 'theme'> & {
  leftIcon?: string;
};

/**
 * Componente de TextInput estandarizado para la aplicación.
 * Encapsula React Native Paper TextInput con estilos y funcionalidades por defecto,
 * incluyendo el manejo de visibilidad para campos de contraseña.
 */
export const FormTextInput = ({
  leftIcon,
  secureTextEntry,
  ...rest
}: FormTextInputProps) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  // Determina si el campo es de tipo contraseña para activar la funcionalidad del "ojo".
  const isPasswordField = !!secureTextEntry;

  return (
    <PaperTextInput
      {...rest}
      mode="flat"
      style={[{ backgroundColor: 'transparent' }, rest.style]}
      left={leftIcon ? <PaperTextInput.Icon icon={leftIcon} /> : undefined}
      secureTextEntry={isPasswordField ? !isPasswordVisible : false}
      right={
        isPasswordField ? (
          <PaperTextInput.Icon
            icon={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
            onPress={() => setIsPasswordVisible((prev) => !prev)}
          />
        ) : (
          rest.right
        )
      }
    />
  );
};

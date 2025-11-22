import { useState, forwardRef } from 'react';
import {
  TextInput as PaperTextInput,
  TextInputProps,
} from 'react-native-paper';
import type { TextInput as RNTextInput } from 'react-native';

type FormTextInputProps = Omit<TextInputProps, 'theme'> & {
  leftIcon?: string;
};

/**
 * Componente de TextInput estandarizado, ahora con soporte para 'ref'.
 * El tipo de la ref se infiere del TextInput de React Native Paper.
 */

export const FormTextInput = forwardRef<RNTextInput, FormTextInputProps>(
  ({ leftIcon, secureTextEntry, ...rest }, ref) => {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const isPasswordField = !!secureTextEntry;

    return (
      <PaperTextInput
        ref={ref}
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
  },
);

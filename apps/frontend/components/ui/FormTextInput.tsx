import {
  TextInput as PaperTextInput,
  TextInputProps,
} from 'react-native-paper';

// Definimos las props que nuestro componente aceptará.
// Usamos 'Omit' para quitar la prop 'theme' de las props originales de TextInput,
// ya que nuestro proveedor de temas se encarga de eso.
// Añadimos una nueva prop opcional 'leftIcon'.
type FormTextInputProps = Omit<TextInputProps, 'theme'> & {
  leftIcon?: string;
};

/**
 * FormTextInput es nuestro componente de input estandarizado.
 * Encapsula TextInput de React Native Paper con nuestros estilos por defecto.
 */
export const FormTextInput = ({ leftIcon, ...rest }: FormTextInputProps) => {
  return (
    <PaperTextInput
      // Pasamos todas las props restantes (como label, value, onChangeText, etc.)
      {...rest}
      // Establecemos nuestros estilos por defecto
      mode="flat"
      style={[{ backgroundColor: 'transparent' }, rest.style]} // Mantenemos el fondo transparente
      // Renderizamos el icono de la izquierda solo si se proporciona la prop 'leftIcon'
      left={leftIcon ? <PaperTextInput.Icon icon={leftIcon} /> : undefined}
    />
  );
};

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BaseToast,
  ErrorToast,
  ToastConfigParams,
} from 'react-native-toast-message';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../base';
import { Theme } from '../../core/theme'; // Ruta de importación corregida

/*
  Definimos nuestra configuración de Toast personalizada.
*/
export const toastConfig = {
  success: (props: ToastConfigParams<any>) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: '#28a745', backgroundColor: '#1E1E1E' }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontFamily: 'Montserrat-Medium',
        color: '#E4E4E4',
      }}
      text2Style={{
        fontSize: 14,
        fontFamily: 'Montserrat-Regular',
        color: '#A9A9A9',
      }}
    />
  ),

  error: (props: ToastConfigParams<any>) => (
    <ErrorToast
      {...props}
      style={{ borderLeftColor: '#dc3545', backgroundColor: '#1E1E1E' }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontFamily: 'Montserrat-Medium',
        color: '#E4E4E4',
      }}
      text2Style={{
        fontSize: 14,
        fontFamily: 'Montserrat-Regular',
        color: '#A9A9A9',
      }}
    />
  ),
  info: (props: ToastConfigParams<any>) => (
    <BaseToast
      {...props}
      // Usamos un azul estándar para Info, o tu color primario si prefieres
      style={{ borderLeftColor: '#2196F3', backgroundColor: '#1E1E1E' }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontFamily: 'Montserrat-Medium',
        color: '#E4E4E4',
      }}
      text2Style={{
        fontSize: 14,
        fontFamily: 'Montserrat-Regular',
        color: '#A9A9A9',
      }}
    />
  ),

  seleneToast: ({ text1 }: ToastConfigParams<any>) => {
    const theme = useTheme<Theme>();
    return (
      <Box
        height={80}
        width="90%"
        backgroundColor="cardBackground"
        style={{ borderLeftWidth: 10, borderLeftColor: theme.colors.primary }}
        borderRadius="s"
        justifyContent="center"
        paddingHorizontal="m"
      >
        <Text variant="body-md">{text1}</Text>
      </Box>
    );
  },
};

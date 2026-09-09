import React from 'react';
import { TouchableOpacity } from 'react-native';
import {
  BaseToast,
  ErrorToast,
  BaseToastProps,
  ToastConfig,
} from 'react-native-toast-message';
import { theme } from '../../core/theme';
import { Box, Text } from '../base';

// 1. Estilos base compartidos (100% DRY y apoyados en tus tokens de Restyle)
const baseToastStyle = {
  backgroundColor: theme.colors.cardBackground,
  width: '90%' as const,
  height: 'auto' as const,
  minHeight: 65,
  borderRadius: theme.borderRadii.m,
  borderLeftWidth: 6,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 8,
  elevation: 8,
};

const contentContainerStyle = {
  paddingHorizontal: 16,
  paddingVertical: 10, // Da aire arriba y abajo para mensajes de 2 a 4 renglones
};

const text1Style = {
  fontSize: 15,
  fontFamily: 'Montserrat-Bold',
  color: theme.colors.textPrimary,
};

const text2Style = {
  fontSize: 13,
  fontFamily: 'Montserrat-Regular',
  color: theme.colors.textSecondary,
  marginTop: 4,
  lineHeight: 18,
};

// 2. Configuración Oficial con Tipado Estricto de ToastConfig
export const toastConfig: ToastConfig = {
  // Éxito (Verde Forest)
  success: (props: BaseToastProps) => (
    <BaseToast
      {...props}
      style={[
        baseToastStyle,
        { borderLeftColor: theme.colors.success || '#28a745' },
      ]}
      contentContainerStyle={contentContainerStyle}
      text1Style={text1Style}
      text2Style={text2Style}
      text1NumberOfLines={2}
      text2NumberOfLines={4}
    />
  ),

  // Error (Rojo Fire)
  error: (props: BaseToastProps) => (
    <ErrorToast
      {...props}
      style={[
        baseToastStyle,
        { borderLeftColor: theme.colors.error || '#dc3545' },
      ]}
      contentContainerStyle={contentContainerStyle}
      text1Style={text1Style}
      text2Style={text2Style}
      text1NumberOfLines={2}
      text2NumberOfLines={4}
    />
  ),

  // Info (Azul)
  info: (props: BaseToastProps) => (
    <BaseToast
      {...props}
      style={[baseToastStyle, { borderLeftColor: '#2196F3' }]}
      contentContainerStyle={contentContainerStyle}
      text1Style={text1Style}
      text2Style={text2Style}
      text1NumberOfLines={2}
      text2NumberOfLines={4}
    />
  ),

  // Warning (Ámbar)
  warning: (props: BaseToastProps) => (
    <BaseToast
      {...props}
      style={[baseToastStyle, { borderLeftColor: '#f59e0b' }]}
      contentContainerStyle={contentContainerStyle}
      text1Style={text1Style}
      text2Style={text2Style}
      text1NumberOfLines={2}
      text2NumberOfLines={4}
    />
  ),

  // Selene Brand Toast (Dorado de Selene interactivo y multilínea)
  seleneToast: (props: BaseToastProps) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={props.onPress}
      style={{ width: '100%', alignItems: 'center' }}
    >
      <Box
        width="90%"
        backgroundColor="cardBackground"
        borderLeftWidth={6}
        borderLeftColor="primary"
        borderRadius="m"
        padding="m"
        minHeight={65}
        justifyContent="center"
        style={{
          shadowColor: theme.colors.primary,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 6,
          elevation: 6,
        }}
      >
        {props.text1 && (
          <Text variant="body-md" fontWeight="bold" color="textPrimary">
            {props.text1}
          </Text>
        )}
        {props.text2 && (
          <Text
            variant="body-sm"
            color="textSecondary"
            marginTop="xs"
            style={{ lineHeight: 18 }}
          >
            {props.text2}
          </Text>
        )}
      </Box>
    </TouchableOpacity>
  ),
};

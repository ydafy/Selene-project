import React from 'react';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { TouchableOpacity, BackHandler } from 'react-native'; // Importamos BackHandler
import { useEffect } from 'react';

import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { Theme } from '../../core/theme';
import { useSellStore } from '../../core/store/useSellStore'; // <--- 1. Importamos el Store

export default function SellSuccessScreen() {
  const { t } = useTranslation('sell');
  const router = useRouter();
  const theme = useTheme<Theme>();

  // 2. Obtenemos la función para limpiar el borrador
  const { resetDraft } = useSellStore();

  const { productId } = useLocalSearchParams<{ productId: string }>();

  // 3. BLOQUEO TOTAL DEL BOTÓN ATRÁS (Android)
  useEffect(() => {
    const onBackPress = () => {
      // Retornar true evita que el botón físico haga algo
      return true;
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress,
    );
    return () => subscription.remove();
  }, []);

  const handleVerifyNow = () => {
    if (!productId) return;

    // 4. Limpiamos datos AHORA, justo antes de irnos
    resetDraft();

    router.push({
      pathname: '/verify/[id]',
      params: { id: productId },
    });
  };

  const handleLater = () => {
    resetDraft();

    router.dismissAll();
    router.replace('/(tabs)/profile');
  };

  return (
    <Box
      flex={1}
      backgroundColor="background"
      justifyContent="center"
      alignItems="center"
      paddingHorizontal="l"
    >
      {/* 5. BLOQUEO DE GESTOS (iOS) Y HEADER */}
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: false, // Evita deslizar para volver en iPhone
          headerLeft: () => null, // Oculta flecha si apareciera
        }}
      />

      {/* Icono Hero */}
      <Box
        width={120}
        height={120}
        borderRadius="full"
        backgroundColor="cardBackground"
        justifyContent="center"
        alignItems="center"
        marginBottom="xl"
        style={{
          shadowColor: theme.colors.primary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.4,
          shadowRadius: 20,
          elevation: 10,
        }}
      >
        <MaterialCommunityIcons
          name="shield-check"
          size={64}
          color={theme.colors.primary}
        />
      </Box>

      {/* Textos */}
      <Text variant="header-xl" textAlign="center" marginBottom="m">
        {t('success.title')}
      </Text>

      <Text
        variant="body-md"
        color="textSecondary"
        textAlign="center"
        marginBottom="xl"
        style={{ lineHeight: 24 }}
      >
        {t('success.subtitle')}
      </Text>

      {/* Acciones */}
      <Box width="100%" gap="m">
        <PrimaryButton onPress={handleVerifyNow} icon="camera-outline">
          {t('success.verifyNow')}
        </PrimaryButton>

        <TouchableOpacity onPress={handleLater} activeOpacity={0.7}>
          <Box padding="m" alignItems="center">
            <Text
              variant="body-md"
              color="textSecondary"
              textDecorationLine="underline"
            >
              {t('success.later')}
            </Text>
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
}

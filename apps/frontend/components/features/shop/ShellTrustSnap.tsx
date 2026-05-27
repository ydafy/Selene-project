/**
 * @file components/features/shop/sections/ShellTrustSnap.tsx
 * @description Versión 3.0: Cinematic Edition.
 * Utiliza video nativo en loop para un impacto visual de alta gama.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { BlurView } from 'expo-blur';
import { AppVideo } from '../../ui/AppVideo';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Theme } from '../../../core/theme';

import TrustVideo from '../../../assets/videos/shop/Trustvideo.mp4';
import rtx from '../../../assets/images/shop/5090.jpg';

const ShellTrustSnapComponent = ({
  visibleHeight,
  isActive,
}: {
  visibleHeight: number;
  isActive: boolean;
}) => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { t } = useTranslation('search');

  return (
    <Box height={visibleHeight} backgroundColor="black" overflow="hidden">
      {/* 2. VIDEO DE FONDO (Capa Principal) */}
      <AppVideo source={TrustVideo} posterSource={rtx} shouldPlay={isActive} />

      {/* 3. CONTENIDO FLOTANTE (Estilo Etiqueta Lateral Snapped) */}
      <Box flex={1} justifyContent="flex-end" paddingBottom="xl">
        <Box
          alignSelf="flex-start"
          maxWidth="85%"
          // Quitamos el redondeado de la izquierda para que parezca que sale de la orilla
          borderTopRightRadius="l"
          borderBottomRightRadius="l"
          overflow="hidden"
          borderWidth={0.5}
          borderLeftWidth={0}
          borderColor="blurBackground"
          style={[
            styles.glassContainer,
            { marginLeft: -2 }, // Pequeño ajuste para asegurar que toque el borde
          ]}
        >
          <BlurView intensity={50} tint="dark" style={styles.blurPadding}>
            {/* Línea de Acento en la pura orilla */}
            <Box
              position="absolute"
              left={0}
              top={0}
              bottom={0}
              width={4}
              backgroundColor="primary"
            />

            <Box paddingLeft="m">
              <Text variant="header-xl" color="textPrimary">
                {t('search:verifiedBySelene')}
              </Text>

              <Text
                variant="caption-lg"
                color="textPrimary"
                style={{ lineHeight: 18, opacity: 0.8, marginBottom: 16 }}
              >
                {t('search:shellTrustSnap.trustMsg')}
              </Text>

              <PrimaryButton
                // ESTA SCREEN LO LA EH CREADO
                onPress={() => router.push('/help/verification')}
                variant="outline"
                icon="chevron-right"
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 20,
                  borderColor: theme.colors.primary,
                }}
                labelStyle={{ fontSize: 12 }}
              >
                {t('search:shellTrustSnap.trustButton')}
              </PrimaryButton>
            </Box>
          </BlurView>
        </Box>
      </Box>
    </Box>
  );
};

export const ShellTrustSnap = React.memo(ShellTrustSnapComponent);

const styles = StyleSheet.create({
  glassContainer: {},
  blurPadding: {
    padding: 24,
  },
});

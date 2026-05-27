/**
 * @file app/help/verification.tsx
 * @description Pantalla educativa sobre el proceso de verificación.
 */

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { Stack } from 'expo-router';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { AppVideo } from '../../components/ui/AppVideo';
import { GridShell } from '../../components/features/home/GridShell';
import { Theme } from '../../core/theme';
import { getSharedStyles } from '../../components/features/home/sharedStyles';

import TrustVideo from '../../assets/videos/shop/Trustvideo.mp4';
import rtx from '../../assets/images/shop/5090.jpg';

export default function VerificationHelpScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('help');
  const sharedStyles = getSharedStyles(theme);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const InfoCell = ({ title, desc, number }: any) => (
    <Box
      flex={1}
      padding="l"
      borderBottomWidth={1}
      borderBottomColor="separator"
    >
      <Box flexDirection="row" alignItems="center" gap="s" marginBottom="s">
        <Box
          width={20}
          height={20}
          borderRadius="full"
          backgroundColor="primary"
          justifyContent="center"
          alignItems="center"
        >
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: 'black' }}>
            {number}
          </Text>
        </Box>
        <Text style={[sharedStyles.monoText, { color: theme.colors.primary }]}>
          {title}
        </Text>
      </Box>
      <Text variant="body-md" color="textPrimary" style={{ lineHeight: 22 }}>
        {desc}
      </Text>
    </Box>
  );

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        showBack
        title={t('verification.title')}
        backgroundColor="cardBackground"
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 1. HERO VIDEO */}
        <Box height={350} width="100%" backgroundColor="black">
          <AppVideo source={TrustVideo} shouldPlay={true} posterSource={rtx} />
          <Box
            style={StyleSheet.absoluteFill}
            backgroundColor="black"
            opacity={0.3}
          />
          <Box flex={1} justifyContent="flex-end" padding="l">
            <Text variant="header-2xl" color="textPrimary">
              {t('verification.title')}
            </Text>
            <Text
              variant="body-lg"
              color="primary"
              style={{ fontStyle: 'italic' }}
            >
              {t('verification.subtitle')}
            </Text>
          </Box>
        </Box>

        {/* 2. EL MONOLITO EXPLICATIVO */}
        <Box padding="m" style={{ marginBottom: 40 }}>
          <GridShell>
            <InfoCell
              number="1"
              title={t('verification.step1.title')}
              desc={t('verification.step1.desc')}
            />
            <InfoCell
              number="2"
              title={t('verification.step2.title')}
              desc={t('verification.step2.desc')}
            />
            <InfoCell
              number="3"
              title={t('verification.step3.title')}
              desc={t('verification.step3.desc')}
            />

            <Box
              padding="l"
              alignItems="center"
              backgroundColor="preseableShadow"
            >
              <Text
                style={[sharedStyles.monoText, { fontSize: 8, opacity: 0.5 }]}
              >
                {t('verification.footer')}
              </Text>
            </Box>
          </GridShell>
        </Box>

        <Box height={100} />
      </ScrollView>
    </Box>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file components/features/home/sections/ShellEditorial.tsx
 * @description Carrusel editorial auditado.
 * Gestiona noticias y tendencias con navegación integrada a la tienda.
 */

import React, { memo, useCallback } from 'react';
import { ScrollView, Dimensions, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.83;

/**
 * Tarjeta Editorial Individual
 */
const EditorialCard = memo(
  ({ item, onSearch, t, theme, sharedStyles }: any) => (
    <Box
      width={CARD_WIDTH}
      marginRight="m"
      backgroundColor="cardBackground"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      padding="l"
      height={180}
      justifyContent="space-between"
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text
          style={[
            sharedStyles.monoText,
            { color: theme.colors.primary, fontSize: 8 },
          ]}
        >
          {item.tag}
        </Text>
        <MaterialCommunityIcons
          name={item.icon as any}
          size={18}
          color={theme.colors.primary}
          opacity={0.5}
        />
      </Box>

      <Box>
        <Text variant="subheader-md" fontWeight="bold" color="textPrimary">
          {item.title}
        </Text>
        <Text
          variant="caption-md"
          color="textSecondary"
          marginTop="xs"
          numberOfLines={2}
        >
          {item.desc}
        </Text>
      </Box>

      {/* Botón de Acción Minimalista */}
      <TouchableOpacity
        onPress={() => onSearch(item.params)}
        style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}
      >
        <Text
          variant="caption-md"
          color="primary"
          fontWeight="bold"
          style={{ letterSpacing: 1 }}
        >
          {t('editorial.actionLabel')}
        </Text>
        <MaterialCommunityIcons
          name="arrow-right"
          size={14}
          color={theme.colors.primary}
          style={{ marginLeft: 4 }}
        />
      </TouchableOpacity>
    </Box>
  ),
);

const ShellEditorialComponent = () => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { t } = useTranslation('home');
  const sharedStyles = getSharedStyles(theme);

  // Obtenemos los datos directamente del i18n (Tu CMS local)
  const cards = t('editorial.cards', { returnObjects: true }) as any[];

  /**
   * Ejecuta la búsqueda enviando todos los parámetros definidos en el JSON.
   */
  const handleSearch = useCallback(
    (params: Record<string, string>) => {
      router.push({
        pathname: '/store/results',
        params: params,
      });
    },
    [router],
  );

  return (
    <Box
      borderBottomWidth={1}
      borderBottomColor="separator"
      paddingVertical="l"
    >
      {/* 1. HEADER DE SECCIÓN */}
      <Box paddingHorizontal="l" marginBottom="l">
        <Text
          style={[
            sharedStyles.monoText,
            { color: theme.colors.primary, fontSize: 8 },
          ]}
        >
          {t('editorial.header')}
        </Text>
        <Text variant="header-xl" color="textPrimary" marginTop="xs">
          {t('editorial.title')}
        </Text>
      </Box>

      {/* 2. CARRUSEL */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + 16}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        {Array.isArray(cards) &&
          cards.map((item) => (
            <EditorialCard
              key={item.id}
              item={item}
              onSearch={handleSearch}
              t={t}
              theme={theme}
              sharedStyles={sharedStyles}
            />
          ))}
      </ScrollView>
    </Box>
  );
};

export const ShellEditorial = memo(ShellEditorialComponent);

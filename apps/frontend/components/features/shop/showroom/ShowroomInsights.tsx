/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file components/features/shop/showroom/ShowroomInsights.tsx
 * @description Versión 3.0: Action Dispatcher.
 * Maneja búsquedas inteligentes y preparada para contenido multimedia futuro.
 */

import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { Box, Text } from '../../../base';
import { AppImage } from '../../../ui/AppImage';

type SearchAction = {
  type: 'SEARCH';
  payload: {
    query?: string;
    category?: string;
    specs?: Record<string, string>;
  };
};

type LinkAction = {
  type: 'LINK';
  payload: { url: string };
};

type InfoAction = {
  type: 'INFO';
  payload: { topic: string };
};

type NewsAction = SearchAction | LinkAction | InfoAction;

type NewsItem = {
  id: string;
  title: string;
  desc: string;
  img: any;
  action?: NewsAction;
};

export const ShowroomInsights = memo(({ news }: { news: NewsItem[] }) => {
  const router = useRouter();

  /**
   * El "Cerebro" del componente: Decide qué hacer según la data.
   */
  const handleAction = useCallback(
    (action: NewsAction | undefined) => {
      if (!action) return;

      switch (action.type) {
        case 'SEARCH': {
          const params: Record<string, string> = {
            ...action.payload,
          } as Record<string, string>;
          if (params.specs) {
            params.specs = encodeURIComponent(JSON.stringify(params.specs));
          }
          router.push({
            pathname: '/store/results',
            params,
          });
          break;
        }

        case 'LINK':
          if (action.payload.url) Linking.openURL(action.payload.url);
          break;

        case 'INFO':
          console.log('Abrir guía de:', action.payload.topic);
          break;

        default:
          console.warn('Acción no reconocida');
      }
    },
    [router],
  );

  return (
    <Box marginTop="m">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,

          paddingBottom: 15,
        }}
        decelerationRate="fast"
      >
        {news.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => handleAction(item.action)}
            style={({ pressed }) => [
              styles.cardContainer,
              { transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            {/* Imagen de Fondo */}
            <AppImage
              source={item.img}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />

            {/* Gradiente de Legibilidad */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)']}
              style={StyleSheet.absoluteFill}
              locations={[0.4, 1]}
            />

            {/* Etiqueta Lateral (Side Label) */}
            <Box flex={1} justifyContent="flex-end">
              <Box
                alignSelf="flex-start"
                maxWidth="90%"
                borderTopRightRadius="m"
                overflow="hidden"
                borderWidth={0.5}
                borderLeftWidth={0}
                borderColor="blurBackground"
              >
                <BlurView
                  intensity={60}
                  tint="dark"
                  style={{ padding: 12, paddingLeft: 16 }}
                >
                  <Box
                    position="absolute"
                    left={0}
                    top={0}
                    bottom={0}
                    width={3}
                    backgroundColor="primary"
                  />
                  <Box gap="xs">
                    <Text
                      variant="subheader-md"
                      fontWeight="bold"
                      color="textPrimary"
                      numberOfLines={2}
                    >
                      {item.title.toUpperCase()}
                    </Text>
                    <Text
                      variant="caption-md"
                      color="textPrimary"
                      numberOfLines={3}
                    >
                      {item.desc}
                    </Text>
                  </Box>
                </BlurView>
              </Box>
            </Box>
          </Pressable>
        ))}
      </ScrollView>
    </Box>
  );
});

const styles = StyleSheet.create({
  cardContainer: {
    width: 350,
    height: 380,
    marginRight: 30,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#121212',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    // Sombra para profundidad
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
});

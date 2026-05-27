/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';

// --- CONSTANTES FUERA DEL RENDER ---
const GRID_LINES = [...Array(5)];

const TechnicalDocCard = memo(({ icon, title, color }: any) => {
  const theme = useTheme<Theme>();
  const activeColor = color || theme.colors.primary;

  return (
    <Box
      width="100%"
      height={100}
      backgroundColor="background"
      borderRadius="s"
      borderWidth={0.5}
      borderColor="separator"
      marginBottom="s"
      overflow="hidden"
    >
      <Box style={StyleSheet.absoluteFill} opacity={0.05} pointerEvents="none">
        {GRID_LINES.map((_, i) => (
          <React.Fragment key={i}>
            <Box
              position="absolute"
              top={i * 20}
              left={0}
              right={0}
              height={0.5}
              backgroundColor="foreground"
            />
            <Box
              position="absolute"
              left={i * 20}
              top={0}
              bottom={0}
              width={0.5}
              backgroundColor="foreground"
            />
          </React.Fragment>
        ))}
      </Box>
      <Box
        position="absolute"
        top={-1}
        right={-1}
        width={15}
        height={15}
        backgroundColor="cardBackground"
        borderBottomLeftRadius="s"
        borderWidth={0.5}
        borderColor="separator"
        zIndex={10}
      />
      <Box flex={1} justifyContent="center" alignItems="center" paddingTop="s">
        <MaterialCommunityIcons name={icon} size={24} color={activeColor} />
        <Text
          style={{
            fontFamily: 'System',
            fontSize: 8,
            fontWeight: 'bold',
            marginTop: 8,
            letterSpacing: 1,
          }}
          color="textPrimary"
        >
          {title.toUpperCase()}
        </Text>
      </Box>
    </Box>
  );
});

export const ShellFeatureSplit = memo(
  ({ title, subtitle, items, cards, isReversed }: any) => {
    const theme = useTheme<Theme>();
    return (
      <Box
        flexDirection={isReversed ? 'row-reverse' : 'row'}
        padding="l"
        borderBottomWidth={1}
        borderBottomColor="separator"
        minHeight={350}
      >
        <Box
          flex={1.3}
          justifyContent="center"
          paddingRight={isReversed ? undefined : 'm'}
          paddingLeft={isReversed ? 'm' : undefined}
        >
          <Text variant="header-xl" color="textPrimary" marginBottom="s">
            {title}
          </Text>
          <Text
            variant="body-sm"
            color="textSecondary"
            marginBottom="l"
            style={{ lineHeight: 20 }}
          >
            {subtitle}
          </Text>
          <Box gap="m">
            {items.map((item: any, i: number) => (
              <Box key={i} flexDirection="row" alignItems="center" gap="s">
                <MaterialCommunityIcons
                  name={item.icon}
                  size={16}
                  color={theme.colors.textPrimary}
                  opacity={0.6}
                />
                <Text
                  variant="caption-md"
                  color="textPrimary"
                  style={{ fontSize: 11, opacity: 0.8 }}
                >
                  {item.label}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
        <Box flex={1} justifyContent="center">
          {cards.map((card: any, i: number) => (
            <TechnicalDocCard key={i} {...card} />
          ))}
        </Box>
      </Box>
    );
  },
);

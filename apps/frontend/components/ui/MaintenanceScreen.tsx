import React from 'react';
import { MotiView } from 'moti';
import { Box, Text } from '../base';
import { getSharedStyles } from '../features/home/sharedStyles';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

export const MaintenanceScreen = () => {
  const theme = useTheme<Theme>();
  const styles = getSharedStyles(theme);

  return (
    <Box
      flex={1}
      backgroundColor="background"
      justifyContent="center"
      alignItems="center"
      padding="xl"
    >
      <MotiView
        from={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'timing', duration: 1000 }}
        style={{ alignItems: 'center' }}
      >
        <Box
          width={80}
          height={80}
          borderRadius="xl"
          borderWidth={1}
          borderColor="primary"
          justifyContent="center"
          alignItems="center"
          marginBottom="l"
        >
          <MotiView
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ loop: true, duration: 2000 }}
          >
            <Box
              width={20}
              height={20}
              backgroundColor="primary"
              borderRadius="full"
            />
          </MotiView>
        </Box>

        <Text
          style={[
            styles.monoText,
            { color: theme.colors.primary, marginBottom: 8 },
          ]}
        >
          [ SYSTEM_STATUS: UNDER_MAINTENANCE ]
        </Text>

        <Text variant="header-xl" textAlign="center" color="textPrimary">
          Laboratorio en Optimización
        </Text>

        <Text
          variant="body-md"
          textAlign="center"
          color="textSecondary"
          marginTop="m"
          style={{ lineHeight: 24 }}
        >
          Nuestros NetRunners están calibrando los sistemas. Volveremos en
          breve.
        </Text>

        <Box marginTop="xl" opacity={0.3}>
          <Text style={styles.monoText}>REF_CODE: SELENE_CORE_OFFLINE</Text>
        </Box>
      </MotiView>
    </Box>
  );
};

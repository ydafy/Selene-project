import React, { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Box, Text } from '../base';
import { getSharedStyles } from '../../theme/shared-styles';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../theme';

const fadeScaleIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.9 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(1000);

export const MaintenanceScreen = () => {
  const theme = useTheme<Theme>();
  const styles = getSharedStyles(theme);
  const pulse = useSharedValue(0.2);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000 }),
        withTiming(0.2, { duration: 2000 }),
      ),
      -1,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Box
      flex={1}
      backgroundColor="background"
      justifyContent="center"
      alignItems="center"
      padding="xl"
    >
      <Animated.View entering={fadeScaleIn} style={{ alignItems: 'center' }}>
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
          <Animated.View style={pulseStyle}>
            <Box
              width={20}
              height={20}
              backgroundColor="primary"
              borderRadius="full"
            />
          </Animated.View>
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
      </Animated.View>
    </Box>
  );
};

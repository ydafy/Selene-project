/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file components/features/home/sections/ShellTrust.tsx
 * @description Versión 7.0: Audit Core.
 * Transforma la confianza en una visualización técnica de grado industrial.
 */

import React from 'react';

import { MotiView } from 'moti';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

export const ShellTrust = () => {
  const theme = useTheme<Theme>();
  const sharedStyles = getSharedStyles(theme);

  const Mono = ({
    children,
    color = 'textSecondary',
    size = 8,
    opacity = 1,
  }: any) => (
    <Text
      style={[
        sharedStyles.monoText,
        {
          color: theme.colors[color as keyof Theme['colors']] as string,
          fontSize: size,
          opacity,
        },
      ]}
    >
      {children}
    </Text>
  );

  return (
    <Box borderBottomWidth={1} borderBottomColor="separator">
      {/* 1. CABECERA DE SECCIÓN */}
      <Box
        paddingHorizontal="l"
        paddingVertical="s"
        backgroundColor="preseableShadow"
        borderBottomWidth={1}
        borderBottomColor="separator"
      >
        <Mono color="primary">TRUST_INFRASTRUCTURE // SECURITY_LAYER_01</Mono>
      </Box>

      {/* 2. CELDA MAESTRA: ESCROW VAULT (DINERO) */}
      <Box
        padding="l"
        borderBottomWidth={1}
        borderBottomColor="separator"
        minHeight={180}
      >
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="flex-start"
        >
          <Box flex={1} gap="s">
            <Mono color="primary">[ PROTOCOLO_ESCROW ]</Mono>
            <Text variant="header-xl" color="textPrimary">
              Tu pago está blindado
            </Text>
            <Text
              variant="body-sm"
              color="textSecondary"
              style={{ lineHeight: 18, opacity: 0.8 }}
            >
              Selene congela los fondos en una cámara acorazada digital. El
              vendedor solo cobra cuando tú validas el hardware.
            </Text>
          </Box>
        </Box>

        {/* Visual: Pipeline de Dinero */}
        <Box flexDirection="row" alignItems="center" marginTop="l" gap="s">
          <Mono size={7}>USER_PAY</Mono>
          <Box flex={1} height={1} backgroundColor="separator" opacity={0.2} />
          <MotiView
            animate={{
              backgroundColor: [
                theme.colors.primary,
                theme.colors.success,
                theme.colors.primary,
              ],
            }}
            transition={{ loop: true, duration: 2000 }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: theme.colors.primary,
            }}
          >
            <Mono color="primary" size={7}>
              VAULT_HOLDING
            </Mono>
          </MotiView>
          <Box flex={1} height={1} backgroundColor="separator" opacity={0.2} />
          <Mono size={7} opacity={0.3}>
            SELLER_RELEASE
          </Mono>
        </Box>
      </Box>

      {/* 3. FILA INFERIOR: BENCHMARKS & CAJA NEGRA (50/50) */}
      <Box flexDirection="row" height={180}>
        {/* CELDA: BENCHMARKS (VERDAD TÉCNICA) */}
        <Box
          flex={1}
          padding="m"
          borderRightWidth={1}
          borderRightColor="separator"
          justifyContent="space-between"
        >
          <Box gap="xs">
            <Mono color="primary">02_TECH_VERDICT</Mono>
            <Text variant="body-md" fontWeight="bold" color="textPrimary">
              VERDAD TÉCNICA
            </Text>
          </Box>

          {/* Visual: Micro-Gráfico de Benchmarks */}
          <Box
            flexDirection="row"
            alignItems="flex-end"
            gap="xs"
            height={30}
            opacity={0.6}
          >
            {[40, 70, 50, 90, 60, 80].map((h, i) => (
              <MotiView
                key={i}
                from={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{
                  type: 'timing',
                  loop: true,
                  delay: i * 100,
                  duration: 2000,
                }}
                style={{
                  width: 3,
                  backgroundColor: theme.colors.primary,
                  borderRadius: 1,
                }}
              />
            ))}
          </Box>

          <Text
            variant="caption-md"
            color="textSecondary"
            style={{ fontSize: 9, lineHeight: 13 }}
          >
            Benchmarks de estrés y pruebas de estabilidad obligatorias.
          </Text>
        </Box>

        {/* CELDA: CAJA NEGRA (SERIAL CHECK) */}
        <Box flex={1} padding="m" justifyContent="space-between">
          <Box gap="xs">
            <Mono color="primary">03_BLACK_BOX</Mono>
            <Text variant="body-md" fontWeight="bold" color="textPrimary">
              CAJA NEGRA
            </Text>
          </Box>

          {/* Visual: Escaneo de Número de Serie */}
          <Box
            backgroundColor="background"
            padding="xs"
            borderRadius="s"
            borderWidth={0.5}
            borderColor="separator"
          >
            <MotiView
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ loop: true, duration: 1000 }}
            >
              <Mono size={7} color="success">
                SN_MATCH: 100%
              </Mono>
            </MotiView>
            <Mono size={6} opacity={0.4}>
              REF_ID: SEN-2077-LUCY
            </Mono>
          </Box>

          <Text
            variant="caption-md"
            color="textSecondary"
            style={{ fontSize: 9, lineHeight: 13 }}
          >
            Registro fotográfico de sellos y números de serie de fábrica.
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

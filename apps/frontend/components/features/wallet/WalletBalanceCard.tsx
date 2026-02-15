import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import { Box, Text } from '../../base';
import { Skeleton } from '../../ui/Skeleton';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { AnimatedCounter } from '../../ui/AnimatedCounter'; // Importar nuevo componente
import { Theme } from '../../../core/theme';
import { MotiView } from 'moti';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Props {
  available: number;
  pending: number;
  isLoading: boolean;
  onWithdraw: () => void;
  isBankConfigured: boolean;
  onConfigureBank: () => void;
}

export const WalletBalanceCard = ({
  available,
  pending,
  isLoading,
  onWithdraw,
  isBankConfigured,
  onConfigureBank,
}: Props) => {
  const { t } = useTranslation(['wallet', 'common']);
  const theme = useTheme<Theme>();
  const [isBalanceHidden, setIsBalanceHidden] = useState(false);
  const [showEscrowInfo, setShowEscrowInfo] = useState(false);

  const togglePrivacy = () => {
    Haptics.selectionAsync();
    setIsBalanceHidden((prev) => !prev);
  };

  if (isLoading) {
    return (
      <Skeleton width="100%" height={180} borderRadius={theme.borderRadii.l} />
    );
  }

  return (
    <Box
      backgroundColor="cardBackground"
      padding="l"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      style={{
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      }}
    >
      {/* HEADER TARJETA: SALDO Y PRIVACIDAD */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="flex-start" // Alineación superior para dejar espacio al chip
        marginBottom="m"
      >
        <Box>
          <Box flexDirection="row" alignItems="center" marginBottom="xs">
            <MaterialCommunityIcons
              name="wallet-outline"
              size={18}
              color={theme.colors.textSecondary}
            />
            <Text variant="caption-lg" marginLeft="s" color="textSecondary">
              {t('balance.availableTitle')}
            </Text>
            {/* BOTÓN OJO (Integrado al título) */}
            <TouchableOpacity
              onPress={togglePrivacy}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Box marginLeft="s" opacity={0.6}>
                <MaterialCommunityIcons
                  name={isBalanceHidden ? 'eye-off-outline' : 'eye-outline'}
                  size={16}
                  color={theme.colors.textSecondary}
                />
              </Box>
            </TouchableOpacity>
          </Box>

          {/* SALDO ANIMADO (Protagonista absoluto) */}
          <AnimatedCounter
            value={available}
            isHidden={isBalanceHidden}
            variant="header-2xl"
            color="primary"
            style={{ fontSize: 36, lineHeight: 42 }} // Un poco más grande para impacto
          />
        </Box>

        {/* CHIP DE BANCO (Rediseñado) */}
        <TouchableOpacity onPress={onConfigureBank} activeOpacity={0.7}>
          {isBankConfigured ? (
            // ESTADO: CONFIGURADO (Discreto y Seguro)
            <Box
              flexDirection="row"
              alignItems="center"
              paddingVertical="xs"
              paddingHorizontal="s"
              borderRadius="full"
              borderWidth={1}
              borderColor="separator"
              style={{ backgroundColor: 'rgba(40, 167, 69, 0.1)' }} // Verde muy sutil
            >
              <MaterialCommunityIcons
                name="bank-check"
                size={16}
                color={theme.colors.success}
              />
              <Text
                variant="caption-md"
                marginLeft="xs"
                color="success"
                fontWeight="600"
              >
                {t('bankConfiguration.configured')}
              </Text>
            </Box>
          ) : (
            // ESTADO: NO CONFIGURADO (Llamativo pero elegante)
            <MotiView
              from={{ opacity: 0.8, scale: 1 }}
              animate={{ opacity: 1, scale: 1.02 }}
              transition={{ type: 'timing', duration: 1500, loop: true }}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                paddingVertical="xs"
                paddingHorizontal="s"
                borderRadius="full"
                borderWidth={1}
                borderColor="primary"
                style={{ backgroundColor: 'rgba(189, 159, 101, 0.1)' }} // Dorado sutil
              >
                <MaterialCommunityIcons
                  name="bank-plus"
                  size={16}
                  color={theme.colors.primary}
                />
                <Text variant="caption-md" marginLeft="xs" color="primary">
                  {t('bankConfiguration.setupAction')} {/* "Vincular Cuenta" */}
                </Text>
              </Box>
            </MotiView>
          )}
        </TouchableOpacity>
      </Box>

      {/* SEPARADOR SUTIL */}
      <Box
        height={1}
        backgroundColor="separator"
        opacity={0.5}
        marginBottom="m"
      />

      {/* FOOTER TARJETA: PENDIENTE Y ACCIÓN */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box>
          <Box flexDirection="row" alignItems="center">
            <Text variant="caption-md" color="textSecondary" marginRight="xs">
              {t('balance.pendingTitle')}
            </Text>

            {/* TOOLTIP ACTIVO */}
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                setShowEscrowInfo(true);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons
                name="information-outline"
                size={14}
                color={theme.colors.primary}
              />
            </TouchableOpacity>
          </Box>

          <AnimatedCounter
            value={pending}
            isHidden={isBalanceHidden}
            variant="subheader-md"
            color="textPrimary"
          />
        </Box>

        <PrimaryButton
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onWithdraw();
          }}
          disabled={available <= 0}
          style={{
            paddingHorizontal: 24,
            minHeight: 48, // Aseguramos un tamaño mínimo para el área táctil (UX)
            borderRadius: 22,
            backgroundColor:
              available > 0
                ? theme.colors.primary
                : theme.colors.cardBackground,
            borderWidth: available > 0 ? 0 : 1,
            borderColor: theme.colors.separator,
            justifyContent: 'center', // Asegura centrado vertical
            alignItems: 'center',
          }}
          labelStyle={{
            fontSize: 14,
            color: available > 0 ? '#000' : theme.colors.textSecondary,
            lineHeight: 26, // Ayuda a que la fuente no flote
            includeFontPadding: false, // Fix específico para Android
            textAlignVertical: 'center',
          }}
        >
          {t('actions.withdraw')}
        </PrimaryButton>
      </Box>
      <ConfirmDialog
        visible={showEscrowInfo}
        title={t('balance.infoEscrowTitle')}
        description={t('balance.infoEscrow')}
        onConfirm={() => setShowEscrowInfo(false)}
        onCancel={() => setShowEscrowInfo(false)}
        confirmLabel={t('common:dialog.understood') || 'Entendido'}
        hideCancel
        icon="information-outline"
      />
    </Box>
  );
};

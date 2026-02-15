import React, { useMemo, forwardRef, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { WalletTransaction } from '../../../../../packages/types/src/index';
import { formatCurrency } from '../../../core/utils/format';

export type TransactionDetailRef = BottomSheetModal;

interface Props {
  transaction: WalletTransaction | null;
}

export const TransactionDetailSheet = forwardRef<BottomSheetModal, Props>(
  ({ transaction }, ref) => {
    const theme = useTheme<Theme>();
    const { t } = useTranslation('wallet');
    const snapPoints = useMemo(() => ['55%'], []); // Un poco más alto para que quepa todo

    // 1. OPTIMIZACIÓN: Renderizado de filas memorizado
    const renderRow = useCallback(
      (
        label: string,
        amount: number | null | undefined,
        isDeduction = false,
        isTotal = false,
      ) => {
        if (amount === null || amount === undefined) return null;

        return (
          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text
              variant={isTotal ? 'subheader-md' : 'body-md'}
              color="textSecondary"
            >
              {label}
            </Text>
            <Text
              variant={isTotal ? 'subheader-md' : 'body-md'}
              color={
                isDeduction ? 'error' : isTotal ? 'success' : 'textPrimary'
              }
              fontWeight={isTotal ? 'bold' : 'regular'}
            >
              {isDeduction ? '-' : ''}
              {formatCurrency(amount)}
            </Text>
          </Box>
        );
      },
      [],
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.7}
        />
      ),
      [],
    );

    // 2. SEGURIDAD: Contenido condicional
    const content = useMemo(() => {
      if (!transaction) return <Box height={300} />; // Placeholder vacío para evitar crash

      const isSale = transaction.type === 'sale_proceeds';
      const isPositive = ['sale_proceeds', 'release', 'adjustment'].includes(
        transaction.type,
      );

      return (
        <Box padding="l">
          {/* Header del Modal */}
          <Box alignItems="center" marginBottom="l">
            <Box
              width={50}
              height={50}
              borderRadius="full"
              backgroundColor="cardBackground"
              justifyContent="center"
              alignItems="center"
              marginBottom="s"
            >
              <MaterialCommunityIcons
                name={isSale ? 'tag-text-outline' : 'bank-transfer-out'}
                size={34}
                color={isPositive ? theme.colors.success : theme.colors.error}
              />
            </Box>
            <Text variant="subheader-lg" marginBottom="xs" textAlign="center">
              {t(`types.${transaction.type}`)}
            </Text>
            <Text variant="caption-md" color="textSecondary">
              {new Date(transaction.created_at).toLocaleString()}
            </Text>
          </Box>

          {/* Tarjeta de Desglose */}
          <Box
            backgroundColor="background"
            padding="m"
            borderRadius="m"
            marginBottom="l"
          >
            {isSale ? (
              <>
                {renderRow(
                  t('transactionDetail.salePrice'),
                  transaction.amount,
                )}
                {renderRow(
                  t('transactionDetail.commission'),
                  transaction.fee_deducted,
                  true,
                )}
                {renderRow(
                  t('transactionDetail.shipping'),
                  transaction.shipping_cost,
                  true,
                )}
                {renderRow(
                  t('transactionDetail.shippingFee'),
                  transaction.insurance_amount,
                  true,
                )}
                <Box
                  height={1}
                  backgroundColor="separator"
                  marginVertical="s"
                />
                {renderRow(
                  t('transactionDetail.totalAmount'),
                  transaction.net_amount,
                  false,
                  true,
                )}
              </>
            ) : (
              // Para retiros u otros tipos
              <>
                {renderRow(
                  t('transactionDetail.requestedAmount'),
                  Math.abs(transaction.amount),
                )}

                {transaction.type === 'payout' && (
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    marginTop="s"
                  >
                    * Transferencia a tu cuenta bancaria
                  </Text>
                )}
              </>
            )}
          </Box>

          {/* Footer con ID */}
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            opacity={0.6}
          >
            <MaterialCommunityIcons
              name="identifier"
              size={16}
              color={theme.colors.textSecondary}
            />
            <Text variant="caption-md" color="textSecondary" marginLeft="s">
              ID: {transaction.id}
            </Text>
          </Box>
        </Box>
      );
    }, [transaction, theme, t, renderRow]);

    return (
      <BottomSheetModal
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
      >
        <BottomSheetView style={styles.contentContainer}>
          {content}
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  contentContainer: { flex: 1 },
});

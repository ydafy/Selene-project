import React, { useMemo } from 'react';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { OrderStatus } from '@selene/types';

interface Props {
  status: OrderStatus;
}

const STEPS = ['paid', 'preparing', 'shipped', 'delivered'];

export const OrderStepper = ({ status }: Props) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('orders');

  // --- FIX 1: Lógica de índice segura ---
  const currentStepIndex = useMemo(() => {
    if (status === 'completed') return 3;
    if (status === 'pending') return -1; // Ningún paso completado aún
    const idx = STEPS.indexOf(status);
    return idx; // Si es -1 (error/dispute), el stepper se verá "congelado"
  }, [status]);

  return (
    <Box paddingLeft="xs">
      {STEPS.map((step, index) => {
        const isCompleted = index < currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const isErrorState = ['cancelled', 'refunded', 'dispute'].includes(
          status,
        );
        const isFuture = index > currentStepIndex;
        const isLast = index === STEPS.length - 1;

        // Lógica de colores (Fix: El paso actual es dorado, los pasados verdes)
        const circleColor = isCompleted
          ? theme.colors.success
          : isCurrent
            ? isErrorState
              ? theme.colors.error
              : theme.colors.primary
            : 'transparent';

        const borderColor = isCompleted
          ? theme.colors.success
          : isCurrent
            ? isErrorState
              ? theme.colors.error
              : theme.colors.primary
            : theme.colors.separator;

        return (
          <Box key={step} flexDirection="row" minHeight={60}>
            {/* LADO IZQUIERDO: INDICADOR */}
            <Box alignItems="center" width={30}>
              <MotiView
                animate={{
                  backgroundColor: circleColor,
                  borderColor: borderColor,
                  scale: isCurrent ? 1.1 : 1,
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  zIndex: 2,
                  justifyContent: 'center',
                  alignItems: 'center',
                  shadowColor: isCurrent ? theme.colors.primary : 'transparent',
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: isCurrent ? 4 : 0,
                }}
              >
                {isCompleted ? (
                  <MaterialCommunityIcons
                    name="check"
                    size={14}
                    color="white"
                  />
                ) : isCurrent ? (
                  <Box
                    width={6}
                    height={6}
                    borderRadius={'s'}
                    backgroundColor="textPrimary"
                  />
                ) : null}
              </MotiView>

              {!isLast && (
                <Box
                  style={{
                    position: 'absolute',
                    top: 22,
                    bottom: -10,
                    width: 2,
                    backgroundColor:
                      index < currentStepIndex
                        ? theme.colors.success
                        : theme.colors.separator,
                    opacity: 0.4,
                    zIndex: 1,
                  }}
                />
              )}
            </Box>

            {/* LADO DERECHO: TEXTO */}
            <Box flex={1} marginLeft="m" paddingBottom="m">
              <Text
                variant="body-md"
                fontWeight={isCurrent ? 'regular' : 'regular'}
                color={
                  isCurrent
                    ? 'textPrimary'
                    : isCompleted
                      ? 'textPrimary'
                      : 'textSecondary'
                }
                style={{ opacity: isFuture ? 0.4 : 1 }}
              >
                {t(`orders:status.${step}`)}
              </Text>

              {isCurrent && (
                <MotiView
                  from={{ opacity: 0, translateY: -5 }}
                  animate={{ opacity: 1, translateY: 0 }}
                >
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    marginTop="xs"
                  >
                    {t(`orders:stepper.${step}_desc`)}
                  </Text>
                </MotiView>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

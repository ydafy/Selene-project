import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Animated, { withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '@/shared/ui/base';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Theme } from '@/shared/theme';

// Mount entrance: slides in from the left (spring, 2 s) while fading in (timing).
const truckEntering = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateX: -100 }] },
    animations: {
      opacity: withTiming(1),
      transform: [{ translateX: withSpring(0, { duration: 2000 }) }],
    },
  };
};

interface LabelSuccessDialogProps {
  visible: boolean;
  labelOpenError: boolean;
  onConfirm: () => void;
}

export function LabelSuccessDialog({
  visible,
  labelOpenError,
  onConfirm,
}: LabelSuccessDialogProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <ConfirmDialog
      visible={visible}
      title={t('orders:prepare.successTitle')}
      onConfirm={onConfirm}
      onCancel={() => {}}
      confirmLabel={t('orders:actions.viewPdf')}
      hideCancel
    >
      <Box alignItems="center" paddingVertical="m">
        <Animated.View entering={truckEntering}>
          <MaterialCommunityIcons
            name="truck-fast"
            size={80}
            color={theme.colors.primary}
          />
        </Animated.View>
        <Text variant="body-md" textAlign="center" marginTop="m">
          {t('orders:prepare.successMsg')}
        </Text>
        {labelOpenError && (
          <Text
            variant="body-sm"
            color="error"
            textAlign="center"
            marginTop="m"
          >
            {t('orders:prepare.errors.labelOpenFailed')}
          </Text>
        )}
      </Box>
    </ConfirmDialog>
  );
}

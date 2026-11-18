import { useMemo } from 'react';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { CustomerSheet } from '@stripe/stripe-react-native';
import Toast from 'react-native-toast-message';

import { invokeEdge } from '@/shared/lib/edge-client';
import { Theme } from '@/shared/theme';
import {
  createPaymentMethodsSecretProvider,
  customerSheetOutcome,
} from '../logic/payment-methods-sheet';

type PaymentMethodsSheetProps = {
  visible: boolean;
  onClose: () => void;
};

// Stripe CustomerSheet shows, adds and removes the buyer's saved cards.
// It renders nothing itself: `visible` presents the native sheet.
export const PaymentMethodsSheet = ({
  visible,
  onClose,
}: PaymentMethodsSheetProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('profile');

  const clientSecretProvider = useMemo(
    () =>
      createPaymentMethodsSecretProvider((name, body) =>
        invokeEdge(name, body),
      ),
    [],
  );

  return (
    <CustomerSheet.Component
      visible={visible}
      intentConfiguration={{ paymentMethodTypes: ['card'] }}
      clientSecretProvider={clientSecretProvider}
      merchantDisplayName="Selene Marketplace"
      headerTextForSelectionScreen={t('menu.paymentMethods')}
      appearance={{
        shapes: { borderRadius: 12 },
        colors: {
          primary: theme.colors.primary,
          background: theme.colors.cardBackground,
          componentBackground: theme.colors.background,
          componentBorder: theme.colors.separator,
          componentDivider: theme.colors.separator,
          primaryText: theme.colors.textPrimary,
          secondaryText: theme.colors.textSecondary,
          componentText: theme.colors.textPrimary,
          placeholderText: theme.colors.textSecondary,
          icon: theme.colors.primary,
          error: theme.colors.error,
        },
      }}
      onResult={(result) => {
        onClose();
        if (customerSheetOutcome(result) === 'failed') {
          Toast.show({
            type: 'error',
            text1: t('paymentMethods.errorTitle'),
            text2: t('paymentMethods.errorMessage'),
          });
        }
      }}
    />
  );
};

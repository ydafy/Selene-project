import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { CustomerSheet } from '@stripe/stripe-react-native';
import Toast from 'react-native-toast-message';

import { invokeEdge } from '@/shared/lib/edge-client';
import { Theme } from '@/shared/theme';
import {
  customerSheetOutcome,
  preparePaymentMethodsSession,
  type PaymentMethodsSession,
} from '../logic/payment-methods-sheet';

type PaymentMethodsSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** True while the secrets are fetched, before the native sheet opens. */
  onPreparingChange?: (preparing: boolean) => void;
};

// Stripe CustomerSheet shows, adds and removes the buyer's saved cards.
// It renders nothing itself: the native sheet opens once its secrets are
// fetched, and a failed fetch offers a retry instead of opening it.
export const PaymentMethodsSheet = ({
  visible,
  onClose,
  onPreparingChange,
}: PaymentMethodsSheetProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('profile');

  const [session, setSession] = useState<PaymentMethodsSession | null>(null);
  const [attempt, setAttempt] = useState(0);

  const offerRetry = (title: string) => {
    Alert.alert(title, t('paymentMethods.errorMessage'), [
      { text: t('common:dialog.cancel'), style: 'cancel', onPress: onClose },
      {
        text: t('paymentMethods.retry'),
        onPress: () => setAttempt((value) => value + 1),
      },
    ]);
  };

  useEffect(() => {
    if (!visible) return;
    // `active` stays true while this fetch may still change the screen.
    let active = true;
    const settle = () => {
      active = false;
      onPreparingChange?.(false);
    };
    onPreparingChange?.(true);
    preparePaymentMethodsSession((name, body) => invokeEdge(name, body)).then(
      (prepared) => {
        if (!active) return;
        settle();
        setSession(prepared);
      },
      () => {
        if (!active) return;
        settle();
        offerRetry(t('paymentMethods.errorTitle'));
      },
    );
    return () => {
      if (active) settle();
    };
    // Refetch only on a new opening or retry; the callbacks and t are per render.
  }, [visible, attempt]);

  if (!session) return null;

  return (
    <CustomerSheet.Component
      visible
      intentConfiguration={{ paymentMethodTypes: ['card'] }}
      clientSecretProvider={session.clientSecretProvider}
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
        setSession(null);
        if (session.setupIntentFailed()) {
          offerRetry(t('paymentMethods.addErrorTitle'));
          return;
        }
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

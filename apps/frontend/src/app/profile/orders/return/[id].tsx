/**
 * @file app/profile/orders/return/[id].tsx
 * Pantalla de preparación de retorno con Biometría y Generación Atómica.
 */

import React, { useState } from 'react';
import { ScrollView, Linking } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../../../shared/ui/base';
import { GlobalHeader } from '../../../../shared/ui/global-header';
import { ScreenHeader } from '../../../../shared/ui/screen-header';
import { PrimaryButton } from '../../../../shared/ui/primary-button';
import { ConfirmDialog } from '../../../../shared/ui/confirm-dialog';
import { EvidenceUploadSection } from '@/features/orders/components/evidence-upload-section';
import { useOrderById } from '../../../../features/orders/hooks/use-orders';
import { useOrderActions } from '../../../../features/orders/hooks/use-order-actions';
import { authenticateAsync } from '../../../../core/utils/biometrics';
import Animated, { withSpring, withTiming } from 'react-native-reanimated';
import { theme } from '@/shared/theme';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';

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

export default function PrepareReturnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['orders', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: order, isLoading } = useOrderById(id);
  const actions = useOrderActions(id || '');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  /**
   * Maneja el proceso de confirmación de retorno:
   * 1. Biometría -> 2. Guardar Evidencia -> 3. Generar Guía -> 4. Mostrar Éxito
   */
  const handleConfirmReturn = async () => {
    if (!order?.dispute?.id || evidenceUrls.length < 3) return;

    const auth = await authenticateAsync(t('orders:prepare.securityReason'));
    if (!auth.success) return;

    try {
      // 3. Fase de Persistencia (RPC)
      // Guardamos las URLs de las fotos en la tabla de disputas
      await actions.submitReturnEvidence.execute({
        disputeId: order.dispute.id,
        images: evidenceUrls,
      });

      const result = await actions.generateReturnLabel.execute({
        disputeId: order.dispute.id,
      });

      if (result?.success && result?.labelUrl) {
        setLabelUrl(result.labelUrl);

        // Feedback físico y visual
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowSuccess(true);
      } else if (result?.success) {
        setShowSuccess(true);
      }
    } catch (error: unknown) {
      // Manejo centralizado de errores (Stripe, Envia, Supabase)
      console.error('[RETURN_FLOW_ERROR]', error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : 'No se pudo procesar el retorno. Intenta de nuevo.';

      Toast.show({
        type: 'error',
        text1: t('common:errors.title'),
        text2: errorMessage,
      });
    }
  };

  if (isLoading || !order) return null;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader showBack title={t('return.globalHeaderTitle')} />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 80,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <ScreenHeader
          title={t('return.screenHeaderTitle')}
          subtitle={t('return.screenHeaderSubtitle')}
        />

        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="l"
          marginVertical="l"
          borderLeftWidth={4}
          borderLeftColor="primary"
        >
          <Text variant="body-sm" color="textPrimary">
            {t('return.photoMessage')}
          </Text>
        </Box>

        <EvidenceUploadSection
          orderId={id || ''}
          userId={order.buyer_id}
          onEvidenceComplete={setEvidenceUrls}
          folder="returns"
        />
        <Box marginTop={'l'} />
        <PrimaryButton
          onPress={handleConfirmReturn}
          loading={
            actions.submitReturnEvidence.isLoading ||
            actions.generateReturnLabel.isLoading
          }
          disabled={evidenceUrls.length < 3}
          icon="barcode-scan"
        >
          {t('return.buttonText')}
        </PrimaryButton>
      </ScrollView>

      <ConfirmDialog
        visible={showSuccess}
        title={t('orders:prepare.successTitle')}
        onConfirm={() => {
          setShowSuccess(false);
          if (labelUrl) {
            Linking.openURL(labelUrl).catch((err) =>
              console.error("Couldn't load page", err),
            );
          }
          router.replace(`/profile/orders/${id}`);
        }}
        onCancel={() => setShowSuccess(false)}
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
        </Box>
      </ConfirmDialog>
    </Box>
  );
}

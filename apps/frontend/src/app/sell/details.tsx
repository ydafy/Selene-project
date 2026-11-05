import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { Box } from '@/shared/ui/base';
import { GlobalHeader } from '@/shared/ui/global-header';
import { ScreenHeader } from '@/shared/ui/screen-header';
import { WizardSteps } from '@/features/sell/components/wizard-steps';
import { SellDetailsForm } from '@/features/sell/components/sell-details-form';
import { SELL_STEP_DEFINITIONS } from '@/features/sell/logic/sell-steps';

import { useSellDetailsForm } from '@/features/sell/hooks/use-sell-details-form';
import { useSellStore } from '@/features/sell/store/use-sell-store';

export default function SellDetailsScreen() {
  const { t } = useTranslation(['sell']);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Obtenemos la categoría directamente para la guarda de ruta
  const category = useSellStore((state) => state.draft.category);

  // El nuevo hook maneja toda la lógica compleja
  const formProps = useSellDetailsForm();

  useEffect(() => {
    if (!category) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/sell');
      }
    }
  }, [category, router]);

  // 3. Renderizado Condicional:
  // Si no hay categoría, retornamos null para no pintar nada mientras redirige.
  if (!category) return null;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        title={t('sell:title')}
        showBack={true}
        backgroundColor="cardBackground"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, marginBottom: insets.bottom }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: insets.top + 80,
            paddingBottom: 40,
            paddingHorizontal: 16,
          }}
        >
          <ScreenHeader
            title={t('sell:screenTitle.detailsTitle')}
            subtitle={t('sell:screenTitle.detailsSubtitle')}
          />
          <WizardSteps
            currentStep={0}
            steps={SELL_STEP_DEFINITIONS.map((s) => t(s.labelKey as string))}
          />

          {/* El componente de UI puro recibe todos los props del hook */}
          <SellDetailsForm {...formProps} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
}

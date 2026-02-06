import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { Box } from '@/components/base';
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { WizardSteps } from '@/components/features/sell/WizardSteps';
import { SellDetailsForm } from '@/components/features/sell/SellDetailsForm';

import { useSellDetailsForm } from '@/core/hooks/useSellDetailsForm';
import { useSellStore } from '@/core/store/useSellStore';

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
        title={t('sell:steps.details')}
        showBack={true}
        backgroundColor="cardBackground"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
          <WizardSteps currentStep={0} />

          {/* El componente de UI puro recibe todos los props del hook */}
          <SellDetailsForm {...formProps} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
}

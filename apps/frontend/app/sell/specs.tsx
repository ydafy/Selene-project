/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { WizardSteps } from '../../components/features/sell/WizardSteps';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useSellStore } from '../../core/store/useSellStore';
import { SELL_FORM_CONFIG } from '../../core/config/sell-form-config';
import { DynamicSpecField } from '../../components/features/sell/DynamicSpecField';

export default function SellSpecsScreen() {
  const { t } = useTranslation(['sell', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { draft, updateDraft } = useSellStore();
  const category = draft.category;

  // Configuración y Schema (Lógica existente)
  const formConfig = useMemo(() => {
    if (!category || !SELL_FORM_CONFIG[category]) return [];
    return SELL_FORM_CONFIG[category];
  }, [category]);

  const dynamicSchema = useMemo(() => {
    const shape: Record<string, any> = {};
    formConfig.forEach((field) => {
      shape[field.name] = z.string().min(1, 'sell:errors.conditionRequired');
      shape[`${field.name}_custom`] = z.string().optional();
    });
    return z.object(shape).superRefine((data, ctx) => {
      formConfig.forEach((field) => {
        const value = data[field.name] as string | undefined;
        const customValue = data[`${field.name}_custom`] as string | undefined;
        if (
          value &&
          value.includes('Other') &&
          (!customValue || customValue.trim().length < 2)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: 'sell:errors.specifyRequired',
            path: [`${field.name}_custom`],
          });
        }
      });
    });
  }, [formConfig]);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(dynamicSchema),
    mode: 'onChange',
    defaultValues: draft.specifications || {},
  });

  //   useEffect(() => {
  //     if (!category) router.replace('/sell');
  //   }, [category, router]);

  const onSubmit = (data: Record<string, any>) => {
    // Limpieza de datos (igual que antes)
    const cleanData: Record<string, any> = {};
    Object.entries(data).forEach(([key, value]) => {
      if (key.endsWith('_custom')) {
        const parentKey = key.replace('_custom', '');
        if (data[parentKey]?.includes('Other')) {
          cleanData[key] = value;
        }
      } else {
        cleanData[key] = value;
      }
    });

    // 2. CORRECCIÓN CRÍTICA:
    // En lugar de updateSpecs('all', ...), actualizamos el draft completo.
    updateDraft({ specifications: cleanData });

    console.log('Specs Saved:', cleanData);
    router.push('/sell/images');
  };

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
        style={{ flex: 1 }}
      >
        <Box flex={1}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingTop: insets.top + 100,
              paddingBottom: insets.bottom + 40,
              paddingHorizontal: 16,
            }}
          >
            {/* Header dinámico con i18n */}
            <ScreenHeader
              title={t('sell:fields.specsTitle')}
              subtitle={t('sell:fields.specsSubtitle')}
            />

            {/* PASO 2: Specs (Paso 1 completado se verá con check) */}
            <WizardSteps currentStep={1} />

            {/* TARJETA DE ESPECIFICACIONES */}
            <Box
              backgroundColor="cardBackground"
              borderRadius="l"
              padding="m"
              marginTop="m"
              shadowColor="focus"
              shadowOpacity={0.3}
              shadowOffset={{ width: 0, height: 4 }}
              shadowRadius={8}
              elevation={5}
            >
              {formConfig.map((field) => (
                <DynamicSpecField
                  key={field.name}
                  field={field}
                  control={control}
                  errors={errors}
                  setValue={setValue}
                />
              ))}

              {formConfig.length === 0 && (
                <Text
                  variant="body-md"
                  textAlign="center"
                  color="textSecondary"
                  paddingVertical="l"
                >
                  No hay especificaciones adicionales para esta categoría.
                </Text>
              )}
            </Box>

            <Box height={30} />

            <PrimaryButton
              onPress={handleSubmit(onSubmit)}
              disabled={!isValid && formConfig.length > 0}
            >
              {t('sell:fields.next')}
            </PrimaryButton>
          </ScrollView>
        </Box>
      </KeyboardAvoidingView>
    </Box>
  );
}

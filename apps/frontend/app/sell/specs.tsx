/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useEffect, useRef } from 'react';
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
import { checkIfOther } from '@/core/utils/form-helpers';
import { SELL_STEP_DEFINITIONS } from '@/core/constants/sellSteps';

export default function SellSpecsScreen() {
  const { t } = useTranslation(['sell', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { draft, updateDraft, resetCategoryFields } = useSellStore();
  const category = draft.category;

  // Configuración y Schema (Lógica existente)
  const formConfig = useMemo(() => {
    if (!category || !SELL_FORM_CONFIG[category]) return [];
    return SELL_FORM_CONFIG[category];
  }, [category]);

  const dynamicSchema = useMemo(() => {
    const shape: Record<string, z.ZodString | z.ZodOptional<z.ZodString>> = {};

    formConfig.forEach((field) => {
      shape[field.name] = z.string().min(1, 'sell:errors.required');
      shape[`${field.name}_custom`] = z.string().optional();
    });
    return z.object(shape).superRefine((data: any, ctx) => {
      formConfig.forEach((field) => {
        const value = data[field.name];
        const customValue = data[`${field.name}_custom`];

        // FIX: Usamos el mismo helper que el componente UI
        if (
          checkIfOther(value) &&
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
    reset,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(dynamicSchema),
    mode: 'onChange',
    defaultValues:
      (draft.specifications as Record<string, string | undefined>) || {},
  });

  // Reset category-dependent fields when the category changes mid-draft.
  const previousCategoryRef = useRef(category);
  useEffect(() => {
    const previousCategory = previousCategoryRef.current;
    previousCategoryRef.current = category;

    if (category && previousCategory && previousCategory !== category) {
      resetCategoryFields();
      reset({});
    }
  }, [category, reset, resetCategoryFields]);

  //   useEffect(() => {
  //     if (!category) router.replace('/sell');
  //   }, [category, router]);

  const onSubmit = (data: Record<string, string | undefined>) => {
    const cleanData: Record<string, string> = {};

    Object.entries(data).forEach(([key, value]) => {
      // Solo procesamos si el valor existe (no es undefined)
      if (value === undefined) return;

      if (key.endsWith('_custom')) {
        const parentKey = key.replace('_custom', '');
        if (checkIfOther(data[parentKey])) {
          cleanData[key] = value;
        }
      } else {
        cleanData[key] = value;
      }
    });

    updateDraft({ specifications: cleanData });
    router.push('/sell/images');
  };

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
            <WizardSteps
              currentStep={1}
              steps={SELL_STEP_DEFINITIONS.map((s) => t(s.labelKey as string))}
            />

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
              {t('sell:fields.noSpecs')}
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

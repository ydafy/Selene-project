import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

// Imports de UI
import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { FormSelect } from '../../components/ui/FormSelect';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { WizardSteps } from '../../components/features/sell/WizardSteps';

import { useSellStore } from '../../core/store/useSellStore';
import {
  PRODUCT_CONDITIONS,
  PRODUCT_USAGE_OPTIONS,
} from '../../core/constants/product-data';

// ... (El schema Zod se queda igual) ...
const detailsSchema = z.object({
  name: z
    .string()
    .min(5, 'sell:errors.nameRequired')
    .max(80, 'sell:errors.nameTooLong'),

  price: z
    .string()
    .min(1, 'sell:errors.priceRequired')
    .refine((val) => !isNaN(Number(val)), 'sell:errors.priceInvalid'),
  condition: z.string().min(1, 'sell:errors.conditionRequired'),
  usage: z.string().min(1, 'sell:errors.usageRequired'),
  description: z
    .string()
    .min(20, 'sell:errors.descriptionRequired')
    .max(1000, 'sell:errors.descriptionTooLong'),
});

type DetailsFormData = z.infer<typeof detailsSchema>;

export default function SellDetailsScreen() {
  const { t } = useTranslation(['sell', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { draft, updateDraft } = useSellStore();

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<DetailsFormData>({
    resolver: zodResolver(detailsSchema),
    mode: 'onChange',
    defaultValues: {
      name: draft.name,
      price: draft.price,
      condition: draft.condition,
      usage: draft.usage,
      description: draft.description,
    },
  });

  const onSubmit = (data: DetailsFormData) => {
    updateDraft(data);
    router.push('/sell/specs');
  };

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
        enabled={true}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 60 : 0}
        style={{
          flex: 1,
          marginBottom: Platform.OS === 'ios' ? 0 : insets.bottom,
        }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: insets.top + 100,
            paddingBottom: 20,
            paddingHorizontal: 16,
          }}
        >
          <ScreenHeader
            title={t('sell:screenTitle.detailsTitle')}
            subtitle={t('sell:screenTitle.detailsSubtitle')}
          />
          <WizardSteps currentStep={0} />

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
            {/* 1. TÍTULO */}
            <Controller
              control={control}
              name="name"
              render={({ field: { onChange, onBlur, value } }) => (
                <Box marginBottom="l">
                  <FormTextInput
                    label={t('sell:fields.nameLabel')} // Label externo estandarizado
                    labelMode="static"
                    helpTitle={t('sell:fields.nameHelpTitle')} // Ayuda integrada
                    helpDescription={t('sell:fields.nameHelpDesc')}
                    placeholder={t('sell:fields.namePlaceholder')}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.name}
                  />
                  <Box
                    flexDirection="row"
                    justifyContent="space-between"
                    marginTop="xs"
                  >
                    <Box flex={1}>
                      {errors.name && (
                        <Text variant="body-sm" color="error">
                          {t(errors.name.message as string)}
                        </Text>
                      )}
                    </Box>
                    <Text
                      variant="caption-md"
                      color={value.length > 80 ? 'error' : 'textSecondary'}
                    >
                      {value.length} / 80
                    </Text>
                  </Box>
                </Box>
              )}
            />

            {/* 2. PRECIO */}
            <Box marginBottom="l">
              <Controller
                control={control}
                name="price"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    //label={t('sell:fields.priceLabel')} // Label externo sin ayuda
                    placeholder={t('sell:fields.priceLabel')}
                    keyboardType="numeric"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.price}
                    leftIcon="currency-usd"
                  />
                )}
              />
              {errors.price && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {t(errors.price.message as string)}
                </Text>
              )}
            </Box>

            {/* 3. CONDICIÓN */}
            <Box marginBottom="l">
              <Controller
                control={control}
                name="condition"
                render={({ field: { onChange, value } }) => (
                  <FormSelect
                    label={t('sell:fields.conditionLabel')}
                    placeholder="Seleccionar"
                    value={value}
                    onChange={onChange}
                    options={PRODUCT_CONDITIONS}
                    error={!!errors.condition}
                  />
                )}
              />
              {errors.condition && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {t(errors.condition.message as string)}
                </Text>
              )}
            </Box>

            {/* 4. TIEMPO DE USO */}
            <Box marginBottom="l">
              <Controller
                control={control}
                name="usage"
                render={({ field: { onChange, value } }) => (
                  <FormSelect
                    label={t('sell:fields.usageLabel')}
                    placeholder="Seleccionar"
                    value={value}
                    onChange={onChange}
                    options={PRODUCT_USAGE_OPTIONS}
                    error={!!errors.usage}
                  />
                )}
              />
              {errors.usage && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {t(errors.usage.message as string)}
                </Text>
              )}
            </Box>

            {/* 5. DESCRIPCIÓN */}
            <Controller
              control={control}
              name="description"
              render={({ field: { onChange, onBlur, value } }) => (
                <Box>
                  <FormTextInput
                    // 1. MODO ESTÁTICO (Vital para arreglar el solapamiento)
                    labelMode="static"
                    // 2. DATOS DEL HEADER (Label + Ayuda)
                    label={t('sell:fields.descriptionLabel')}
                    helpTitle={t('sell:fields.descriptionHelpTitle')}
                    helpDescription={t('sell:fields.descriptionHelpDesc')}
                    // 3. PROPS DEL INPUT
                    placeholder={t('sell:fields.descriptionPlaceholder')}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.description}
                    multiline
                    numberOfLines={5}
                    // 4. ESTILOS (Los que ya habíamos arreglado)
                    textAlignVertical="top"
                    style={{ height: 120, backgroundColor: 'transparent' }}
                    contentStyle={{
                      paddingTop: 0,
                      paddingBottom: 0,
                      marginTop: 8,
                    }}
                  />

                  {/* Contador y Errores */}
                  <Box
                    flexDirection="row"
                    justifyContent="space-between"
                    marginTop="xs"
                  >
                    <Box flex={1}>
                      {errors.description && (
                        <Text variant="body-sm" color="error">
                          {t(errors.description.message as string)}
                        </Text>
                      )}
                    </Box>
                    <Text
                      variant="caption-md"
                      color={value.length > 1000 ? 'error' : 'textSecondary'}
                    >
                      {value.length} / 1000
                    </Text>
                  </Box>
                </Box>
              )}
            />
          </Box>

          <Box height={30} />

          <PrimaryButton onPress={handleSubmit(onSubmit)} disabled={!isValid}>
            {t('sell:fields.next')}
          </PrimaryButton>
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
}

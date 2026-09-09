/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect } from 'react';
import {
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { FormSelect } from '../../components/ui/FormSelect';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { Checkbox } from '../../components/ui/Checkbox';

import { useAddresses } from '../../core/hooks/useAddresses';
import { useZipCode } from '../../core/hooks/useZipCode';
import { addressSchema, AddressFormData } from '../../core/schemas/address';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppChip } from '@/components/ui/AppChip';
import { ScreenHeader } from '@/components/layout/ScreenHeader';

export default function AddressFormScreen() {
  const { t } = useTranslation(['address', 'common']);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { addAddress, isAdding } = useAddresses();
  const insets = useSafeAreaInsets();

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(addressSchema),
    mode: 'onChange',
    defaultValues: {
      label: 'Home',
      zip_code: '',
      city: '',
      state_code: '',
      district: '',
      street_line1: '',
      street_number: '',
      street_line2: '',
      full_name: '',
      phone: '',
      is_default: false,
    },
  }) as ReturnType<typeof useForm<AddressFormData>>;

  const watchedZip = watch('zip_code');
  const { data: location, isLoading: isSearchingZip } = useZipCode(watchedZip);

  useEffect(() => {
    if (location) {
      setValue('city', location.city, { shouldValidate: true });
      setValue('state_code', location.state_code, { shouldValidate: true });
      if (location.districts?.length === 1) {
        setValue('district', location.districts[0], { shouldValidate: true });
      }
    } else if (watchedZip.length < 5) {
      setValue('city', '');
      setValue('state_code', '');
      setValue('district', '');
    }
  }, [location, setValue, watchedZip]);

  const onSubmit = async (values: AddressFormData) => {
    try {
      const { state_code, ...rest } = values;

      // Creamos el objeto final asegurando que NO haya undefined
      const payload = {
        ...rest,
        state: state_code,
        country: 'MX',
        latitude: null,
        longitude: null,
      };

      await addAddress(payload as any); // Casting final para romper el muro de types/index

      Toast.show({ type: 'success', text1: t('address:feedback.saveSuccess') });
      router.back();
    } catch {
      Toast.show({ type: 'error', text1: t('address:feedback.saveError') });
    }
  };

  const getErrorMessage = (errorKey: string | undefined) => {
    if (!errorKey) return null;
    return t(errorKey as any);
  };

  const cardStyles = {
    backgroundColor: 'cardBackground',
    borderRadius: 'l',
    padding: 'm',
    marginBottom: 'm',
  } as const;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        showBack
        backgroundColor="cardBackground"
        title={t('address:form.title')}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.m,
            paddingTop: insets.top + 80,
            paddingBottom: insets.bottom + 100,
          }}
          bounces={false}
        >
          {/* HEADER DE PANTALLA */}
          <Box marginBottom="s">
            <ScreenHeader
              title={t('address:form.title')}
              subtitle={
                t('address:form.subtitle') ||
                'Configura tu punto de entrega o recolección.'
              }
            />
          </Box>

          {/* 1. SECCIÓN: LOCALIZACIÓN (Smart Section) */}
          <Box {...cardStyles}>
            <Text variant="header-xl" color="primary" marginBottom="m">
              {t('address:form.sections.location') || 'Ubicación'}
            </Text>

            <Box marginBottom="m">
              <Controller
                control={control}
                name="zip_code"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('address:form.zipLabel')}
                    placeholder={t('address:form.zipPlaceholder')}
                    keyboardType="number-pad"
                    maxLength={5}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.zip_code}
                    right={
                      isSearchingZip ? (
                        <ActivityIndicator color={theme.colors.primary} />
                      ) : undefined
                    }
                  />
                )}
              />
              {errors.zip_code && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {getErrorMessage(errors.zip_code.message)}
                </Text>
              )}
            </Box>
            <Box marginBottom="m">
              <Controller
                control={control}
                name="street_number"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label="Street number"
                    placeholder="123"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.street_number}
                  />
                )}
              />
              {errors.street_number && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {getErrorMessage(errors.street_number.message)}
                </Text>
              )}
            </Box>

            <Box marginBottom="m">
              <Controller
                control={control}
                name="district"
                render={({ field: { onChange, value } }) => (
                  <FormSelect
                    label={t('address:form.districtLabel')}
                    placeholder={t('address:form.districtPlaceholder')}
                    value={value}
                    onChange={onChange}
                    options={location?.districts || []}
                    error={!!errors.district}
                    disabled={!location}
                  />
                )}
              />
            </Box>

            <Box flexDirection="row" gap="m">
              <Box flex={1}>
                <FormTextInput
                  label={t('address:form.cityLabel')}
                  value={watch('city')}
                  editable={false}
                  style={{ opacity: watch('city') ? 1 : 0.5 }}
                />
              </Box>
              <Box flex={1}>
                <FormTextInput
                  label={t('address:form.stateLabel')}
                  value={watch('state_code')}
                  editable={false}
                  style={{ opacity: watch('state_code') ? 1 : 0.5 }}
                />
              </Box>
            </Box>
          </Box>

          {/* 2. SECCIÓN: DOMICILIO DETALLADO */}
          <Box {...cardStyles}>
            <Text variant="header-xl" color="primary" marginBottom="m">
              {t('address:form.sections.address') || 'Domicilio'}
            </Text>

            <Box marginBottom="m">
              <Controller
                control={control}
                name="street_line1"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('address:form.streetLabel')}
                    placeholder={t('address:form.streetPlaceholder')}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.street_line1}
                  />
                )}
              />
              {errors.street_line1 && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {getErrorMessage(errors.street_line1.message)}
                </Text>
              )}
            </Box>
          </Box>

          {/* 3. SECCIÓN: CONTACTO Y PREFERENCIAS */}
          <Box {...cardStyles}>
            <Text variant="header-xl" color="primary" marginBottom="m">
              {t('address:form.sections.contact') || 'Contacto'}
            </Text>

            <Box marginBottom="m">
              <Controller
                control={control}
                name="full_name"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('address:form.recipientLabel')}
                    placeholder={t('address:form.recipientPlaceholder')}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.full_name}
                  />
                )}
              />
              {errors.full_name && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {getErrorMessage(errors.full_name.message)}
                </Text>
              )}
            </Box>

            <Box marginBottom="l">
              <Controller
                control={control}
                name="phone"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('address:form.phoneLabel')}
                    placeholder={t('address:form.phonePlaceholder')}
                    keyboardType="phone-pad"
                    maxLength={10}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.phone}
                  />
                )}
              />
              {errors.phone && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {getErrorMessage(errors.phone.message)}
                </Text>
              )}
            </Box>

            {/* ETIQUETAS RÁPIDAS */}
            <Box flexDirection="row" gap="s" marginBottom="m">
              {['Home', 'Work', 'Other'].map((label) => {
                const isSelected = watch('label') === label;
                return (
                  <AppChip
                    key={label}
                    label={t(`address:labels.${label.toLowerCase()}` as any)}
                    backgroundColor={isSelected ? 'primary' : 'background'}
                    textColor={isSelected ? 'background' : 'textPrimary'}
                    selected={isSelected}
                    onPress={() => setValue('label', label)}
                    variant={isSelected ? 'flat' : 'outlined'}
                  />
                );
              })}
            </Box>

            <Controller
              control={control}
              name="is_default"
              render={({ field: { onChange, value } }) => (
                <Checkbox
                  status={value ? 'checked' : 'unchecked'}
                  onPress={() => onChange(!value)}
                  label={
                    <Text variant="body-md" color="textSecondary">
                      {t('address:form.isDefaultLabel')}
                    </Text>
                  }
                />
              )}
            />
          </Box>

          <PrimaryButton
            onPress={handleSubmit(onSubmit)}
            loading={isAdding}
            disabled={!isValid || isAdding}
          >
            {t('address:form.save')}
          </PrimaryButton>
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
}

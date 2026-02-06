import React from 'react';
import { ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { AppChip } from '../../components/ui/AppChip';
import { LocationPicker } from '../../components/features/address/LocationPicker';
import { useAddresses } from '../../core/hooks/useAddresses';

// IMPORTAMOS EL ESQUEMA EXTERNO
import { addressSchema, AddressFormData } from '../../core/schemas/address';

export default function AddressFormScreen() {
  const { t } = useTranslation('address');
  const router = useRouter();

  const { addAddress, isAdding } = useAddresses();

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AddressFormData>({
    resolver: zodResolver(addressSchema),

    defaultValues: {
      label: 'Casa',
      street_line1: '', // Permitimos vacío para que el usuario escriba
      street_line2: '',
      instructions: '',
      zip_code: '',
      city: '',
      state: '',
      full_name: '',
      phone: '',
    },
  });

  const currentLabel = watch('label');

  const onSubmit = async (data: AddressFormData) => {
    try {
      await addAddress({
        ...data,
        country: 'MX', // Hardcodeado por ahora, Selene solo opera en MX
        latitude: null, // Sin coordenadas por ahora
        longitude: null,
        is_default: false,
      });

      Toast.show({
        type: 'success',
        text1: 'Dirección Guardada',
        text2: 'Tu dirección de envío se ha agregado correctamente.',
      });

      router.back();
    } catch (error) {
      console.error(error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo guardar la dirección. Intenta de nuevo.',
      });
    }
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        title={t('form.title')}
        showBack={true}
        backgroundColor="transparent"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          bounces={false}
        >
          {/* 1. SECCIÓN MAPA (Placeholder Decorativo) */}
          <LocationPicker value={watch('street_line1')} />

          {/* 2. FORMULARIO */}
          <Box
            backgroundColor="background"
            marginTop="l"
            paddingHorizontal="m"
            paddingTop="xl"
            borderTopLeftRadius="l"
            borderTopRightRadius="l"
          >
            {/* Calle y Número */}
            <Box marginBottom="m">
              <Controller
                control={control}
                name="street_line1"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('form.streetLabel')}
                    labelMode="static"
                    placeholder={t('form.streetPlaceholder')}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.street_line1}
                    // Quitamos editable={false} para permitir entrada manual
                  />
                )}
              />
            </Box>

            {/* Interior */}
            <Box marginBottom="m">
              <Controller
                control={control}
                name="street_line2"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('form.detailsLabel')}
                    labelMode="static"
                    placeholder={t('form.detailsPlaceholder')}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value || ''}
                  />
                )}
              />
            </Box>

            {/* Código Postal y Ciudad (Row) */}
            <Box flexDirection="row" gap="m" marginBottom="m">
              <Box flex={1}>
                <Controller
                  control={control}
                  name="zip_code"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <FormTextInput
                      label="C.P."
                      labelMode="static"
                      placeholder="00000"
                      keyboardType="number-pad"
                      maxLength={5}
                      onBlur={onBlur}
                      onChangeText={onChange}
                      value={value}
                      error={!!errors.zip_code}
                    />
                  )}
                />
              </Box>
              <Box flex={1}>
                <Controller
                  control={control}
                  name="city"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <FormTextInput
                      label="Ciudad"
                      labelMode="static"
                      placeholder="Ej. CDMX"
                      onBlur={onBlur}
                      onChangeText={onChange}
                      value={value}
                      error={!!errors.city}
                    />
                  )}
                />
              </Box>
            </Box>

            {/* Estado */}
            <Box marginBottom="m">
              <Controller
                control={control}
                name="state"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label="Estado / Provincia"
                    labelMode="static"
                    placeholder="Ej. Ciudad de México"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.state}
                  />
                )}
              />
            </Box>

            {/* Instrucciones */}
            <Box marginBottom="m">
              <Controller
                control={control}
                name="instructions"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('form.instructionsLabel')}
                    labelMode="static"
                    placeholder={t('form.instructionsPlaceholder')}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value || ''}
                  />
                )}
              />
            </Box>

            <Box
              height={1}
              backgroundColor="cardBackground"
              marginVertical="m"
            />

            {/* Contacto */}
            <Box marginBottom="m">
              <Controller
                control={control}
                name="full_name"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('form.recipientLabel')}
                    labelMode="static"
                    placeholder="Ej. Juan Pérez"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.full_name}
                  />
                )}
              />
            </Box>

            <Box marginBottom="l">
              <Controller
                control={control}
                name="phone"
                render={({ field: { onChange, onBlur, value } }) => (
                  <FormTextInput
                    label={t('form.phoneLabel')}
                    labelMode="static"
                    placeholder="10 dígitos"
                    keyboardType="phone-pad"
                    maxLength={10}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={!!errors.phone}
                  />
                )}
              />
            </Box>

            {/* Etiquetas */}
            <Text variant="body-md" color="textSecondary" marginBottom="s">
              {t('labels.title')}
            </Text>
            <Box flexDirection="row" gap="s" marginBottom="xl">
              {['Home', 'Work', 'Other'].map((label) => {
                const isSelected = currentLabel === label;
                return (
                  <AppChip
                    key={label}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    label={t(`labels.${label.toLowerCase()}` as any)}
                    selected={isSelected}
                    onPress={() => setValue('label', label)}
                    variant={isSelected ? 'flat' : 'outlined'}
                    backgroundColor={isSelected ? 'primary' : undefined}
                    textColor={isSelected ? 'background' : 'textSecondary'}
                  />
                );
              })}
            </Box>

            <PrimaryButton
              onPress={handleSubmit(onSubmit)}
              loading={isAdding}
              disabled={isAdding}
            >
              {t('form.save')}
            </PrimaryButton>

            <Box height={40} />
          </Box>
        </ScrollView>
      </KeyboardAvoidingView>
    </Box>
  );
}

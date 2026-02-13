import React from 'react';
import { Controller } from 'react-hook-form';
import { ActivityIndicator, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '@/components/base';
import { FormTextInput } from '@/components/ui/FormTextInput';
import { FormSelect } from '@/components/ui/FormSelect';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { LabelWithHelp } from '@/components/ui/LabelWithHelp';
import { PackageSelector } from './PackageSelector';
import { useSellDetailsForm } from '@/core/hooks/useSellDetailsForm';
import {
  PRODUCT_CONDITIONS,
  PRODUCT_USAGE_OPTIONS,
} from '@/core/constants/product-data';
import { useTheme } from '@shopify/restyle';
import { Theme } from '@/core/theme';

type SellDetailsFormProps = ReturnType<typeof useSellDetailsForm>;

export const SellDetailsForm: React.FC<SellDetailsFormProps> = ({
  t,
  control,
  handleSubmit,
  errors,
  isValid,
  watchedValues,
  isQuoting,
  quoteError,
  earnings,
  onSubmit,
  category,
}) => {
  const theme = useTheme<Theme>();

  const price = watchedValues[0] as string;
  const originZip = watchedValues[3] as string;

  return (
    <>
      {/* 1. SECCIÓN: PRECIO */}
      <Box {...cardStyles}>
        <Text variant="header-xl" marginBottom="m" color="primary">
          {t('sections.price')}
        </Text>

        <Controller
          control={control}
          name="price"
          render={({ field: { onChange, onBlur, value } }) => (
            <Box>
              <FormTextInput
                placeholder={t('fields.pricePlaceholder')}
                label={t('fields.priceLabel')}
                keyboardType="numeric"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={!!errors.price}
                leftIcon="currency-usd"
              />
              {errors.price && (
                <Text variant="body-sm" color="error" marginTop="xs">
                  {errors.price.message}
                </Text>
              )}
            </Box>
          )}
        />

        {/* Tip de precios */}
        <Box
          backgroundColor="background"
          padding="s"
          borderRadius="s"
          marginTop="m"
          flexDirection="row"
          alignItems="center"
        >
          <MaterialCommunityIcons
            name="lightbulb-on-outline"
            size={20}
            color={theme.colors.primary}
          />
          <Text
            variant="caption-md"
            color="textSecondary"
            marginLeft="s"
            flex={1}
          >
            {t('tips.price')}
          </Text>
        </Box>
      </Box>

      {/* 2. SECCIÓN: DETALLES DEL PRODUCTO */}
      <Box {...cardStyles} marginTop="l">
        <Text variant="header-xl" marginBottom="m" color="primary">
          {t('sections.productDetails')}
        </Text>

        {/* Título del producto */}
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value } }) => (
            <Box marginBottom="l">
              <FormTextInput
                label={t('fields.nameLabel')}
                labelMode="static"
                helpTitle={t('fields.nameHelpTitle')}
                helpDescription={t('fields.nameHelpDesc')}
                placeholder={t('fields.namePlaceholder')}
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
                {errors.name ? (
                  <Text variant="body-sm" color="error">
                    {errors.name.message}
                  </Text>
                ) : (
                  <Box />
                )}
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

        {/* Tiempo de uso */}
        <Box marginBottom="m">
          <Controller
            control={control}
            name="usage"
            render={({ field: { onChange, value } }) => (
              <FormSelect
                label={t('fields.usageLabel')}
                placeholder={t('fields.usagePlaceholder')}
                value={value}
                onChange={onChange}
                options={PRODUCT_USAGE_OPTIONS}
                error={!!errors.usage}
              />
            )}
          />
          {errors.usage && (
            <Text variant="body-sm" color="error" marginTop="xs">
              {errors.usage.message}
            </Text>
          )}
        </Box>

        {/* Condición */}
        <Box marginBottom="m">
          <Controller
            control={control}
            name="condition"
            render={({ field: { onChange, value } }) => (
              <FormSelect
                label={t('fields.conditionLabel')}
                placeholder={t('common:select')}
                value={value}
                onChange={onChange}
                options={PRODUCT_CONDITIONS}
                error={!!errors.condition}
              />
            )}
          />
        </Box>

        {/* Descripción */}
        <Controller
          control={control}
          name="description"
          render={({ field: { onChange, onBlur, value } }) => (
            <Box>
              <FormTextInput
                labelMode="static"
                label={t('fields.descriptionLabel')}
                helpTitle={t('fields.descriptionHelpTitle')}
                helpDescription={t('fields.descriptionHelpDesc')}
                placeholder={t('fields.descriptionPlaceholder')}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={!!errors.description}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                style={{ height: 120, backgroundColor: 'transparent' }}
                contentStyle={{
                  paddingTop: 0,
                  paddingBottom: 0,
                  marginTop: 8,
                }}
              />
              <Box
                flexDirection="row"
                justifyContent="space-between"
                marginTop="xs"
              >
                {errors.description ? (
                  <Text variant="body-sm" color="error">
                    {errors.description.message}
                  </Text>
                ) : (
                  <Box />
                )}
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

      {/* 3. SECCIÓN: ORIGEN DE ENVÍO */}
      <Box {...cardStyles} marginTop="l">
        <Text variant="header-xl" marginBottom="m" color="primary">
          {t('sections.shippingOrigin')}
        </Text>

        {/* Código Postal */}
        <Controller
          control={control}
          name="origin_zip"
          render={({ field: { onChange, onBlur, value } }) => (
            <Box marginBottom="m">
              <FormTextInput
                label={t('fields.originZipLabel')}
                labelMode="static"
                placeholder={t('fields.originZipPlaceholder')}
                keyboardType="number-pad"
                maxLength={5}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={!!errors.origin_zip}
              />
              {errors.origin_zip && (
                <Text variant="body-sm" color="error" marginTop="s">
                  {errors.origin_zip.message}
                </Text>
              )}
            </Box>
          )}
        />
        {/* Tamaño del paquete */}
        <LabelWithHelp
          label={t('fields.packageSizeLabel')}
          helpTitle={t('fields.packageSizeHelpTitle')}
          helpDescription={t('fields.packageSizeHelpDesc')}
        />
        <Controller
          control={control}
          name="package_preset"
          render={({ field: { onChange, value } }) => (
            <PackageSelector
              category={category!}
              selectedValue={value}
              onSelect={onChange}
            />
          )}
        />
      </Box>

      {/* --------------------------------------------------------- */}
      {/* 4. SECCIÓN: RESUMEN Y LOGÍSTICA (INTELIGENTE)             */}
      {/* --------------------------------------------------------- */}
      <Box {...cardStyles} marginTop="l" overflow="hidden">
        <Text variant="header-xl" marginBottom="m" color="primary">
          {t('sections.salesSummary')}
        </Text>

        {/* --- BLOQUE: ENVÍO SEGURO --- */}
        <Box
          padding="m"
          backgroundColor="background"
          borderRadius="m"
          borderWidth={1}
          borderColor="primary"
          style={{ borderStyle: 'dashed' }}
        >
          <LabelWithHelp
            label={t('fields.shippingInsurance')}
            helpTitle={t('fields.shippingInsuranceTitle')}
            helpDescription={t('fields.shippingInsuranceDescription')}
          />
          <Box flexDirection="row" alignItems="center" marginTop="s">
            <MaterialCommunityIcons
              name="shield-check"
              size={22}
              color={theme.colors.primary}
            />
            <Text variant="body-md" marginLeft="s" color="textPrimary">
              {t('fields.shippingInsurancesText')}
            </Text>
          </Box>
        </Box>

        <Box
          height={1}
          backgroundColor="separator"
          marginVertical="l"
          opacity={0.5}
        />

        {/* --- BLOQUE: CALCULADORA DINÁMICA --- */}
        <Box gap="s">
          {/* Fila: Precio de lista */}
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Text variant="body-md" color="textSecondary">
              {t('fields.productPriceText')}
            </Text>
            <Text
              variant="body-md"
              color={parseFloat(price) > 0 ? 'textPrimary' : 'textSecondary'}
            >
              {parseFloat(price) > 0 ? `$${parseFloat(price)}` : '$ --'}
            </Text>
          </Box>

          {/* Fila: Ganancia Neta (Lógica Pro) */}
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            marginTop="s"
          >
            <Box flex={1}>
              <LabelWithHelp
                label={t('fields.youReceiveLabel')}
                helpTitle={t('fields.youReceiveHelpTitle')}
                helpDescription={t('fields.youReceiveHelpDescription')}
              />
            </Box>

            <Box alignItems="flex-end">
              {isQuoting ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : parseFloat(price) > 0 ? (
                <>
                  <Text
                    variant="header-xl"
                    color={
                      originZip?.length === 5 ? 'textPrimary' : 'textSecondary'
                    }
                  >
                    ${earnings.final}
                  </Text>
                  {/* AVISO DE CP FALTANTE */}
                  {originZip?.length !== 5 && (
                    <Text variant="body-sm" color="textPrimary">
                      {t('errors.cpMissingText')}
                    </Text>
                  )}
                </>
              ) : (
                <Text variant="body-md" color="textSecondary">
                  {t('errors.waitingForPriceLabel')}
                </Text>
              )}
            </Box>
          </Box>
        </Box>

        {/* --- MANEJO DE ERRORES --- */}
        {quoteError && (
          <Box
            flexDirection="row"
            alignItems="center"
            marginTop="m"
            padding="s"
            backgroundColor="focus"
            borderRadius="s"
          >
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={16}
              color={theme.colors.error}
            />
            <Text variant="caption-md" color="error" marginLeft="xs">
              {t('errors.quoteFailed')}
            </Text>
          </Box>
        )}
      </Box>

      {/* BOTÓN DE ACCIÓN FINAL */}
      <Box height={30} />
      <PrimaryButton
        onPress={handleSubmit(onSubmit)}
        disabled={!isValid || isQuoting}
      >
        {t('fields.next')}
      </PrimaryButton>
    </>
  );
};

const cardStyles = {
  backgroundColor: 'cardBackground',
  borderRadius: 'l',
  padding: 'm',
  shadowColor: 'focus',
  shadowOpacity: 0.1,
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 4,
  elevation: 3,
} as const;

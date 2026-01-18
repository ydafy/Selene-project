/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useEffect } from 'react';
import {
  Control,
  Controller,
  useWatch,
  UseFormSetValue,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';
import { FormSelect } from '../../ui/FormSelect';
import { FormTextInput } from '../../ui/FormTextInput';
import { SellFieldConfig } from '../../../core/config/sell-form-config';

type DynamicSpecFieldProps = {
  field: SellFieldConfig;

  control: Control<any>;
  errors: any;
  setValue: UseFormSetValue<any>;
};

export const DynamicSpecField = ({
  field,
  control,
  errors,
  setValue,
}: DynamicSpecFieldProps) => {
  const { t } = useTranslation(['sell', 'common']);

  // 1. WATCHERS
  const parentValue = field.dependsOn
    ? useWatch({ control, name: field.dependsOn })
    : null;
  const myValue = useWatch({ control, name: field.name });

  // 2. AUTO-RESET LOGIC
  useEffect(() => {
    if (field.dependsOn) {
      // Si cambia el padre, limpiamos este campo
      setValue(field.name, '');
      setValue(`${field.name}_custom`, '');
    }
  }, [parentValue, field.dependsOn, field.name, setValue]);

  // 3. CALCULAR OPCIONES
  const currentOptions = useMemo(() => {
    if (!field.dependsOn) return field.options || [];
    if (field.optionsMap && parentValue) {
      return field.optionsMap[parentValue] || [];
    }
    return [];
  }, [field, parentValue]);

  // 4. LOGICA UI
  const isOtherSelected = myValue && String(myValue).includes('Other');
  const isDisabled =
    field.dependsOn && (!parentValue || currentOptions.length === 0);

  const placeholder = isDisabled
    ? t('sell:fields.selectParentFirst', {
        parent: t(`sell:fields.${field.dependsOn}Label`),
      })
    : t(field.placeholder);

  return (
    <Box marginBottom="m">
      {/* SELECT PRINCIPAL */}
      <Controller
        control={control}
        name={field.name}
        render={({ field: { onChange, value } }) => (
          <FormSelect
            label={t(field.label)}
            placeholder={placeholder}
            value={value ? String(value) : ''}
            onChange={(val) => {
              onChange(val);
              if (!val.includes('Other')) {
                setValue(`${field.name}_custom`, '');
              }
            }}
            options={currentOptions.map(String)}
            error={!!errors[field.name]}
            searchable={field.searchable}
          />
        )}
      />

      {errors[field.name] && (
        <Text variant="body-sm" color="error" marginTop="xs">
          {errors[field.name]?.message
            ? t(errors[field.name]?.message as string)
            : t('common:errors.required')}
        </Text>
      )}

      {/* INPUT CUSTOM */}
      {isOtherSelected && (
        <Box marginTop="s" marginLeft="m" borderLeftWidth={2} paddingLeft="s">
          <Controller
            control={control}
            name={`${field.name}_custom`}
            render={({ field: { onChange, onBlur, value } }) => (
              <FormTextInput
                label={t('sell:fields.specifyLabel', { field: t(field.label) })}
                placeholder={t('sell:fields.specifyPlaceholder')}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={!!errors[`${field.name}_custom`]}
              />
            )}
          />
          {errors[`${field.name}_custom`] && (
            <Text variant="body-sm" color="error" marginTop="xs">
              {t(errors[`${field.name}_custom`]?.message as string)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

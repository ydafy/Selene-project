/**
 * @file components/features/sell/DynamicSpecField.tsx
 * @description Componente de formulario dinámico que gestiona campos dependientes,
 * lógica de valores "Otros" y resets automáticos en cascada.
 * Nivel: Senior / Industrial.
 */

import React, { useMemo, useEffect, useRef, memo } from 'react';
import {
  Control,
  Controller,
  useWatch,
  UseFormSetValue,
  FieldValues,
  Path,
  PathValue,
  FieldErrors,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';
import { FormSelect } from '../../ui/FormSelect';
import { FormTextInput } from '../../ui/FormTextInput';
import { SellFieldConfig } from '../../../core/config/sell-form-config';
import { checkIfOther } from '../../../core/utils/form-helpers';

interface DynamicSpecFieldProps<T extends FieldValues> {
  field: SellFieldConfig;
  control: Control<T>;
  errors: FieldErrors<T>;
  setValue: UseFormSetValue<T>;
}

const DynamicSpecFieldComponent = <T extends FieldValues>({
  field,
  control,
  errors,
  setValue,
}: DynamicSpecFieldProps<T>) => {
  const { t } = useTranslation(['sell', 'common']);
  const isMounted = useRef(false);

  // Observamos el valor del campo padre (si existe) y el valor actual
  const parentValue = field.dependsOn
    ? useWatch({ control, name: field.dependsOn as Path<T> })
    : null;

  const myValue = useWatch({ control, name: field.name as Path<T> });

  /**
   * Lógica de Reset en Cascada:
   * Si el padre cambia, el hijo se limpia automáticamente, excepto en el montaje inicial (Edición).
   */
  useEffect(() => {
    if (!field.dependsOn) return;

    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }

    // Reset de valores en el store de react-hook-form
    setValue(field.name as Path<T>, '' as PathValue<T, Path<T>>);
    setValue(`${field.name}_custom` as Path<T>, '' as PathValue<T, Path<T>>);
  }, [parentValue, field.dependsOn, field.name, setValue]);

  /**
   * Resolución de opciones disponibles basada en la dependencia del padre.
   */
  const currentOptions = useMemo(() => {
    if (!field.dependsOn) return field.options || [];
    if (field.optionsMap && parentValue) {
      return field.optionsMap[parentValue] || [];
    }
    return [];
  }, [field, parentValue]);

  const isOtherSelected = checkIfOther(myValue);
  const isDisabled =
    field.dependsOn && (!parentValue || currentOptions.length === 0);

  const placeholder = isDisabled
    ? t('sell:fields.selectParentFirst', {
        parent: t(`sell:fields.${field.dependsOn}Label`),
      })
    : t(field.placeholder);

  // Extraemos el error específico de este campo
  const fieldError = errors[field.name];
  const customFieldError = errors[`${field.name}_custom`];

  return (
    <Box marginBottom="m">
      <Controller
        control={control}
        name={field.name as Path<T>}
        render={({ field: { onChange, value } }) => (
          <FormSelect
            label={t(field.label)}
            placeholder={placeholder}
            value={value ? String(value) : ''}
            onChange={(val) => {
              onChange(val);
              // Si el usuario cambia de "Other" a una opción real, limpiamos el campo manual
              if (!checkIfOther(val)) {
                setValue(
                  `${field.name}_custom` as Path<T>,
                  '' as PathValue<T, Path<T>>,
                );
              }
            }}
            options={currentOptions.map(String)}
            error={!!fieldError}
            searchable={field.searchable}
          />
        )}
      />

      {/* Renderizado de Error del Selector */}
      {fieldError && (
        <Text variant="body-sm" color="error" marginTop="xs">
          {fieldError.message
            ? t(fieldError.message as string)
            : t('common:errors.required')}
        </Text>
      )}

      {/* Campo de especificación manual (Solo si es "Other") */}
      {isOtherSelected && (
        <Box
          marginTop="s"
          marginLeft="m"
          borderLeftWidth={2}
          borderLeftColor="primary"
          paddingLeft="s"
        >
          <Controller
            control={control}
            name={`${field.name}_custom` as Path<T>}
            render={({ field: { onChange, onBlur, value } }) => (
              <FormTextInput
                label={t('sell:fields.specifyLabel', { field: t(field.label) })}
                placeholder={t('sell:fields.specifyPlaceholder')}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={!!customFieldError}
                labelMode="static"
                maxLength={50}
              />
            )}
          />
          {customFieldError && (
            <Text variant="body-sm" color="error" marginTop="xs">
              {t(customFieldError.message as string)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

// Exportamos con memo para optimizar el Wizard
export const DynamicSpecField = memo(
  DynamicSpecFieldComponent,
) as typeof DynamicSpecFieldComponent;

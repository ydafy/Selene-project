/**
 * @file core/hooks/useSellDetailsForm.ts
 * @description Orquestador del formulario de detalles de venta.
 * Maneja validación Zod centralizada, cotización JIT (Just-In-Time) y calculadora de ganancias.
 */

import { useMemo, useEffect, useState, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSellStore } from '@/core/store/useSellStore';
import { useShippingQuote } from '@/core/hooks/useShippingQuote';
import { useSystemConfig } from './useSystemConfig';
import {
  calculateSellerProceedsEstimate,
  formatCentsAsMx,
} from '@/core/utils/sellerProceedsEstimate';
import { getCategoryResetFields } from '@/core/utils/sellCategoryReset';
import {
  sellDetailsSchema,
  SellDetailsInput,
} from '@/core/schemas/sell.schema';

export const useSellDetailsForm = () => {
  const { t } = useTranslation(['sell']);
  const router = useRouter();
  const { data: systemConfig } = useSystemConfig();
  const { draft, updateDraft, resetCategoryFields } = useSellStore();
  const category = draft.category;

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm<SellDetailsInput>({
    resolver: zodResolver(sellDetailsSchema),
    mode: 'onChange',
    defaultValues: {
      name: draft.name || '',
      price: draft.price || '',
      condition: draft.condition || '',
      usage: draft.usage || '',
      description: draft.description || '',
      origin_zip: draft.origin_zip || '',
      package_preset: draft.package_preset || 'gpu_1',
      shipping_payer: 'seller',
      insurance_enabled: draft.insurance_enabled ?? true,
    },
  });

  const { getQuote, isQuoting, error: quoteError } = useShippingQuote();

  // Inicializamos con el valor previo del borrador para evitar el flash de 0.00
  const [shippingCost, setShippingCost] = useState(() =>
    parseFloat(draft.shipping_cost || '0'),
  );

  // Watchers aislados
  const price = useWatch({ control, name: 'price' });
  const package_preset = useWatch({ control, name: 'package_preset' });
  const origin_zip = useWatch({ control, name: 'origin_zip' });

  // Reset de campos al cambiar de categoría
  const previousCategoryRef = useRef(category);
  useEffect(() => {
    const previousCategory = previousCategoryRef.current;
    previousCategoryRef.current = category;

    if (category && previousCategory && previousCategory !== category) {
      const resetFields = getCategoryResetFields();
      setValue('condition', resetFields.condition);
      setValue('usage', resetFields.usage);
      resetCategoryFields();
    }
  }, [category, setValue, resetCategoryFields]);

  // Auto-selección de caja por categoría
  useEffect(() => {
    if (draft.category && systemConfig?.package_presets) {
      const categoryToPrefix: Record<string, string> = {
        GPU: 'gpu',
        CPU: 'cpu',
        RAM: 'ram',
        Motherboard: 'mobo',
      };
      const prefix = categoryToPrefix[draft.category] || 'cpu';
      const availableKeys = Object.keys(systemConfig.package_presets);
      const defaultPackage =
        availableKeys.find((key) => key.startsWith(prefix)) || 'cpu_1';
      setValue('package_preset', defaultPackage);
    }
  }, [draft.category, systemConfig, setValue]);

  // Cotización JIT con Debounce
  useEffect(() => {
    const priceNum = parseFloat(price) || 0;

    if (origin_zip?.length === 5 && package_preset && priceNum > 0) {
      const fetchQuote = async () => {
        const rates = await getQuote(
          origin_zip,
          package_preset,
          priceNum,
          '06500',
        );
        if (rates && rates.length > 0) {
          const rawCost = rates[0].price;
          setShippingCost(rawCost);
          updateDraft({ shipping_cost: rawCost.toString() });
        }
      };

      const timer = setTimeout(fetchQuote, 600);
      return () => clearTimeout(timer);
    }
  }, [origin_zip, package_preset, price, getQuote, updateDraft]);

  // Calculadora de Ganancias
  const earnings = useMemo(() => {
    const priceNum = parseFloat(price) || 0;
    if (priceNum === 0 || !systemConfig) {
      return { commission: '0.00', shipping: '0.00', final: '0.00' };
    }

    const subtotalCents = Math.round(priceNum * 100);
    const enviaCents = Math.round(shippingCost * 100);
    const estimate = calculateSellerProceedsEstimate({
      priceCents: subtotalCents,
      quoteCents: enviaCents,
      settings: systemConfig,
    });

    return {
      commission: formatCentsAsMx(estimate.commissionCents),
      shipping: formatCentsAsMx(estimate.shippingCents),
      final: formatCentsAsMx(estimate.finalCents),
    };
  }, [price, shippingCost, systemConfig]);

  const onSubmit = (data: SellDetailsInput) => {
    updateDraft(data);
    router.push('/sell/specs');
  };

  return {
    t,
    control,
    handleSubmit,
    errors,
    isValid,
    price,
    originZip: origin_zip,
    packagePreset: package_preset,
    category,
    isQuoting,
    quoteError,
    earnings,
    onSubmit,
  };
};

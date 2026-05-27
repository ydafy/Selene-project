/**
 * @file core/hooks/useSellDetailsForm.ts
 * @description Orquestador del formulario de detalles de venta.
 * Maneja validación Zod, cotización JIT (Just-In-Time) y calculadora de ganancias.
 */

import { useMemo, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSellStore } from '@/core/store/useSellStore';
import { useShippingQuote } from '@/core/hooks/useShippingQuote';
import { useSystemConfig } from './useSystemConfig';

const getDetailsSchema = (t: (key: string) => string) =>
  z.object({
    name: z
      .string()
      .min(10, t('sell:errors.nameRequired'))
      .max(80, t('sell:errors.nameTooLong')),
    price: z
      .string()
      .min(1, t('sell:errors.priceRequired'))
      .refine(
        (val) => !isNaN(Number(val)) && Number(val) > 0,
        t('sell:errors.priceInvalid'),
      ),
    condition: z.string().min(1, t('sell:errors.conditionRequired')),
    usage: z.string().min(1, t('sell:errors.usageRequired')),
    description: z
      .string()
      .min(20, t('sell:errors.descriptionRequired'))
      .max(1000, t('sell:errors.descriptionTooLong')),
    origin_zip: z.string().length(5, t('sell:errors.zipCodeInvalid')),
    package_preset: z.string().min(1, t('sell:errors.packageRequired')),
    shipping_payer: z.literal('seller'),
    insurance_enabled: z.boolean(),
  });

export type DetailsFormData = z.infer<ReturnType<typeof getDetailsSchema>>;

export const useSellDetailsForm = () => {
  const { t } = useTranslation(['sell']);
  const router = useRouter();
  const { data: systemConfig } = useSystemConfig();
  const { draft, updateDraft } = useSellStore();
  const category = draft.category;

  // 1. Memoización del Schema para performance
  const detailsSchema = useMemo(() => getDetailsSchema(t), [t]);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<DetailsFormData>({
    resolver: zodResolver(detailsSchema),
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
  const [shippingCost, setShippingCost] = useState(0);

  // 2. Watcher como objeto (Senior Pattern)
  const watched = watch();
  const { price, package_preset, origin_zip } = watched;

  // Efecto: Auto-selección de caja por categoría
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

  // Efecto: Cotización con Debounce
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
          // Sincronizamos el costo en el Store para el Preview
          updateDraft({ shipping_cost: rawCost.toString() });
        }
      };

      const timer = setTimeout(fetchQuote, 600);
      return () => clearTimeout(timer);
    }
  }, [origin_zip, package_preset, price, getQuote, updateDraft]);

  /**
   * Calculadora de Ganancias
   * Sincronizada con las reglas de negocio del Backend (system_settings)
   */
  const earnings = useMemo(() => {
    const priceNum = parseFloat(price) || 0;
    // FIX: Fallbacks para evitar el error de "possibly null"
    if (priceNum === 0 || !systemConfig) {
      return { commission: '0.00', shipping: '0.00', final: '0.00' };
    }

    const subtotalCents = Math.round(priceNum * 100);
    // Aplicamos ?? para asegurar que siempre haya un número
    const commissionCents = Math.round(
      subtotalCents * (systemConfig.service_fee_pct ?? 0.05),
    );

    const enviaCents = Math.round(shippingCost * 100);
    const logisticsTotalCents =
      enviaCents > 0
        ? enviaCents + (systemConfig.shipping_buffer_cents ?? 5000)
        : 0;

    const finalCents = subtotalCents - commissionCents - logisticsTotalCents;

    return {
      commission: (commissionCents / 100).toFixed(2),
      shipping: (logisticsTotalCents / 100).toFixed(2), // Renombrado para consistencia
      final: (Math.max(0, finalCents) / 100).toFixed(2),
    };
  }, [price, shippingCost, systemConfig]);

  const onSubmit = (data: DetailsFormData) => {
    updateDraft(data);
    router.push('/sell/specs');
  };

  return {
    t,
    control,
    handleSubmit,
    errors,
    isValid,
    watched, // Enviamos el objeto
    category,
    isQuoting,
    quoteError,
    earnings,
    onSubmit,
  };
};

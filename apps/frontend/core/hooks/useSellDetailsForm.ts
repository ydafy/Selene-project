import { useMemo, useEffect, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSellStore } from '@/core/store/useSellStore';
import { useShippingQuote } from '@/core/hooks/useShippingQuote';
import {
  calculateInsurance,
  PACKAGE_OPTIONS,
} from '@/core/constants/product-data';

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

    // CORRECCIÓN: Quitamos .default('seller')
    // El valor por defecto ya lo maneja useForm abajo
    shipping_payer: z.enum(['seller', 'buyer']),

    insurance_enabled: z.boolean(),
  });

export type DetailsFormData = z.infer<ReturnType<typeof getDetailsSchema>>;

export const useSellDetailsForm = () => {
  const { t } = useTranslation(['sell']);
  const router = useRouter();

  const updateDraft = useSellStore((state) => state.updateDraft);
  const category = useSellStore((state) => state.draft.category);
  const initialDraft = useRef(useSellStore.getState().draft).current;

  const detailsSchema = getDetailsSchema(t);

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
      name: initialDraft.name ?? '',
      price: initialDraft.price ?? '',
      condition: initialDraft.condition ?? '',
      usage: initialDraft.usage ?? '',
      description: initialDraft.description ?? '',
      origin_zip: initialDraft.origin_zip ?? '',
      package_preset: initialDraft.package_preset || 'cpu_1',
      // ESTRATEGIA: Siempre paga el vendedor
      shipping_payer: 'seller',
      insurance_enabled: initialDraft.insurance_enabled ?? true,
    },
  });

  const { getQuote, isQuoting, error: quoteError } = useShippingQuote();
  const [shippingCost, setShippingCost] = useState(0);

  // NOTA: Quitamos shipping_payer del watch para optimizar rendereo
  const watchedValues = watch([
    'price',
    'package_preset',
    'origin_zip',
    'insurance_enabled',
  ]);
  const [price, packagePresetId, originZip, insuranceEnabled] = watchedValues;

  // Efecto para preset por categoría
  useEffect(() => {
    if (category) {
      const defaultPackage =
        PACKAGE_OPTIONS[category as keyof typeof PACKAGE_OPTIONS]?.[0]?.id ||
        'cpu_1';
      setValue('package_preset', defaultPackage);
    }
  }, [category, setValue]);

  // Efecto de Cotización Estafeta (Seller)
  useEffect(() => {
    const priceNum = parseFloat(price) || 0;

    if (originZip?.length === 5 && packagePresetId && priceNum > 0) {
      const fetchQuote = async () => {
        // Usamos CDMX (06500) como destino pivote para el estimado
        const rates = await getQuote(
          originZip,
          packagePresetId,
          priceNum,
          '06500',
        );

        if (rates && rates.length > 0) {
          setShippingCost(rates[0].price);
        } else {
          setShippingCost(0);
        }
      };

      const timer = setTimeout(fetchQuote, 600);
      return () => clearTimeout(timer);
    } else {
      setShippingCost(0);
    }
  }, [originZip, packagePresetId, price, getQuote]);

  /**
   * Calculadora de Ganancias (Lógica Simplificada)
   * Ahora siempre resta el envío porque es "Envío Incluido"
   */
  const earnings = useMemo(() => {
    const priceNum = parseFloat(price) || 0;
    if (priceNum === 0)
      return {
        commission: '0.00',
        final: '0.00',
        insurance: '0.00',
        shippingCost: '0.00',
      };

    // 1. Comisión Selene (9%)
    const commission = priceNum * 0.09;

    // 2. Seguro Selene (1.3%)
    const insurance = insuranceEnabled ? calculateInsurance(priceNum) : 0;

    // 3. Envío Estimado (Siempre se cobra al vendedor)
    const currentShipping = shippingCost || 0;

    // Cálculo Final
    const final = priceNum - commission - insurance - currentShipping;

    return {
      commission: commission.toFixed(2),
      final: Math.max(0, final).toFixed(2),
      shippingCost: currentShipping.toFixed(2),
      insurance: insurance.toFixed(2),
    };
  }, [price, insuranceEnabled, shippingCost]);

  const onSubmit = (data: DetailsFormData) => {
    // Aseguramos que se guarde como seller
    updateDraft({ ...data, shipping_payer: 'seller' });
    router.push('/sell/specs');
  };

  return {
    t,
    router,
    category,
    control,
    handleSubmit,
    errors,
    isValid,
    // Devolvemos watchedValues incluyendo un placeholder para shipping_payer
    // para mantener compatibilidad con la UI si lo desestructura por índice
    watchedValues: [
      price,
      packagePresetId,
      'seller',
      originZip,
      insuranceEnabled,
    ],
    isQuoting,
    quoteError,
    earnings,
    shippingCost,
    onSubmit,
  };
};

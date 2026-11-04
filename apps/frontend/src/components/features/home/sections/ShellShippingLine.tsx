/**
 * @file components/features/home/sections/ShellShippingLine.tsx
 * @description Implementación específica para la línea de envíos nacionales.
 */

import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShellFeatureLine } from './ShellFeatureLine';

export const ShellShippingLine = memo(() => {
  const { t } = useTranslation('home');

  // Memoizamos el array de partes para que la referencia sea estable
  const shippingParts = useMemo(
    () => [
      t('shipping.line1'),
      { icon: 'truck-fast', label: t('shipping.badge') },
      t('shipping.line2'),
    ],
    [t],
  );

  return <ShellFeatureLine parts={shippingParts} />;
});

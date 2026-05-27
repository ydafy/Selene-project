import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShellFeatureSplit } from './ShellFeatureSplit';

export const ShellPaymentsFeature = memo(() => {
  const { t } = useTranslation('home');

  return (
    <ShellFeatureSplit
      title={t('trust.payments.title')}
      subtitle={t('trust.payments.subtitle')}
      items={[
        { icon: 'shield-check', label: t('trust.payments.item1') },
        { icon: 'lock-outline', label: t('trust.payments.item2') },
        { icon: 'hammer-wrench', label: t('trust.payments.item3') },
      ]}
      cards={[
        { icon: 'bank', title: 'Stripe', color: '#635BFF' },
        { icon: 'safe', title: 'Seguro' },
        { icon: 'cash-sync', title: 'Reembolso' },
      ]}
    />
  );
});

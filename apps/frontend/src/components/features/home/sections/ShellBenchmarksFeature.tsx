import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShellFeatureSplit } from './ShellFeatureSplit';

export const ShellBenchmarksFeature = memo(() => {
  const { t } = useTranslation('home');

  return (
    <ShellFeatureSplit
      isReversed
      title={t('trust.benchmarks.title')}
      subtitle={t('trust.benchmarks.subtitle')}
      items={[
        { icon: 'chart-bell-curve', label: t('trust.benchmarks.item1') },
        { icon: 'cpu-64-bit', label: t('trust.benchmarks.item2') },
        { icon: 'eye-outline', label: t('trust.benchmarks.item3') },
      ]}
      cards={[
        { icon: 'chart-bar', title: '3DMark', color: '#FF5722' },
        { icon: 'monitor', title: 'CPU-Z' },
        { icon: 'memory', title: 'Aida-64' },
      ]}
    />
  );
});

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { EnrichedShipment } from '@selene/types';

import { PrimaryButton } from '@/shared/ui/button/primary-button';

interface ReviewProductButtonsProps {
  items: EnrichedShipment['items'] | undefined;
  canReview: (productId: string) => boolean;
  onRate: (productId: string) => void;
}

export function ReviewProductButtons({
  items,
  canReview,
  onRate,
}: ReviewProductButtonsProps) {
  const { t } = useTranslation();

  return (
    <>
      {items
        ?.filter((item) => canReview(item.product_id))
        .map((item) => (
          <PrimaryButton
            key={`review-${item.id}`}
            onPress={() => onRate(item.product_id)}
            icon="star-outline"
            style={{ marginTop: 8 }}
            accessibilityLabel={t('orders:actions.rateProduct')}
            accessibilityHint={t('orders:actions.rateProductHint')}
          >
            {t('orders:actions.rateProduct')}
          </PrimaryButton>
        ))}
    </>
  );
}

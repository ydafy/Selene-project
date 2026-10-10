import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';

/** Shared general guidance, not a shipment's live payout status. */
export const SellerPaymentExplanation = () => {
  const { t } = useTranslation('wallet');

  return (
    <Box gap="m">
      <Text variant="body-md" color="textPrimary">
        {t('onboarding.paymentExplanation.buyerReview')}
      </Text>
      <Text variant="body-md" color="textPrimary">
        {t('onboarding.paymentExplanation.release')}
      </Text>
      <Text variant="body-md" color="textPrimary">
        {t('onboarding.paymentExplanation.bank')}
      </Text>
      <Text variant="body-md" color="textSecondary">
        {t('onboarding.paymentExplanation.delays')}
      </Text>
    </Box>
  );
};

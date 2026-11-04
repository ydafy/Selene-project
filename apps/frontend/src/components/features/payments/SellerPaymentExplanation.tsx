import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';

/** Shared general guidance, not a shipment's live payout status. */
export const SellerPaymentExplanation = () => {
  const { t } = useTranslation('sellerOnboarding');

  return (
    <Box gap="m">
      <Text variant="body-md" color="textPrimary">
        {t('paymentExplanation.buyerReview')}
      </Text>
      <Text variant="body-md" color="textPrimary">
        {t('paymentExplanation.release')}
      </Text>
      <Text variant="body-md" color="textPrimary">
        {t('paymentExplanation.bank')}
      </Text>
      <Text variant="body-md" color="textSecondary">
        {t('paymentExplanation.delays')}
      </Text>
    </Box>
  );
};

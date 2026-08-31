import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';

interface ShipmentNotFoundStateProps {
  onBack: () => void;
}

export const ShipmentNotFoundState = ({
  onBack,
}: ShipmentNotFoundStateProps) => {
  const { t } = useTranslation('orders');

  return (
    <Box flex={1} justifyContent="center" alignItems="center" padding="xl" gap="m">
      <Text variant="header-xl" color="primary" textAlign="center">
        {t('notFound.title')}
      </Text>
      <Text variant="body-md" color="textSecondary" textAlign="center">
        {t('notFound.message')}
      </Text>
      <PrimaryButton onPress={onBack} icon="arrow-left">
        {t('notFound.backToOrders')}
      </PrimaryButton>
    </Box>
  );
};

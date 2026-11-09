import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '@/shared/ui/base';
import { Theme } from '@/shared/theme';

type PrepareStatusCardProps = {
  remainingPhotos: number;
  hasOrigin: boolean;
  isShipmentPaid: boolean;
  boxBlocked: boolean;
};

// Status card above the primary button, always visible so the disabled
// button never lacks an explanation. Priority: missing photos, missing
// origin, shipment not ready, all met (cost warning).
export function PrepareStatusCard({
  remainingPhotos,
  hasOrigin,
  isShipmentPaid,
  boxBlocked,
}: PrepareStatusCardProps) {
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();

  const statusEntry =
    remainingPhotos > 0
      ? {
          icon: 'information-outline' as const,
          color: theme.colors.primary,
          message: t('orders:prepare.statusMissingPhotos', {
            count: remainingPhotos,
          }),
        }
      : !hasOrigin
        ? {
            icon: 'information-outline' as const,
            color: theme.colors.primary,
            message: t('orders:prepare.statusMissingOrigin'),
          }
        : !isShipmentPaid
          ? {
              icon: 'information-outline' as const,
              color: theme.colors.primary,
              message: t('orders:prepare.statusNotReady'),
            }
          : boxBlocked
            ? {
                icon: 'information-outline' as const,
                color: theme.colors.primary,
                message: t('orders:prepare.statusBoxUnavailable'),
              }
            : {
                icon: 'alert-outline' as const,
                color: theme.colors.warning,
                message: t('orders:prepare.generateWarning'),
              };

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      marginBottom="m"
      borderWidth={1}
      borderColor="separator"
    >
      <Box flexDirection="row" alignItems="center" gap="s">
        <MaterialCommunityIcons
          name={statusEntry.icon}
          size={20}
          color={statusEntry.color}
        />
        <Text variant="body-sm" color="textPrimary" flex={1}>
          {statusEntry.message}
        </Text>
      </Box>
    </Box>
  );
}

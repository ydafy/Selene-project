import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
//import { Icon } from '../../ui/Icon'; // O usa MaterialCommunityIcons directamente si no tienes Icon genérico aún
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

type ViewCounterProps = {
  count: number;
};

export const ViewCounter = ({ count }: ViewCounterProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('common');

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      backgroundColor="cardBackground"
      paddingHorizontal="s"
      paddingVertical="xs"
      borderRadius="s"
    >
      <MaterialCommunityIcons
        name="eye-outline"
        size={14}
        color={theme.colors.primary}
      />
      <Text variant="caption-md" color="textPrimary" marginLeft="xs">
        {count} {t('product.views')}
      </Text>
    </Box>
  );
};

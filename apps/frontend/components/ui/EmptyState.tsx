import { IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../base';
import { Theme } from '../../core/theme';

type EmptyStateProps = {
  title?: string;
  message?: string;
  icon?: string; // Nombre del icono de MaterialCommunityIcons
};

export const EmptyState = ({
  title,
  message,
  icon = 'package-variant',
}: EmptyStateProps) => {
  const { t } = useTranslation('common');
  const theme = useTheme<Theme>();

  return (
    <Box
      flex={1}
      justifyContent="center"
      alignItems="center"
      padding="xl"
      minHeight={300}
    >
      <Box
        marginBottom="m"
        padding="m"
        borderRadius="full"
        backgroundColor="cardBackground"
      >
        <IconButton
          icon={icon}
          iconColor={theme.colors.textSecondary}
          size={40}
          style={{ margin: 0 }}
        />
      </Box>

      <Text
        variant="subheader-md"
        color="textPrimary"
        textAlign="center"
        marginBottom="s"
      >
        {title || t('states.emptyTitle')}
      </Text>
      <Text variant="body-md" color="textSecondary" textAlign="center">
        {message || t('states.emptyMessage')}
      </Text>
    </Box>
  );
};

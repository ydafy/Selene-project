import { IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../base';
import { PrimaryButton } from './PrimaryButton';
import { Theme } from '../../core/theme';

type ErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export const ErrorState = ({ title, message, onRetry }: ErrorStateProps) => {
  const { t } = useTranslation('common');
  const theme = useTheme<Theme>();

  return (
    <Box flex={1} justifyContent="center" alignItems="center" padding="xl">
      {/* Icono de Alerta */}
      <Box marginBottom="m">
        <IconButton
          icon="alert-circle-outline"
          iconColor={theme.colors.error}
          size={48}
          style={{ margin: 0 }}
        />
      </Box>

      {/* Textos */}
      <Text
        variant="subheader-md"
        color="error"
        textAlign="center"
        marginBottom="s"
      >
        {title || t('states.errorTitle')}
      </Text>
      <Text
        variant="body-md"
        color="textSecondary"
        textAlign="center"
        marginBottom="l"
      >
        {message || t('states.errorMessage')}
      </Text>

      {/* Botón de Reintentar (Opcional) */}
      {onRetry && (
        <Box width="100%" maxWidth={200}>
          <PrimaryButton onPress={onRetry} variant="outline">
            {t('states.retryButton')}
          </PrimaryButton>
        </Box>
      )}
    </Box>
  );
};

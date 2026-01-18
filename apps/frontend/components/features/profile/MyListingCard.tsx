import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Product } from '@selene/types';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';
import { formatCurrency, formatDate } from '../../../core/utils/format';
import {
  getStatusColor,
  isProductHistory,
} from '../../../core/utils/product-status';

type MyListingCardProps = {
  product: Product;
  onPress: (product: Product) => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  // Nueva prop opcional para manejar la verificación
  onVerify?: (product: Product) => void;
};

export const MyListingCard = ({
  product,
  onPress,
  onEdit,
  onDelete,
  onVerify,
}: MyListingCardProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('profile');

  const isHistoryItem = isProductHistory(product.status);
  const statusColor = getStatusColor(product.status);

  // Detectamos si necesita acción de verificación
  const needsVerification = product.status === 'PENDING_VERIFICATION';

  // Handler principal: Si necesita verificación, priorizamos esa acción
  const handlePress = () => {
    if (needsVerification && onVerify) {
      onVerify(product);
    } else {
      onPress(product);
    }
  };

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.9}>
      <Box
        flexDirection="row"
        backgroundColor="cardBackground"
        borderRadius="m"
        overflow="hidden"
        marginBottom="m"
        height={160}
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 3,
          elevation: 3,
        }}
      >
        {/* 1. IMAGEN */}
        <Box width={130} height="100%" backgroundColor="background">
          <AppImage
            source={{ uri: product.images?.[0] }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
          {/* Badge de Estado */}
          <Box
            position="absolute"
            top={8}
            left={8}
            backgroundColor={statusColor}
            paddingHorizontal="s"
            paddingVertical="xs"
            borderRadius="s"
          >
            <Text
              variant="caption-md"
              style={{ color: 'white', fontWeight: 'bold', fontSize: 10 }}
            >
              {t(`listings.status.${product.status}`)}
            </Text>
          </Box>
        </Box>

        {/* 2. CONTENIDO */}
        <Box flex={1} padding="s" justifyContent="space-between">
          <Box>
            <Text variant="body-md" fontWeight="bold" numberOfLines={2}>
              {product.name}
            </Text>
            <Text variant="header-xl" color="primary" marginTop="xs">
              {formatCurrency(product.price)}
            </Text>
          </Box>

          {/* 3. BARRA DE ACCIONES */}
          {!isHistoryItem && (
            <Box flexDirection="row" alignItems="center" gap="s" marginTop="s">
              {/* BOTÓN PRIMARIO (Editar o Verificar) */}
              <TouchableOpacity
                onPress={() => {
                  if (needsVerification && onVerify) {
                    onVerify(product);
                  } else {
                    onEdit(product);
                  }
                }}
                style={{ flex: 1 }}
              >
                <Box
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="center"
                  // Si necesita verificación, usamos un estilo diferente (ej. borde amarillo o primary)
                  // Aquí mantengo 'primary' pero cambio el icono y texto
                  backgroundColor="primary"
                  paddingVertical="s"
                  borderRadius="m"
                  borderWidth={1}
                  borderColor="primary"
                >
                  <IconButton
                    icon={
                      needsVerification
                        ? 'shield-check-outline'
                        : 'pencil-outline'
                    }
                    size={18}
                    iconColor={theme.colors.background}
                    style={{ margin: 0, width: 20, height: 20 }}
                  />
                  <Text
                    variant="caption-lg"
                    marginLeft="xs"
                    color="background"
                    fontWeight="bold"
                  >
                    {needsVerification
                      ? 'Verificar'
                      : t('listings.actions.edit')}
                  </Text>
                </Box>
              </TouchableOpacity>

              {/* BOTÓN BORRAR */}
              <Box
                width={40}
                height={40}
                justifyContent="center"
                alignItems="center"
                borderRadius="m"
                backgroundColor="background"
              >
                <IconButton
                  icon="trash-can-outline"
                  size={22}
                  iconColor={theme.colors.error}
                  onPress={() => onDelete(product)}
                  style={{ margin: 0 }}
                />
              </Box>
            </Box>
          )}

          {isHistoryItem && (
            <Box marginTop="s">
              <Text variant="caption-md" color="textSecondary">
                {t('listings.publishedOn')} {formatDate(product.created_at)}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </TouchableOpacity>
  );
};

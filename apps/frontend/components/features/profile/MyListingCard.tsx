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

  // Lógica de Estados de Acción
  const isPending = product.status === 'PENDING_VERIFICATION';
  const isRejected = product.status === 'REJECTED';

  // Si requiere acción (verificar o corregir), priorizamos eso sobre ver el detalle
  const needsAction = isPending || isRejected;

  // Handler de Navegación Inteligente
  const handlePress = () => {
    if (needsAction && onVerify) {
      onVerify(product); // Ir a pantalla de verificación/corrección
    } else {
      onPress(product); // Ir a detalle público
    }
  };

  // Configuración del Botón de Acción Principal
  const getActionConfig = () => {
    if (isRejected) {
      return {
        label: t('listings.actions.fix'),
        icon: 'alert-circle-outline',
        color: theme.colors.error,
        textColor: theme.colors.textPrimary, // O background, según contraste
      };
    }
    if (isPending) {
      return {
        label: t('listings.actions.verify'),
        icon: 'shield-check-outline',
        color: theme.colors.primary,
        textColor: theme.colors.background,
      };
    }
    return {
      label: t('listings.actions.edit'),
      icon: 'pencil-outline',
      color: theme.colors.primary,
      textColor: theme.colors.background,
    };
  };

  const actionConfig = getActionConfig();

  // Decidimos si mostrar la barra de acciones
  // Mostramos si NO es historial, O si es rechazado (aunque esté en historial)
  const showActions = !isHistoryItem || isRejected;

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
          {showActions ? (
            <Box flexDirection="row" alignItems="center" gap="s" marginTop="s">
              {/* BOTÓN DINÁMICO (Editar / Verificar / Corregir) */}
              <TouchableOpacity
                onPress={() => {
                  if (needsAction && onVerify) {
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
                  backgroundColor={isRejected ? undefined : 'primary'} // Si es rejected usamos el estilo del borde
                  style={{
                    backgroundColor: actionConfig.color,
                    borderColor: actionConfig.color,
                  }}
                  paddingVertical="s"
                  borderRadius="m"
                  borderWidth={1}
                >
                  <IconButton
                    icon={actionConfig.icon}
                    size={18}
                    iconColor={actionConfig.textColor}
                    style={{ margin: 0, width: 20, height: 20 }}
                  />
                  <Text
                    variant="caption-lg"
                    marginLeft="xs"
                    style={{
                      color: actionConfig.textColor,
                    }}
                  >
                    {actionConfig.label}
                  </Text>
                </Box>
              </TouchableOpacity>

              {/* BOTÓN BORRAR (Siempre visible si hay acciones) */}
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
          ) : (
            // Si es historial puro (Vendido), solo mostramos fecha
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

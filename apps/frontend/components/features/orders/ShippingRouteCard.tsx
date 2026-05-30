/**
 * @file components/features/orders/ShippingRouteCard.tsx
 * Muestra la ruta logística real (Origen -> Destino) con soporte para inversión en retornos.
 * Migrado a shipment-level — origin_address viene del shipment, no del order.
 */

import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { Address, EnrichedShipment } from '@selene/types';

interface Props {
  shipment: EnrichedShipment;
  shippingAddress: Address;
  orderStatus: string;
}

export const ShippingRouteCard = ({ shipment, shippingAddress, orderStatus }: Props) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('orders');

  // 1. Detectar si estamos en un flujo de retorno
  const isReturn =
    orderStatus === 'dispute' && !!shipment.dispute?.return_label_url;

  // 2. Extraer direcciones (con fallbacks de seguridad)
  const buyerAddr = shippingAddress;
  const sellerAddr = shipment.origin_address as unknown as Address | null;

  // 3. LÓGICA DE RUTA (Simetría de Direcciones)
  // Si es retorno: El paquete va del Comprador al Vendedor.
  // Si es venta: El paquete va del Vendedor al Comprador.
  const route = {
    from: isReturn ? buyerAddr : sellerAddr,
    to: isReturn ? sellerAddr : buyerAddr,
    fromLabel: isReturn
      ? t('detail.routeFromBuyer')
      : t('detail.routeFromSeller'),
    toLabel: isReturn ? t('detail.routeToSeller') : t('detail.routeToBuyer'),
  };

  // Si aún no se genera la guía original, origin_address será null.
  // En ese caso, mostramos un estado previo elegante.
  if (!sellerAddr && !isReturn) {
    return (
      <Box
        backgroundColor="cardBackground"
        padding="m"
        borderRadius="l"
        marginBottom="m"
        opacity={0.6}
      >
        <Text variant="caption-md" textAlign="center">
          {t('detail.routePending')}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      marginBottom="m"
      borderWidth={1}
      borderColor="separator"
    >
      <Text variant="header-xl" color="primary" marginBottom="m">
        {isReturn
          ? t('detail.routeTitleReturn')
          : t('orders:detail.addressTitle')}
      </Text>

      <Box flexDirection="row">
        {/* Línea Visual de Ruta */}
        <Box alignItems="center" marginRight="m">
          <MaterialCommunityIcons
            name="circle-slice-8"
            size={20}
            color={theme.colors.primary}
          />
          <Box
            width={2}
            flex={1}
            backgroundColor="separator"
            marginVertical="xs"
            opacity={0.3}
          />
          <MaterialCommunityIcons
            name="map-marker-check"
            size={22}
            color={theme.colors.success}
          />
        </Box>

        <Box flex={1} gap="l">
          {/* PUNTO A: ORIGEN */}
          <Box>
            <Text variant="caption-md" color="textSecondary" marginBottom="xs">
              {route.fromLabel}
            </Text>
            <Text variant="body-md" fontWeight="bold">
              {route.from?.full_name || t('detail.routeTitleReturn')}
            </Text>
            <Text variant="caption-md" color="textSecondary">
              {route.from
                ? `${route.from.city}, ${route.from.state}`
                : t('detail.routeOriginVerified')}
            </Text>
          </Box>

          {/* PUNTO B: DESTINO */}
          <Box>
            <Text variant="caption-md" color="textSecondary" marginBottom="xs">
              {route.toLabel}
            </Text>
            <Text variant="body-md" fontWeight="bold">
              {route.to?.full_name || t('detail.routeTitleReturn')}
            </Text>
            <Text variant="caption-md" color="textSecondary">
              {route.to
                ? `${route.to.street_line1}, ${route.to.city}`
                : t('detail.routeDestVerified')}
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
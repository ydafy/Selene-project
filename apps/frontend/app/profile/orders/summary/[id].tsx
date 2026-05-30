/**
 * @file app/profile/orders/summary/[id].tsx
 * @description Multi-seller order summary with all shipments listed.
 * Shows all shipments for an order using OrderShipmentCard components.
 * Linked from the multi-seller banner in the order detail screen.
 */

import React, { useMemo } from 'react';
import { ScrollView, RefreshControl } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../../../components/base';
import { GlobalHeader } from '../../../../components/layout/GlobalHeader';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { OrderShipmentCard } from '../../../../components/features/orders/OrderShipmentCard';
import { useOrderById } from '../../../../core/hooks/useOrders';
import { useShipmentsByOrder } from '../../../../core/hooks/useShipments';
import { formatCurrency, formatDate } from '../../../../core/utils/format';
import { Theme } from '../../../../core/theme';

export default function OrderSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // ── Data hooks ────────────────────────────────────────────────────────
  const {
    data: order,
    isLoading: isOrderLoading,
    refetch: refetchOrder,
  } = useOrderById(id);
  const {
    data: shipments,
    isLoading: isShipmentsLoading,
    refetch: refetchShipments,
  } = useShipmentsByOrder(id);

  // Combinamos loading para evitar pop-in de shipments después del render
  const isAnyLoading = isOrderLoading || isShipmentsLoading;

  // Handler de refresco concurrente: actualiza orden + shipments
  const handleRefresh = async () => {
    await Promise.all([refetchOrder(), refetchShipments()]);
  };

  /**
   * Runtime source for shipments list.
   * Prefer order.shipments (once enrichOrder populates it in future
   * migration), fallback to useShipmentsByOrder (current state).
   */
  const shipmentsSource = useMemo(() => {
    if (order?.shipments && order.shipments.length > 0) {
      return order.shipments;
    }
    return shipments ?? [];
  }, [order, shipments]);

  // ── Loading skeleton ──────────────────────────────────────────────────
  // Mostramos skeleton hasta que orden + shipments tengan data inicial
  if (isAnyLoading || !order) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader showBack />
        <Box padding="m" style={{ paddingTop: insets.top + 100 }}>
          <Skeleton width="100%" height={120} borderRadius={16} />
          <Skeleton width="100%" height={200} borderRadius={16} />
          <Skeleton width="100%" height={200} borderRadius={16} />
        </Box>
      </Box>
    );
  }

  // ── Derived data ───
  const cardStyles = {
    backgroundColor: 'cardBackground' as const,
    padding: 'm' as const,
    borderRadius: 'l' as const,
    marginBottom: 'm' as const,
  };

  const totalItems = shipmentsSource.reduce(
    (sum, s) => sum + s.items.length,
    0,
  );

  // Shipping address is stored as JSON in the orders table
  const addr = order.shipping_address as Record<string, any> | null;
  const addressLines = [
    addr?.street_line1,
    addr?.street_line2,
    addr?.district,
    addr?.city,
    addr?.state,
  ].filter(Boolean) as string[];

  const orderCount = shipmentsSource.length;

  // ── Render ──
  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title="Resumen de envíos" showBack />

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + 80,
          paddingBottom: 40,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isAnyLoading}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* ── Order overview card ── */}
        <Box {...cardStyles}>
          <Text variant="header-xl" color="primary" marginBottom="m">
            {`Orden #${order.id.slice(0, 8).toUpperCase()}`}
          </Text>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('orders:detail.total', { defaultValue: 'Total' })}
            </Text>
            <Text variant="subheader-lg" color="primary">
              {formatCurrency(order.total_amount)}
            </Text>
          </Box>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('orders:detail.items', { defaultValue: 'Productos' })}
            </Text>
            <Text variant="body-md">
              {totalItems}{' '}
              {t('orders:detail.articles', {
                defaultValue: 'artículos',
                count: totalItems,
              })}
            </Text>
          </Box>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('orders:detail.date', { defaultValue: 'Fecha' })}
            </Text>
            <Text variant="body-md">{formatDate(order.created_at)}</Text>
          </Box>

          <Box flexDirection="row" justifyContent="space-between">
            <Text variant="body-md" color="textSecondary">
              {t('orders:detail.status', { defaultValue: 'Estado' })}
            </Text>
            <Text variant="body-md" color="primary">
              {order.visualStatus?.toUpperCase()}
            </Text>
          </Box>

          {/* Shipping address */}
          {addressLines.length > 0 && (
            <Box
              marginTop="m"
              paddingTop="m"
              borderTopWidth={1}
              borderTopColor="separator"
            >
              <Text
                variant="caption-md"
                color="textSecondary"
                marginBottom="xs"
              >
                {t('orders:summary.shippingAddress', {
                  defaultValue: 'Dirección de envío',
                })}
              </Text>
              <Text variant="body-md">{addressLines.join(', ')}</Text>
            </Box>
          )}
        </Box>

        {/* ── Multi-seller divider ── */}
        {orderCount > 0 && (
          <Box flexDirection="row" alignItems="center" marginBottom="m" gap="m">
            <Box flex={1} height={1} backgroundColor="separator" />
            <MaterialCommunityIcons
              name="truck-delivery"
              size={20}
              color={theme.colors.primary}
            />
            <Text variant="body-sm" color="textSecondary">
              {t('orders:summary.sellerCount', {
                defaultValue: `${orderCount} ${orderCount === 1 ? 'vendedor' : 'vendedores'}`,
                count: orderCount,
              })}
            </Text>
            <Box flex={1} height={1} backgroundColor="separator" />
          </Box>
        )}

        {/* ── Shipment cards ── */}
        {shipmentsSource.map((shipment) => (
          <OrderShipmentCard
            key={shipment.id}
            shipment={shipment}
            orderId={order.id}
            onPress={(shipmentId) =>
              router.push(
                `/profile/orders/${order.id}?shipment_id=${shipmentId}` as any,
              )
            }
          />
        ))}
      </ScrollView>
    </Box>
  );
}

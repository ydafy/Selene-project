/**
 * @file app/profile/orders/summary/[id].tsx
 * @description Multi-seller order summary with all shipments listed.
 * Shows all shipments for an order using OrderShipmentCard components.
 * Linked from the multi-seller banner in the order detail screen.
 */

import React, { useEffect, useMemo } from 'react';
import { ScrollView, RefreshControl, Linking } from 'react-native';
import { Stack, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../../../components/base';
import { GlobalHeader } from '../../../../components/layout/GlobalHeader';
import { PrimaryButton } from '../../../../components/ui/PrimaryButton';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { OrderShipmentCard } from '../../../../components/features/orders/OrderShipmentCard';
import { useOrderById } from '../../../../core/hooks/useOrders';
import { useShipmentsByOrder } from '../../../../core/hooks/useShipments';
import { formatCurrency, formatDate } from '../../../../core/utils/format';
import { Theme } from '../../../../core/theme';
import { useAuthContext } from '../../../../components/auth/AuthProvider';
import { resolveRoleAwareOrderView } from '../order-view-routing';
import {
  resolveBuyerCheckoutRecoveryView,
  shouldSuppressShipmentActionsForBuyerRecovery,
} from '../order-recovery-view';

export default function OrderSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['orders', 'common']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuthContext();

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
  const view = useMemo(
    () =>
      order
        ? resolveRoleAwareOrderView(
            {
              id: order.id,
              buyerId: order.buyer_id,
              shipments: shipmentsSource.map((shipment) => ({
                id: shipment.id,
                sellerId: shipment.seller_id,
              })),
            },
            session?.user.id,
          )
        : null,
    [order, session?.user.id, shipmentsSource],
  );

  useEffect(() => {
    if (view?.kind === 'detail') {
      router.replace(view.href as Href);
    }
  }, [router, view]);

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

  const checkoutRecoveryView = resolveBuyerCheckoutRecoveryView({
    isBuyer: order.isBuyer,
    paymentProcessing: (order as typeof order & { payment_processing?: boolean | null })
      .payment_processing,
    compensationState: (order as typeof order & { compensation_state?: string | null })
      .compensation_state,
    orderStatus: order.status,
  });

  if (!view || view.kind !== 'summary') return null;

  if (shouldSuppressShipmentActionsForBuyerRecovery(checkoutRecoveryView)) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader showBack />
        <Box padding="m" style={{ paddingTop: insets.top + 100 }}>
          <Box backgroundColor="cardBackground" padding="m" borderRadius="l">
            <Text variant="header-xl" color="primary" marginBottom="s">
              {checkoutRecoveryView.kind === 'refunded'
                ? t('recovery.confirmed')
                : t('recovery.pending')}
            </Text>
            {checkoutRecoveryView.kind === 'pending_refund' && (
              <PrimaryButton
                variant="outline"
                onPress={() => Linking.openURL('mailto:support@selene.mx')}
                icon="help-circle-outline"
              >
                {t('recovery.contactSupport')}
              </PrimaryButton>
            )}
          </Box>
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

  const visibleShipments = shipmentsSource.filter((shipment) =>
    view.visibleShipmentIds.includes(shipment.id),
  );
  const totalItems = visibleShipments.reduce(
    (sum, s) => sum + s.items.length,
    0,
  );

  // Shipping address is stored as JSON in the orders table
  const addr = order.shipping_address as Record<string, unknown> | null;
  const addressLines = [
    addr?.['street_line1'],
    addr?.['street_line2'],
    addr?.['district'],
    addr?.['city'],
    addr?.['state'],
  ].filter(Boolean) as string[];

  const orderCount = visibleShipments.length;
  const visibleTotal =
    view.role === 'seller'
      ? visibleShipments.reduce(
          (sum, shipment) =>
            sum +
            shipment.items.reduce(
              (itemSum, item) => itemSum + Number(item.price_at_purchase),
              0,
            ),
          0,
        )
      : order.total_amount;

  // ── Render ──
  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title={t('summary.title')} showBack />

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
        {checkoutRecoveryView.kind === 'refunded' && (
          <Box {...cardStyles} borderColor="success" borderWidth={1}>
            <Text variant="header-xl" color="success">
              {t('recovery.confirmed')}
            </Text>
          </Box>
        )}
        {/* ── Order overview card ── */}
        <Box {...cardStyles}>
          <Text variant="header-xl" color="primary" marginBottom="m">
            {t('summary.orderId', { id: order.id.slice(0, 8).toUpperCase() })}
          </Text>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('summary.total')}
            </Text>
            <Text variant="subheader-lg" color="primary">
              {formatCurrency(visibleTotal)}
            </Text>
          </Box>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('summary.items')}
            </Text>
            <Text variant="body-md">
              {totalItems}{' '}
              {t('summary.articles', { count: totalItems })}
            </Text>
          </Box>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('summary.date')}
            </Text>
            <Text variant="body-md">{formatDate(order.created_at)}</Text>
          </Box>

          <Box flexDirection="row" justifyContent="space-between">
            <Text variant="body-md" color="textSecondary">
              {t('summary.status')}
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
                {t('summary.shippingAddress')}
              </Text>
              <Text variant="body-md">{addressLines.join(', ')}</Text>
            </Box>
          )}
        </Box>

        {/* ── Divisor de envíos por producto ── */}
        {orderCount > 0 && (
          <Box flexDirection="row" alignItems="center" marginBottom="m" gap="m">
            <Box flex={1} height={1} backgroundColor="separator" />
            <MaterialCommunityIcons
              name="truck-delivery"
              size={20}
              color={theme.colors.primary}
            />
            <Text variant="body-sm" color="textSecondary">
              {t('summary.shipmentCount', { count: orderCount })}
            </Text>
            <Box flex={1} height={1} backgroundColor="separator" />
          </Box>
        )}

        {/* ── Shipment cards ── */}
        {visibleShipments.map((shipment) => (
          <OrderShipmentCard
            key={shipment.id}
            shipment={shipment}
            orderId={order.id}
            onPress={(shipmentId) =>
              router.push(
                `/profile/orders/${order.id}?shipment_id=${shipmentId}` as Href,
              )
            }
          />
        ))}
      </ScrollView>
    </Box>
  );
}

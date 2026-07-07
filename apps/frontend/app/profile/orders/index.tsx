import React, { useState } from 'react';

import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '../../../components/base';
import { GlobalHeader } from '../../../components/layout/GlobalHeader';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { EmptyState } from '../../../components/ui/EmptyState';
import { OrderCard } from '../../../components/features/orders/OrderCard';
import { useAuthContext } from '../../../components/auth/AuthProvider';
import { EnrichedOrder } from '@selene/types';
import { useMyPurchases, useMySales } from '../../../core/hooks/useOrders';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useTheme } from 'react-native-paper';
import { Theme } from '@/core/theme';
import { RefreshControl } from 'react-native';
import { useSeleneRefresh } from '../../../core/hooks/useSeleneRefresh';
import { ErrorState } from '@/components/ui/ErrorState';

export default function OrdersScreen() {
  const { t } = useTranslation('orders');
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const userId = session?.user.id;

  // 0 = Compras, 1 = Ventas
  const [activeTab, setActiveTab] = useState(0);

  const purchasesQuery = useMyPurchases(userId);
  const salesQuery = useMySales(userId);

  // 2. Identificamos la query ACTIVA según el tab
  const activeQuery = activeTab === 0 ? purchasesQuery : salesQuery;

  // 3. Extraemos los estados necesarios
  const {
    data: currentData,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = activeQuery;

  // 4. Orquestamos el refresco manual (Efecto Uber Eats)
  const { isRefreshing, onRefresh } = useSeleneRefresh(refetch);

  // 5. Decidimos si mostrar Skeletons (Carga inicial O Refresco manual)
  const showSkeleton = isLoading || isRefetching;

  if (error && !currentData) {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader title={t('screenTitle')} showBack />
        <Box flex={1} justifyContent="center" alignItems="center" padding="xl">
          <ErrorState
            title={t('common:states.errorTitle')}
            message={
              error instanceof Error
                ? error.message
                : t('common:errors.generic')
            }
            onRetry={() => refetch()}
          />
        </Box>
      </Box>
    );
  }

  const renderItem = ({ item }: { item: EnrichedOrder }) => {
    // Detecta multi-seller desde la fuente canónica: en SCT cada shipment es
    // de un vendedor, por lo que `shipments.length > 1` implica multi-vendedor.
    // Antes se deducía vía el array legacy de order_items casteado a any, lo
    // cual era frágil y dependía del compat-layer de EnrichedOrder.
    const isMultiSeller = (item.shipments?.length ?? 0) > 1;

    return (
      <Box marginBottom="m" paddingHorizontal="m">
        <OrderCard
          order={item}
          isSeller={activeTab === 1}
          onPress={() =>
            router.push(
              isMultiSeller
                ? `/profile/orders/summary/${item.id}`
                : `/profile/orders/${item.id}`,
            )
          }
        />
      </Box>
    );
  };

  // 3. DEFINICIÓN DE HEADER DE LISTA (Contiene las Tabs)
  const renderListHeader = () => (
    <Box paddingHorizontal="m" marginBottom="m">
      <SegmentedControl
        options={[t('tabs.purchases'), t('tabs.sales')]}
        selectedIndex={activeTab}
        onChange={setActiveTab}
      />
    </Box>
  );

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title={t('screenTitle')} showBack />

      <Box flex={1}>
        {/* 1. ESTADO DE CARGA (SKELETONS) */}
        {showSkeleton ? (
          <Box paddingHorizontal="m" style={{ paddingTop: insets.top + 90 }}>
            {/* Simulamos las Tabs */}
            <Skeleton
              width="100%"
              height={44}
              borderRadius={22}
              style={{ marginBottom: 24 }}
            />

            {/* Simulamos las Tarjetas */}
            {[1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                width="100%"
                height={110}
                borderRadius={16}
                style={{ marginBottom: 16 }}
              />
            ))}
          </Box>
        ) : (
          /* 2. LISTA REAL (FLASHLIST) */
          <FlashList
            data={currentData || []}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              paddingTop: insets.top + 90,
              paddingBottom: insets.bottom + 40,
            }}
            ListHeaderComponent={renderListHeader}
            ListEmptyComponent={
              <Box marginTop="xl" paddingHorizontal="m">
                <EmptyState
                  icon={activeTab === 0 ? 'shopping-outline' : 'tag-outline'}
                  title={
                    activeTab === 0
                      ? t('empty.purchasesTitle')
                      : t('empty.salesTitle')
                  }
                  message={
                    activeTab === 0
                      ? t('empty.purchasesMsg')
                      : t('empty.salesMsg')
                  }
                />
              </Box>
            }
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
                progressViewOffset={insets.top + 90}
              />
            }
          />
        )}
      </Box>
    </Box>
  );
}

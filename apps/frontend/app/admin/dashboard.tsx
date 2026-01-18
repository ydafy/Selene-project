import React from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { MyListingCard } from '../../components/features/profile/MyListingCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Theme } from '../../core/theme';
import { useAdminProducts } from '../../core/hooks/useAdminProducts';

export default function AdminDashboardScreen() {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: products, isLoading, refetch } = useAdminProducts();

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        title="Centro de Mando"
        showBack={true}
        backgroundColor="cardBackground"
      />

      <Box flex={1} paddingHorizontal="m">
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingTop: insets.top + 100,
            paddingBottom: 40,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={theme.colors.primary}
            />
          }
          ListHeaderComponent={
            <Box marginBottom="m">
              <Text variant="header-xl" color="primary">
                Cola de Revisión
              </Text>
              <Text variant="body-md" color="textSecondary">
                {products?.length || 0} productos esperando aprobación.
              </Text>
            </Box>
          }
          ListEmptyComponent={
            !isLoading ? (
              <Box marginTop="xl">
                <EmptyState
                  icon="check-all"
                  title="Todo limpio"
                  message="No hay productos pendientes de revisión."
                />
              </Box>
            ) : null
          }
          renderItem={({ item }) => (
            <MyListingCard
              product={item}
              // Al tocar, vamos a la pantalla de revisión (Siguiente paso)
              onPress={() =>
                router.push({
                  pathname: '/admin/review/[id]',
                  params: { id: item.id },
                })
              }
              // Deshabilitamos botones de editar/borrar visualmente
              onEdit={() => {}}
              onDelete={() => {}}
            />
          )}
        />
      </Box>
    </Box>
  );
}

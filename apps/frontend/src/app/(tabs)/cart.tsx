import { useMemo } from 'react';
import { FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';

import { Box } from '../../shared/ui/base';
import { CartItem } from '../../features/cart/components/cart-item';
import { CartSummary } from '../../features/cart/components/cart-summary';
import { EmptyState } from '../../shared/ui/empty-state';
import { ScreenHeader } from '../../shared/ui/screen-header';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { useCartStore } from '../../shared/store/use-cart-store';
import { Theme } from '../../shared/theme';
import { Product } from '@selene/types';
import { useState } from 'react';
import { useAuthContext } from '../../shared/lib/auth/auth-provider';
import { useAuthModal } from '../../shared/lib/auth/auth-modal-context';
import { useCartValidation } from '../../features/cart/hooks/use-cart-validation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTabDockMetrics } from '../../shared/config/layout';

export default function CartScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('cart');
  const { t: tCommon } = useTranslation('common');
  const { session } = useAuthContext();
  const { present } = useAuthModal();
  const insets = useSafeAreaInsets();
  const dockMetrics = getTabDockMetrics(insets.bottom);
  const router = useRouter();
  const {
    unavailableIds,
    hasUnavailableItems,
    isLoading: isValidating,
  } = useCartValidation();

  const { items, removeItem } = useCartStore();
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const total = useMemo(() => {
    return items.reduce((sum, item) => sum + Number(item.price), 0);
  }, [items]);

  const handleItemPress = (product: Product) => {
    router.push({
      pathname: '/product/[id]',
      params: { id: product.id },
    });
  };

  const handleRemovePress = (productId: string) => {
    setItemToDelete(productId);
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      removeItem(itemToDelete);
      setItemToDelete(null);
    }
  };

  const handleCheckout = () => {
    if (!session) {
      // 3. Bloqueo: Si es invitado, abre el modal
      present('register'); // Quizás aquí preferimos sugerir 'register' directamente
      return;
    }
    if (hasUnavailableItems) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push('/checkout' as any);
    // Aquí iría la navegación a Stripe
  };

  return (
    <Box flex={1} backgroundColor="background">
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        // Estilos del contenedor
        contentContainerStyle={{
          padding: theme.spacing.m,
          paddingTop: insets.top + 10,
          paddingBottom: dockMetrics.cartContentBottomClearance,
          flexGrow: 1, // Importante para que el EmptyState se pueda centrar si es necesario
        }}
        ListHeaderComponent={<ScreenHeader title={t('title')} />}
        // 2. ESTADO VACÍO: Se muestra automático si data=[]
        ListEmptyComponent={
          <Box marginTop="xl">
            {/* Un poco de margen para separarlo del header */}
            <EmptyState
              icon="cart-off"
              title={t('emptyTitle')}
              message={t('emptyMsg')}
            />
          </Box>
        }
        renderItem={({ item }) => (
          <CartItem
            product={item}
            onPress={handleItemPress}
            onRemove={handleRemovePress}
            isUnavailable={unavailableIds.has(item.id)}
          />
        )}
      />

      {/* El resumen se oculta solo si no hay items (lógica interna del componente) */}
      <CartSummary
        total={total}
        itemCount={items.length}
        onCheckout={handleCheckout}
        disabled={hasUnavailableItems || isValidating}
      />

      <ConfirmDialog
        visible={!!itemToDelete}
        title={t('dialog.removeItemTitle')}
        description={t('dialog.removeItemMsg')}
        onCancel={() => setItemToDelete(null)}
        onConfirm={confirmDelete}
        confirmLabel={tCommon('dialog.delete')}
        isDangerous={true}
        icon="trash-can-outline"
      />
    </Box>
  );
}

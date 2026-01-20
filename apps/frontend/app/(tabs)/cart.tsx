import { useMemo } from 'react';
import { FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';

import { Box } from '../../components/base';
import { CartItem } from '../../components/features/cart/CartItem';
import { CartSummary } from '../../components/features/cart/CartSummary';
import { EmptyState } from '../../components/ui/EmptyState';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useCartStore } from '../../core/store/useCartStore';
import { Theme } from '../../core/theme';
import { Product } from '@selene/types';
import { useState } from 'react';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useAuthModal } from '../../core/auth/AuthModalProvider';
import { useCartValidation } from '../../components/features/cart/hooks/useCartValidation';

export default function CartScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('cart');
  const { t: tCommon } = useTranslation('common');
  const { session } = useAuthContext(); // 1. Obtener sesión
  const { present } = useAuthModal(); // 2. Obtener función del modal
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
    console.log('Iniciando flujo de pago...');
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
          paddingBottom: 200,
          flexGrow: 1, // Importante para que el EmptyState se pueda centrar si es necesario
        }}
        // 1. HEADER: Siempre visible
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

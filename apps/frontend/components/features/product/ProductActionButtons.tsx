import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Product } from '@selene/types';

import { PrimaryButton } from '../../ui/PrimaryButton';
import { useAuthContext } from '../../../components/auth/AuthProvider';
import { Theme } from '../../../core/theme';

// Importamos el hook de acciones que ya teníamos para reutilizar la lógica de carrito
import { useProductCart } from './hooks/useProductCart';

type ProductActionButtonsProps = {
  product: Product;
};

export const ProductActionButtons = ({
  product,
}: ProductActionButtonsProps) => {
  const { t } = useTranslation(['common', 'product']);
  const { session } = useAuthContext();
  const theme = useTheme<Theme>();

  // Reutilizamos la lógica del carrito
  const { handleAddToCart, isAddingToCart, isAdded } = useProductCart(product);

  const currentUserId = session?.user.id;
  const isOwner = currentUserId === product.seller_id;

  // 1. CASO: DUEÑO DEL PRODUCTO
  if (isOwner) {
    return (
      <PrimaryButton
        onPress={() => console.log('Navegar a Editar')}
        variant="outline"
        icon="pencil-outline"
      >
        {t('product:status.edit')}
      </PrimaryButton>
    );
  }

  // 2. CASO: PRODUCTO VENDIDO
  if (product.status === 'SOLD') {
    return (
      <PrimaryButton
        onPress={() => {}}
        disabled={true}
        buttonColor={theme.colors.cardBackground} // Gris desactivado
      >
        {t('product:status.sold')}
      </PrimaryButton>
    );
  }

  // 3. CASO: PENDIENTE DE VERIFICACIÓN (Protección al Comprador)
  if (
    product.status === 'PENDING_VERIFICATION' ||
    product.status === 'REJECTED'
  ) {
    return (
      <PrimaryButton
        onPress={() => {}}
        disabled={true}
        variant="outline"
        // Podríamos añadir un icono de alerta aquí
        icon="shield-alert-outline"
      >
        {t('product:status.pending')}
      </PrimaryButton>
    );
  }

  // 4. CASO: DISPONIBLE PARA COMPRA (Usuario normal o invitado)
  // Solo llegamos aquí si status === 'VERIFIED'
  return (
    <PrimaryButton
      onPress={handleAddToCart}
      loading={isAddingToCart}
      disabled={isAddingToCart}
      variant={isAdded ? 'outline' : 'solid'}
      icon={isAdded ? 'check' : 'cart-outline'}
    >
      {isAdded ? t('product:actions.added') : t('product:actions.addToCart')}
    </PrimaryButton>
  );
};

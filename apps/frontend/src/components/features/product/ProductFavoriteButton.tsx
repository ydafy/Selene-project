//import Toast from 'react-native-toast-message';
//import { useTranslation } from 'react-i18next'; // <-- Importamos i18n

import { useProductFavorite } from '../../../core/hooks/useProductFavorite';
import { useAuthContext } from '../../../components/auth/AuthProvider';
import { AnimatedHeartButton } from '../../ui/AnimatedHeartButton';
import { useAuthModal } from '../../../core/auth/AuthModalProvider';

type ProductFavoriteButtonProps = {
  productId: string;
  size?: number;
  onFavoriteToggle?: (productId: string, willBeFavorite: boolean) => void;
  /** Called BEFORE unfavoriting. Return false to cancel the toggle. */
  onBeforeUnfavorite?: (productId: string) => boolean | Promise<boolean>;
};

/**
 * Componente Inteligente que maneja toda la lógica de Favoritos.
 */
export const ProductFavoriteButton = ({
  productId,
  size = 24,
  onFavoriteToggle,
  onBeforeUnfavorite,
}: ProductFavoriteButtonProps) => {
  //const { t } = useTranslation(['common', 'auth']); // Usamos el namespace common
  const { session } = useAuthContext();
  const { isFavorite, toggleFavorite } = useProductFavorite(productId);

  // 1. Hook del Modal
  const { present } = useAuthModal();

  const handlePress = async () => {
    if (!session) {
      // 2. REEMPLAZO: En lugar de Toast, abrimos el Modal
      present('login');
      return;
    }

    // If unfavoriting and an onBeforeUnfavorite gate is provided, call it first
    if (isFavorite && onBeforeUnfavorite) {
      const proceed = await onBeforeUnfavorite(productId);
      if (!proceed) return;
    }

    toggleFavorite();
    onFavoriteToggle?.(productId, !isFavorite);
  };

  return (
    <AnimatedHeartButton
      isFavorite={isFavorite}
      onPress={handlePress}
      size={size}
    />
  );
};

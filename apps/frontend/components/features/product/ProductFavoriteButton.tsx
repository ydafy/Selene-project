//import Toast from 'react-native-toast-message';
//import { useTranslation } from 'react-i18next'; // <-- Importamos i18n

import { useProductFavorite } from '../../../core/hooks/useProductFavorite';
import { useAuthContext } from '../../../components/auth/AuthProvider';
import { AnimatedHeartButton } from '../../ui/AnimatedHeartButton';
import { useAuthModal } from '../../../core/auth/AuthModalProvider';

type ProductFavoriteButtonProps = {
  productId: string;
  size?: number;
};

/**
 * Componente Inteligente que maneja toda la lógica de Favoritos.
 */
export const ProductFavoriteButton = ({
  productId,
  size = 24,
}: ProductFavoriteButtonProps) => {
  //const { t } = useTranslation(['common', 'auth']); // Usamos el namespace common
  const { session } = useAuthContext();
  const { isFavorite, toggleFavorite } = useProductFavorite(productId);

  // 1. Hook del Modal
  const { present } = useAuthModal();

  const handlePress = () => {
    if (!session) {
      // 2. REEMPLAZO: En lugar de Toast, abrimos el Modal
      present('login');
      return;
    }

    toggleFavorite();
  };

  return (
    <AnimatedHeartButton
      isFavorite={isFavorite}
      onPress={handlePress}
      size={size}
    />
  );
};

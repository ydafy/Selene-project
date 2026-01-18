import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { Box } from '../../components/base';
// Usamos GlobalHeader en lugar de ScreenHeader + IconButton manual
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { CategoryCard } from '../../components/features/search/CategoryCard';
import { ScreenHeader } from '@/components/layout/ScreenHeader';

import { useSellStore } from '../../core/store/useSellStore';
import { ProductCategory } from '@selene/types';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useAuthModal } from '../../core/auth/AuthModalProvider';

export default function SelectCategoryScreen() {
  const { t } = useTranslation(['sell', 'product']);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const { present } = useAuthModal();
  const setCategory = useSellStore((state) => state.setCategory);

  const handleCategorySelect = (category: string) => {
    if (!session) {
      // Si no hay usuario, mostramos el Login y detenemos todo.
      present('login');
      return;
    }
    // 1. Guardamos en el estado global
    setCategory(category as ProductCategory);

    // 2. Navegamos al siguiente paso
    router.push('/sell/details');
  };

  return (
    <Box flex={1} backgroundColor="background">
      {/* Ocultamos header nativo */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* 1. GLOBAL HEADER */}
      {/* showBack={true} en un modal actúa como botón de "Cerrar/Cancelar" */}
      <GlobalHeader
        title={t('sell:title')}
        showBack={true}
        backgroundColor="cardBackground"
      />

      {/* 2. CONTENIDO */}
      <Box
        paddingHorizontal="m"
        // Padding superior para compensar el header flotante
        style={{ paddingTop: insets.top + 100 }}
      >
        <ScreenHeader
          title={t('sell:title')}
          subtitle={t('sell:selectCategory')}
        />

        {/* Grid de Categorías (Solo las 4 principales) */}
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between">
          <CategoryCard
            label="GPU"
            icon="expansion-card-variant"
            color="primary"
            onPress={() => handleCategorySelect('GPU')}
          />
          <CategoryCard
            label="CPU"
            icon="cpu-64-bit"
            color="primary"
            onPress={() => handleCategorySelect('CPU')}
          />
          <CategoryCard
            label="Motherboard"
            icon="developer-board"
            color="primary"
            onPress={() => handleCategorySelect('Motherboard')}
          />
          <CategoryCard
            label="RAM"
            icon="memory"
            color="primary"
            onPress={() => handleCategorySelect('RAM')}
          />
        </Box>
      </Box>
    </Box>
  );
}

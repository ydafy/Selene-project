import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useState } from 'react';

import { Box } from '../../components/base';
// Usamos GlobalHeader en lugar de ScreenHeader + IconButton manual
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { CategoryCard } from '../../components/features/search/CategoryCard';
import { ScreenHeader } from '@/components/layout/ScreenHeader';

import { useSellStore } from '../../core/store/useSellStore';
import { ProductCategory } from '@selene/types';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useAuthModal } from '../../core/auth/AuthModalProvider';
import { triggerHaptic } from '../../core/utils/haptics';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  SELL_CATEGORIES,
  SELL_CATEGORY_META,
} from '../../core/config/sellCategories';

export default function SelectCategoryScreen() {
  const { t } = useTranslation(['sell', 'product', 'auth', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isSuspended, statusReason } = useAuthContext();
  const [showSuspendedDialog, setShowSuspendedDialog] = useState(false);
  const { present } = useAuthModal();
  const setCategory = useSellStore((state) => state.setCategory);

  const handleCategorySelect = (category: ProductCategory) => {
    if (!session) {
      present('login');
      return;
    }

    // ── GUARDIA DE SUSPENSIÓN CON CONFIRM DIALOG ──
    if (isSuspended) {
      setShowSuspendedDialog(true);
      return;
    }

    triggerHaptic();
    setCategory(category);
    router.push('/sell/details');
  };

  return (
    <Box flex={1} backgroundColor="background">
      {/* Ocultamos header nativo */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* 1. GLOBAL HEADER */}
      {/* showBack={true} en un modal actúa como botón de "Cerrar/Cancelar" */}
      <GlobalHeader
        title={t('sell:headerTitle')}
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

        {/* Grid de Categorías derivadas de la config */}
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between">
          {SELL_CATEGORIES.map((category) => {
            const meta = SELL_CATEGORY_META[category];
            return (
              <CategoryCard
                key={category}
                label={t(meta.labelKey)}
                icon={meta.icon}
                color="primary"
                onPress={() => handleCategorySelect(category)}
              />
            );
          })}
        </Box>
      </Box>
      <ConfirmDialog
        visible={showSuspendedDialog}
        title={t('auth:suspendedDialog.title')}
        description={
          t('auth:suspendedDialog.message') +
          ' ' +
          (statusReason || t('auth:suspendedDialog.noReason'))
        }
        confirmLabel={t('common:dialog.understood')}
        onConfirm={() => setShowSuspendedDialog(false)}
        onCancel={() => setShowSuspendedDialog(false)}
        isDangerous={true}
        icon="alert-circle-outline"
      />
    </Box>
  );
}

/**
 * @file app/(tabs)/index.tsx
 * @description Orquestador de la HomeScreen.
 * Gestiona la experiencia dinámica (Explorer vs Veteran) y la persistencia de sesión.
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { LocationHeaderButton } from '../../components/features/address/LocationHeaderButton';
import { AddressPickerModal } from '../../components/features/address/AddressPickerModal';
import { GridShell } from '../../components/features/home/GridShell';
import { HomeSkeleton } from '../../components/features/home/HomeSkeleton';

import {
  ShellHero,
  ShellLogistics,
  ShellCategoriesV2,
  ShellRecentDrops,
  ShellBenchmarksFeature,
  ShellTrustPipeline,
  ShellRecentlyViewed,
  ShellEditorial,
  ShellFooter,
  ShellShippingLine,
  ShellPaymentsFeature,
} from '../../components/features/home/sections';

import { useCheckoutStore } from '../../core/store/useCheckoutStore';
import { useAddresses } from '../../core/hooks/useAddresses';
import { useProducts } from '../../core/hooks/useProducts';
import { useExperienceStore } from '@/core/store/useExperienceStore';
import { useUnreadNotifications } from '@/core/hooks/useUnreadNotifications';
import { Theme } from '../../core/theme';
import { Address } from '@selene/types';
import { MotiView } from 'moti';
import { useSeleneRefresh } from '@/core/hooks/useSeleneRefresh';
import { useNetInfo } from '@react-native-community/netinfo';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { ErrorState } from '@/components/ui/ErrorState';
import { useTranslation } from 'react-i18next';

// --- RUTAS DEL APP ---
const ROUTES = {
  FAVORITES: '/profile/favorites',
  NOTIFICATIONS: '/profile/notifications',
} as const;

export default function HomeScreen() {
  //throw new Error('SELENE PRUEBA');

  const { t } = useTranslation('common');
  const theme = useTheme<Theme>();
  const { isConnected } = useNetInfo();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addressModalRef = useRef<BottomSheetModal>(null);

  // --- STORES & HOOKS ---
  const { getRank, incrementSessions } = useExperienceStore();
  const rank = useMemo(() => getRank(), [getRank]); // Memoizamos el rank para evitar saltos
  const { isLoading, isRefetching, error, refetch, data } = useProducts();
  const { isRefreshing, onRefresh } = useSeleneRefresh(refetch);
  const { session } = useAuthContext();
  const { data: unreadCount = 0 } = useUnreadNotifications(session?.user.id);
  const { setSelectedAddress } = useCheckoutStore();
  const { setDefault } = useAddresses();

  // --- LIFE CYCLE ---
  useEffect(() => {
    incrementSessions();
    // Nota: El cleanup no es necesario aquí ya que es una acción de "fuego y olvido"
  }, [incrementSessions]);

  // --- HANDLERS MEMOIZADOS ---
  const handleOpenAddressPicker = useCallback(() => {
    addressModalRef.current?.present();
  }, []);

  const handleGoToFavorites = useCallback(() => {
    router.push(ROUTES.FAVORITES);
  }, [router]);

  const handleAddressChange = useCallback(
    (address: Address) => {
      setDefault(address.id);
      setSelectedAddress(address);
      addressModalRef.current?.dismiss();
    },
    [setDefault, setSelectedAddress],
  );

  // --- RENDER CONDICIONAL ---
  // Carga inicial — skeleton
  if (isLoading && !data) {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader
          titleComponent={
            <LocationHeaderButton onPress={handleOpenAddressPicker} />
          }
          alignTitle="flex-start"
          useSafeArea={true}
        />
        <HomeSkeleton rank={rank} />
      </Box>
    );
  }

  // Error sin data previa — pantalla de error con retry
  if (error && !data) {
    return (
      <Box flex={1} backgroundColor="background">
        <GlobalHeader
          titleComponent={
            <LocationHeaderButton onPress={handleOpenAddressPicker} />
          }
          alignTitle="flex-start"
          useSafeArea={true}
        />
        <ErrorState onRetry={refetch} />
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="background">
      <GlobalHeader
        titleComponent={
          <LocationHeaderButton onPress={handleOpenAddressPicker} />
        }
        alignTitle="flex-start"
        useSafeArea={true}
        headerRight={
          <Box flexDirection="row" alignItems="center">
            <IconButton
              icon="heart-outline"
              iconColor={theme.colors.textPrimary}
              size={24}
              onPress={handleGoToFavorites}
              style={{ margin: 0 }}
            />
            <TouchableOpacity
              onPress={() => router.push(ROUTES.NOTIFICATIONS)}
              activeOpacity={0.7}
              style={{ marginLeft: theme.spacing.s }}
            >
              <Box padding="xs">
                <MaterialCommunityIcons
                  name="bell-outline"
                  size={24}
                  color={theme.colors.textPrimary}
                />
                {unreadCount > 0 && (
                  <Box
                    position="absolute"
                    top={2}
                    right={2}
                    backgroundColor="error"
                    minWidth={16}
                    height={16}
                    borderRadius="full"
                    justifyContent="center"
                    alignItems="center"
                    borderWidth={2}
                    borderColor="cardBackground"
                  />
                )}
              </Box>
            </TouchableOpacity>
          </Box>
        }
      />

      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.m,
          paddingTop: insets.top + 90,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Inline error banner durante refetch fallido con data existente */}
        {isRefetching && error && (
          <Box
            backgroundColor="error"
            padding="s"
            borderRadius="s"
            marginBottom="s"
          >
            <Text variant="caption-sm" style={{ color: 'white' }} textAlign="center">
              {t('states.feedLoadError')}
            </Text>
          </Box>
        )}

        {isLoading ? (
          /* 1. ESTADO DE CARGA: Skeleton sincronizado con el rango */
          <HomeSkeleton rank={rank} />
        ) : (
          /* 2. ESTADO ACTIVO: Contenido con transición suave */
          <MotiView
            from={{ opacity: 0, translateY: 15 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{
              type: 'timing',
              duration: 500,
            }}
          >
            <GridShell>
              {rank === 'EXPLORER' ? (
                /* --- LAYOUT: EXPLORER --- */
                <>
                  <ShellHero />
                  <ShellCategoriesV2 />
                  <ShellPaymentsFeature />
                  <ShellShippingLine />
                  <ShellBenchmarksFeature />
                  <ShellTrustPipeline />
                  <ShellRecentDrops />
                  <ShellLogistics />
                  <ShellRecentlyViewed />
                </>
              ) : (
                /* --- LAYOUT: VETERAN --- */
                <>
                  <ShellRecentlyViewed />
                  <ShellEditorial />
                  <ShellRecentDrops />
                  <ShellCategoriesV2 />
                  <ShellHero />
                  <ShellPaymentsFeature />
                  <ShellShippingLine />
                  <ShellBenchmarksFeature />
                  <ShellTrustPipeline />
                  <ShellLogistics />
                </>
              )}
              {/* Footer común para ambos perfiles */}
              <ShellFooter />
            </GridShell>
          </MotiView>
        )}
      </ScrollView>

      <AddressPickerModal
        innerRef={addressModalRef}
        onSelect={handleAddressChange}
      />
    </Box>
  );
}

/**
 * @file app/profile/[id].tsx
 * @description Public seller profile screen (CONF-015 / CON-001).
 *
 * Flow:
 * 1. Single database fetch: useProfile gets the seller profile and pre-computed stats.
 * 2. Parallel lazy fetches: useProducts (filtered by seller) and useSellerReviews.
 * 3. SegmentedControl switches between 'Publicaciones' (active products grid) and 'Reseñas' (buyer reviews).
 *
 * Pure dark theme cyberpunk styles, full i18n support, and clean TypeScript typings.
 */
import React, { useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { FlashList } from '@shopify/flash-list';
import { UserReviewCard } from '../../components/features/users/UserReviewCard';

import { Box, Text } from '../../components/base';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { ProfileHeader } from '../../components/features/profile/ProfileHeader';
import { OptionsMenu } from '../../components/ui/OptionsMenu';
import { AppImage } from '../../components/ui/AppImage';
import { Skeleton } from '../../components/ui/Skeleton';

// Hooks unificados de alto rendimiento
import { useProfile } from '../../core/hooks/useProfile';
import { useProducts } from '../../core/hooks/useProducts';
import { useSellerReviews } from '../../core/hooks/useSellerReviews';
import { formatCurrency } from '../../core/utils/format';
import { Theme } from '../../core/theme';
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthContext } from '../../components/auth/AuthProvider';
import {
  resolvePublicProfileCollectionState,
  resolvePublicProfileSellerId,
  shouldHidePublicProfileModerationActions,
} from './publicProfile.helpers';

const { width } = Dimensions.get('window');
const PRODUCT_CARD_WIDTH = (width - 48) / 2; // Dos columnas responsivas

type RetryableStateProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  actionLabel: string;
  onRetry: () => void;
};

const RetryableState = ({
  icon,
  title,
  actionLabel,
  onRetry,
}: RetryableStateProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box padding="xl" alignItems="center" marginTop="xl">
      <MaterialCommunityIcons
        name={icon}
        size={48}
        color={theme.colors.error}
      />
      <Text variant="body-md" color="error" marginTop="m" textAlign="center">
        {title}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        style={{ marginTop: 16 }}
      >
        <Text variant="body-sm" color="primary" fontWeight="bold">
          {actionLabel}
        </Text>
      </TouchableOpacity>
    </Box>
  );
};

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { t } = useTranslation(['profile', 'common']);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();

  const [activeTab, setActiveTab] = useState(0);
  const sellerId = resolvePublicProfileSellerId(id);
  const isSellerIdValid = sellerId !== null;

  // 1. Carga Atómica del Perfil (Trae datos de usuario + estadísticas pre-calculadas en una sola query!)
  const {
    data: profile,
    isLoading: isProfileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useProfile(sellerId ?? '');

  // 2. Carga del Inventario Activo (Usa el hook useProducts extendido de forma no-destructiva)
  const {
    data: products,
    isLoading: isProductsLoading,
    error: productsError,
    refetch: refetchProducts,
  } = useProducts({
    sellerId: sellerId ?? undefined,
    verifiedOnly: true, // Solo traemos productos que estén listos para la venta (excluye vendidos/ocultos)
    enabled: isSellerIdValid,
  });

  // 3. Carga del Historial de Reseñas Relacionales
  const {
    data: reviews,
    isLoading: isReviewsLoading,
    error: reviewsError,
    refetch: refetchReviews,
  } = useSellerReviews(sellerId ?? undefined);

  const isOwner = shouldHidePublicProfileModerationActions(
    session?.user.id,
    sellerId,
  );
  const productsState = resolvePublicProfileCollectionState({
    error: productsError,
    isLoading: isProductsLoading,
    itemCount: products?.length ?? 0,
  });
  const reviewsState = resolvePublicProfileCollectionState({
    error: reviewsError,
    isLoading: isReviewsLoading,
    itemCount: reviews?.length ?? 0,
  });

  const tabs = useMemo(
    () => [
      t('profile:public.tabProducts', 'Publicaciones'),
      t('profile:public.tabReviews', 'Reseñas'),
    ],
    [t],
  );

  if (!isSellerIdValid) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="background"
        padding="xl"
      >
        <Text variant="body-md" color="error" textAlign="center">
          {t('profile:public.errors.invalidProfile')}
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('profile:public.actions.goBack')}
          style={{ marginTop: 16 }}
        >
          <Text variant="body-sm" color="primary" fontWeight="bold">
            {t('profile:public.actions.goBack')}
          </Text>
        </TouchableOpacity>
      </Box>
    );
  }

  if (isProfileLoading) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="background"
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </Box>
    );
  }

  if (profileError || !profile) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="background"
      >
        <Text variant="body-md" color="error">
          {t('common:errors.generic', 'No se pudo cargar el perfil.')}
        </Text>
        <TouchableOpacity
          onPress={() => refetchProfile()}
          accessibilityRole="button"
          accessibilityLabel={t('profile:public.actions.retry')}
          style={{ marginTop: 16 }}
        >
          <Text variant="body-sm" color="primary" fontWeight="bold">
            {t('profile:public.actions.retry')}
          </Text>
        </TouchableOpacity>
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={[theme.colors.transparent, 'transparent']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + 20,
          zIndex: 101,
        }}
        pointerEvents="none"
      />
      <GlobalHeader title={profile.username ?? undefined} showBack />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 40, // Espacio para el header flotante
          paddingBottom: 10,
        }}
      >
        {/* 🛡️ Cabecera Unificada: lee las estadísticas directamente del perfil sin parches de tipos */}
        <ProfileHeader
          profile={profile}
          headerRight={
            <OptionsMenu
              targetId={profile.id}
              sellerId={profile.id}
              context="user"
              isOwner={isOwner}
            />
          }
        />

        {/* CONTROL SEGMENTADO ATÓMICO (Reutilización del 100%) */}
        <Box marginHorizontal="m" marginTop="l">
          <SegmentedControl
            options={tabs}
            selectedIndex={activeTab}
            onChange={(index) => setActiveTab(index)}
          />
        </Box>

        {/* CONTENIDO DINÁMICO CON TRANSICIONES DE SEDA */}
        <Box flex={1} marginTop="m" paddingHorizontal="m" paddingBottom="xl">
          {activeTab === 0 ? (
            <MotiView
              key="products_tab"
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 250 }}
              style={{ flex: 1 }}
            >
              {productsState === 'error' ? (
                <RetryableState
                  icon="alert-circle-outline"
                  title={t('profile:public.errors.products')}
                  actionLabel={t('profile:public.actions.retry')}
                  onRetry={() => refetchProducts()}
                />
              ) : productsState === 'loading' ? (
                <Box flexDirection="row" flexWrap="wrap" gap="m" marginTop="s">
                  <Skeleton
                    width={PRODUCT_CARD_WIDTH}
                    height={180}
                    borderRadius={12}
                  />
                  <Skeleton
                    width={PRODUCT_CARD_WIDTH}
                    height={180}
                    borderRadius={12}
                  />
                </Box>
              ) : productsState === 'empty' ? (
                <Box padding="xl" alignItems="center" marginTop="xl">
                  <MaterialCommunityIcons
                    name="tag-off-outline"
                    size={48}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    variant="body-md"
                    color="textSecondary"
                    marginTop="m"
                    textAlign="center"
                  >
                    {t('profile:public.empty.products')}
                  </Text>
                </Box>
              ) : (
                <FlashList
                  data={products}
                  keyExtractor={(item) => item.id}
                  numColumns={2}
                  scrollEnabled={false}
                  // Delegamos el scroll al contenedor padre ScreenLayout
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => router.push(`/product/${item.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={t('profile:public.a11y.productCard', {
                        name: item.name,
                      })}
                      style={{ width: PRODUCT_CARD_WIDTH }}
                    >
                      <Box
                        backgroundColor="cardBackground"
                        borderRadius="l"
                        overflow="hidden"
                        borderWidth={1}
                        borderColor="separator"
                      >
                        <Box
                          height={120}
                          backgroundColor="background"
                          justifyContent="center" // Centra el icono vectorial verticalmente
                          alignItems="center" // Centra el icono vectorial horizontalmente
                        >
                          {item.images?.[0] ? (
                            <AppImage
                              source={{ uri: item.images[0] }}
                              style={{ width: '100%', height: '100%' }}
                              contentFit="cover"
                            />
                          ) : (
                            // 🛡️ Fallback Vectorial con Cero peso y alta cohesión temática
                            <MaterialCommunityIcons
                              name="image-off-outline"
                              size={32}
                              color={theme.colors.textSecondary}
                            />
                          )}
                        </Box>
                        <Box padding="s">
                          <Text
                            variant="body-sm"
                            fontWeight="bold"
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          <Text
                            variant="body-md"
                            color="primary"
                            marginTop="xs"
                          >
                            {formatCurrency(Number(item.price))}
                          </Text>
                        </Box>
                      </Box>
                    </TouchableOpacity>
                  )}
                />
              )}
            </MotiView>
          ) : (
            <MotiView
              key="reviews_tab"
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 250 }}
              style={{ flex: 1 }}
            >
              {reviewsState === 'error' ? (
                <RetryableState
                  icon="alert-circle-outline"
                  title={t('profile:public.errors.reviews')}
                  actionLabel={t('profile:public.actions.retry')}
                  onRetry={() => refetchReviews()}
                />
              ) : reviewsState === 'loading' ? (
                <Box gap="m" marginTop="s">
                  <Skeleton width="100%" height={100} borderRadius={12} />
                  <Skeleton width="100%" height={100} borderRadius={12} />
                </Box>
              ) : reviewsState === 'empty' ? (
                <Box padding="xl" alignItems="center" marginTop="xl">
                  <MaterialCommunityIcons
                    name="message-draw"
                    size={48}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    variant="body-md"
                    color="textSecondary"
                    marginTop="m"
                    textAlign="center"
                  >
                    {t('profile:public.empty.reviews')}
                  </Text>
                </Box>
              ) : (
                <FlashList
                  data={reviews}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false} // Delegamos el scroll al contenedor padre ScreenLayout
                  renderItem={({ item }) => (
                    <Box marginBottom="m">
                      <UserReviewCard review={item} />
                    </Box>
                  )}
                />
              )}
            </MotiView>
          )}
        </Box>
      </ScrollView>
    </Box>
  );
}

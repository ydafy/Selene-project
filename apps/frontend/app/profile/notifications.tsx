import React from 'react';
import { RefreshControl, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { NotificationItem } from '../../components/features/notifications/NotificationItem';
import { useNotifications } from '../../core/hooks/useNotifications';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { Skeleton } from '../../components/ui/Skeleton';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

export default function NotificationsScreen() {
  const { t } = useTranslation(['orders', 'common', 'notifications']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuthContext();

  const {
    data: notifications,
    isLoading,
    isRefetching,
    refetch,
    markAsRead,
    markAllAsRead,
  } = useNotifications(session?.user.id);

  const showSkeletons = isLoading || isRefetching;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNotificationPress = async (notif: any) => {
    await markAsRead(notif.id);
    if (notif.action_path) {
      router.push(notif.action_path as never);
    }
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        title={t('notifications:title')}
        showBack
        headerRight={
          notifications && notifications.some((n) => !n.read) ? (
            <TouchableOpacity
              onPress={markAllAsRead}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              {/* Mostramos el texto sutilmente al lado del icono */}
              <Text variant="caption-md" color="primary" marginRight="xs">
                {t('notifications:markAll')}
              </Text>
              <MaterialCommunityIcons
                name="email-open-outline"
                size={20}
                color={theme.colors.primary}
              />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {showSkeletons ? (
        // --- SKELETONS DURANTE CARGA Y REFRESH ---
        <Box paddingHorizontal="m" style={{ paddingTop: insets.top + 90 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Box
              key={i}
              flexDirection="row"
              marginBottom="m"
              alignItems="center"
            >
              <Skeleton width={40} height={40} borderRadius={20} />
              <Box marginLeft="m" flex={1}>
                <Skeleton width="60%" height={15} borderRadius={4} />
                <Skeleton width="90%" height={12} borderRadius={4} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <FlashList
          data={notifications}
          keyExtractor={(item) => item.id}
          drawDistance={500}
          contentContainerStyle={{
            paddingTop: insets.top + 80,
            paddingBottom: insets.bottom + 20,
          }}
          renderItem={({ item }) => (
            <NotificationItem
              notification={item}
              onPress={handleNotificationPress}
            />
          )}
          ListEmptyComponent={
            <Box marginTop="xl">
              <EmptyState
                icon="bell-off-outline"
                title={t('notifications:emptyTitle')}
                message={t('notifications:emptyMsg')}
              />
            </Box>
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={theme.colors.primary}
              progressViewOffset={insets.top + 70}
            />
          }
        />
      )}
    </Box>
  );
}

import React, { useState } from 'react';
import { RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlashList } from '@shopify/flash-list';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { NotificationItem } from '../../components/features/notifications/NotificationItem';
import { useNotificationsList } from '../../core/hooks/useNotificationsList';
import { useNotificationMutations } from '../../core/hooks/useNotificationMutations';
import { NotificationLinking } from '../../core/services/notification';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { Skeleton } from '../../components/ui/Skeleton';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';
import { Notification } from '@selene/types';

export default function NotificationsScreen() {
  const { t } = useTranslation(['orders', 'common', 'notifications']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const [showClearAll, setShowClearAll] = useState(false);

  const {
    data: notifications,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useNotificationsList(userId);

  const {
    markAsRead,
    markAllAsRead,
    dismissNotification,
    dismissAll,
  } = useNotificationMutations(userId);

  const handleNotificationPress = async (notif: Notification) => {
    await markAsRead(notif.id);
    await NotificationLinking.navigate(notif.action_path);
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
  };

  const handleClearAll = async () => {
    setShowClearAll(false);
    await dismissAll();
  };

  const hasNotifications = notifications && notifications.length > 0;

  if (isLoading) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader title={t('notifications:title')} showBack />
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
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        title={t('notifications:title')}
        showBack
        headerRight={
          <Box flexDirection="row" alignItems="center" gap="s">
            {notifications && notifications.some((n) => !n.read) && (
              <TouchableOpacity
                onPress={handleMarkAllAsRead}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Text variant="caption-md" color="primary" marginRight="xs">
                  {t('notifications:markAll')}
                </Text>
                <MaterialCommunityIcons
                  name="email-open-outline"
                  size={20}
                  color={theme.colors.primary}
                />
              </TouchableOpacity>
            )}
            {hasNotifications && (
              <TouchableOpacity
                onPress={() => setShowClearAll(true)}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Text variant="caption-md" color="error" marginRight="xs">
                  {t('notifications:clearAllLabel')}
                </Text>
                <MaterialCommunityIcons
                  name="notification-clear-all"
                  size={20}
                  color={theme.colors.error}
                />
              </TouchableOpacity>
            )}
          </Box>
        }
      />

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
            onDismiss={dismissNotification}
          />
        )}
        onEndReached={hasNextPage ? fetchNextPage : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <Box paddingVertical="m" alignItems="center">
              <ActivityIndicator color={theme.colors.primary} />
            </Box>
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <Box marginTop="xl">
              <EmptyState
                icon="bell-off-outline"
                title={t('notifications:emptyTitle')}
                message={t('notifications:emptyMsg')}
              />
            </Box>
          ) : null
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

      <ConfirmDialog
        visible={showClearAll}
        title={t('notifications:clearAllLabel')}
        description={t('notifications:clearAllConfirm')}
        onConfirm={handleClearAll}
        onCancel={() => setShowClearAll(false)}
        confirmLabel={t('common:dialog.delete')}
        cancelLabel={t('common:dialog.cancel')}
        isDangerous
      />
    </Box>
  );
}

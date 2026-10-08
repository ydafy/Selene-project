import React from 'react';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { Notification } from '@selene/types';
import { formatSmartTime } from '../../../core/utils/format';
import { getNotificationPresentation, getVerifiedEventIdentity } from './notificationPresentation';

interface Props {
  notification: Notification;
  onPress: (notification: Notification) => void;
}

export const NotificationItem = ({
  notification,
  onPress,
}: Props) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('notifications');

  const isUnread = !notification.read;
  const presentation = getNotificationPresentation(notification);
  const iconColor = theme.colors[presentation.accent];

  const identity = getVerifiedEventIdentity(notification);
  const emphasizeMessage = identity?.kind === 'product.approved_with_note' || identity?.kind === 'product.rejected';

  return (
    <Pressable
      onPress={() => onPress(notification)}
      accessibilityLabel={t('notifications:itemLabel', {
        state: t(`notifications:states.${presentation.state}`),
        readState: t(isUnread ? 'notifications:unreadState' : 'notifications:readState'),
        title: notification.title,
        message: notification.message || '',
      })}
      accessibilityRole="button"
    >
      {({ pressed }) => (
        <Box
          flexDirection="row"
          padding="m"
          backgroundColor={pressed ? 'pressableShadow' : 'transparent'}
          opacity={isUnread ? 1 : 0.6}
          borderBottomWidth={1}
          borderBottomColor="separator"
        >
          {/* ICONO */}
          <Box
            width={40}
            height={40}
            borderRadius="full"
            backgroundColor="cardBackground"
            justifyContent="center"
            alignItems="center"
          >
            <MaterialCommunityIcons
              name={presentation.icon}
              size={22}
              color={iconColor}
            />
          </Box>

          {/* TEXTO */}
          <Box flex={1} marginLeft="m">
            <Box
              flexDirection="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Text
                variant="body-md"
                fontWeight={isUnread ? 'bold' : 'regular'}
                color="textPrimary"
              >
                {notification.title}
              </Text>
              {isUnread && (
                <Box
                  width={8}
                  height={8}
                  borderRadius="full"
                  backgroundColor="error"
                />
              )}
            </Box>
            <Text variant="caption-md" color="textSecondary" marginTop="xs" fontStyle={emphasizeMessage ? 'italic' : 'normal'}>
              {notification.message}
            </Text>
            <Text variant="caption-md" color="textSecondary" marginTop="s">
              {formatSmartTime(notification.created_at)}
            </Text>
          </Box>
        </Box>
      )}
    </Pressable>
  );
};

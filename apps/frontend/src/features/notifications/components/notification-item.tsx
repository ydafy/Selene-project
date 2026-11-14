import React from 'react';
import { Pressable } from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '@/shared/ui/base';
import { Theme } from '@/shared/theme';
import { Notification } from '@selene/types';
import { formatSmartTime } from '@/shared/utils/format-date';
import { formatCurrency } from '@/shared/utils/money/format-currency';
import {
  getNotificationPresentation,
  getVerifiedEventIdentity,
} from '../logic/notification-presentation';
import { getNotificationText } from '../logic/notification-text';

// Payload amounts are integer cents; decimals exist only for display.
const formatCents = (cents: number) => formatCurrency(cents / 100);

interface Props {
  notification: Notification;
  onPress: (notification: Notification) => void;
}

export const NotificationItem = ({ notification, onPress }: Props) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('notifications');

  const isUnread = !notification.read;
  const presentation = getNotificationPresentation(notification);
  const iconColor = theme.colors[presentation.accent];
  const text = getNotificationText(notification, t, formatCents);

  const identity = getVerifiedEventIdentity(notification);
  const emphasizeMessage =
    identity?.kind === 'product.approved_with_note' ||
    identity?.kind === 'product.rejected';

  return (
    <Pressable
      onPress={() => onPress(notification)}
      accessibilityLabel={t('notifications:itemLabel', {
        state: t(`notifications:states.${presentation.state}`),
        readState: t(
          isUnread ? 'notifications:unreadState' : 'notifications:readState',
        ),
        title: text.title,
        message: text.message || '',
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
                {text.title}
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
            <Text
              variant="caption-md"
              color="textSecondary"
              marginTop="xs"
              fontStyle={emphasizeMessage ? 'italic' : 'normal'}
            >
              {text.message}
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

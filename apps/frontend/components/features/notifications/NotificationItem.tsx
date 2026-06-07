import React from 'react';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { Notification } from '@selene/types';
import { formatSmartTime } from '../../../core/utils/format';

interface Props {
  notification: Notification;
  onPress: (notification: Notification) => void;
}

export const NotificationItem = ({ notification, onPress }: Props) => {
  const theme = useTheme<Theme>();

  const isUnread = !notification.read;

  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return 'check-circle-outline';
      case 'error':
        return 'alert-circle-outline';
      case 'warning':
        return 'alert-outline';
      default:
        return 'bell-outline';
    }
  };

  const iconColor =
    notification.type === 'error'
      ? theme.colors.error
      : notification.type === 'success'
        ? theme.colors.success
        : theme.colors.primary;

  return (
    <Pressable onPress={() => onPress(notification)}>
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
              name={getIcon()}
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
            <Text variant="caption-md" color="textSecondary" marginTop="xs">
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

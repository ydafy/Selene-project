import React, { useState, useRef, useEffect } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useTheme } from '@shopify/restyle';

import { MotiView } from 'moti';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';

import { formatCurrency, formatDate } from '../../../core/utils/format';
import {
  getOrderStatusColor,
  getOrderStatusLabel,
} from '../../../core/utils/order-status';
import { EnrichedOrder, OrderStatus } from '@selene/types';
import { useTranslation } from 'react-i18next';

interface Props {
  order: EnrichedOrder;
  isSeller: boolean;
  onPress: () => void;
}

// --- PULSEDOT
const PulseDot = ({ color = '#EF4444' }: { color?: string }) => {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    anim.start();
    return () => anim.stop(); // Cleanup correcto para evitar leaks
  }, [opacity]);

  return (
    <Animated.View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: color,
        marginRight: 8,
        opacity: opacity,
        shadowColor: color,
        shadowRadius: 4,
        elevation: 4,
      }}
    />
  );
};

export const OrderCard = ({ order, isSeller, onPress }: Props) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['orders', 'common']);
  const [activeIndex, setActiveIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(
    Dimensions.get('window').width - 40,
  );

  // Fallback de seguridad para el status
  const safeStatus: OrderStatus = order.status || 'pending';

  const currentProduct = order.items[activeIndex]?.product;
  const statusColor = getOrderStatusColor(safeStatus);
  const statusLabel = t(getOrderStatusLabel(safeStatus)).toUpperCase();
  const showPulse = ['paid', 'shipped'].includes(safeStatus);
  const hasMultipleItems = order.items.length > 1;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    const index = Math.round(x / containerWidth);
    if (index !== activeIndex) setActiveIndex(index);
  };

  return (
    <MotiView
      from={{ opacity: 0, translateY: 10 }}
      animate={{ opacity: 1, translateY: 0 }}
    >
      <Box
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        backgroundColor="cardBackground"
        borderRadius="l"
        overflow="hidden"
        borderWidth={1}
        borderColor="separator"
        style={{
          elevation: 4,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
        }}
      >
        {/* LINEA DE ESTADO */}
        <Box
          position="absolute"
          left={0}
          top={0}
          bottom={0}
          width={4}
          style={{
            backgroundColor: theme.colors[statusColor as keyof Theme['colors']],
            zIndex: 10,
          }}
        />

        {/* ÁREA VISUAL */}
        <Box height={180} width="100%" backgroundColor="background">
          {hasMultipleItems ? (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                decelerationRate="fast"
              >
                {order.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={onPress}
                    style={{ width: containerWidth, height: 180 }}
                  >
                    {({ pressed }) => (
                      <>
                        {item.product?.images?.[0] ? (
                          <AppImage
                            source={{ uri: item.product.images[0] }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                          />
                        ) : (
                          <Box
                            flex={1}
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="background"
                          >
                            <MaterialCommunityIcons
                              name="image-off-outline"
                              size={32}
                              color={theme.colors.textSecondary}
                            />
                          </Box>
                        )}
                        {pressed && (
                          <Box
                            style={StyleSheet.absoluteFill}
                            backgroundColor="textPrimary"
                            opacity={0.05}
                          />
                        )}
                      </>
                    )}
                  </Pressable>
                ))}
              </ScrollView>

              {/* INDICADORES (PAGINACIÓN) */}
              <Box
                position="absolute"
                bottom={12}
                width="100%"
                flexDirection="row"
                justifyContent="center"
                gap="xs"
              >
                {order.items.map((_, i) => (
                  <Box
                    key={i}
                    width={i === activeIndex ? 12 : 6}
                    height={6}
                    borderRadius="full"
                    backgroundColor="textPrimary"
                    style={{ opacity: i === activeIndex ? 1 : 0.4 }}
                  />
                ))}
              </Box>
            </>
          ) : (
            <Pressable onPress={onPress} style={{ flex: 1 }}>
              {({ pressed }) => (
                <>
                  {currentProduct?.images?.[0] ? (
                    <AppImage
                      source={{ uri: currentProduct.images[0] }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                  ) : (
                    <Box flex={1} justifyContent="center" alignItems="center">
                      <MaterialCommunityIcons
                        name="image-off-outline"
                        size={32}
                        color={theme.colors.textSecondary}
                      />
                    </Box>
                  )}
                  {pressed && (
                    <Box
                      style={StyleSheet.absoluteFill}
                      backgroundColor="textPrimary"
                      opacity={0.05}
                    />
                  )}
                </>
              )}
            </Pressable>
          )}

          <LinearGradient
            colors={['transparent', 'rgba(18,18,18,0.8)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* BADGE DE ESTADO */}
          <Box position="absolute" top={12} right={12}>
            <Box
              flexDirection="row"
              alignItems="center"
              paddingHorizontal="m"
              paddingVertical="xs"
              borderRadius="full"
              borderWidth={1}
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderColor: theme.colors[statusColor as keyof Theme['colors']],
              }}
            >
              {showPulse && (
                <PulseDot
                  color={theme.colors[statusColor as keyof Theme['colors']]}
                />
              )}
              <Text
                variant="caption-md"
                fontWeight="bold"
                style={{
                  color: theme.colors[statusColor as keyof Theme['colors']],
                  fontSize: 11,
                  letterSpacing: 1,
                }}
              >
                {statusLabel.toUpperCase()}
              </Text>
            </Box>
          </Box>

          {/* PRECIO */}
          <Box position="absolute" bottom={12} right={12}>
            <Text
              variant="header-xl"
              color="primary"
              style={{
                fontSize: 26,
                textShadowColor: 'rgba(0,0,0,0.8)',
                textShadowRadius: 4,
              }}
            >
              {formatCurrency(order.total_amount)}
            </Text>
          </Box>
        </Box>

        {/* PANEL DE DATOS */}
        <Pressable onPress={onPress}>
          {({ pressed }) => (
            <Box
              padding="m"
              style={{
                backgroundColor: pressed
                  ? 'rgba(255,255,255,0.03)'
                  : 'transparent',
              }}
            >
              <Box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
                marginBottom="s"
              >
                <Text
                  variant="subheader-md"
                  numberOfLines={1}
                  fontWeight="bold"
                  color="textPrimary"
                  style={{ flex: 1 }}
                >
                  {currentProduct?.name || 'Producto desconocido'}
                </Text>
                <MaterialCommunityIcons
                  name={isSeller ? 'tag-outline' : 'shopping-outline'}
                  size={20}
                  color={
                    isSeller ? theme.colors.primary : theme.colors.textSecondary
                  }
                />
              </Box>

              <Box
                flexDirection="row"
                alignItems="center"
                gap="m"
                opacity={0.7}
              >
                <Box flexDirection="row" alignItems="center">
                  <MaterialCommunityIcons
                    name="clock-outline"
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    marginLeft="xs"
                  >
                    {formatDate(order.created_at)}
                  </Text>
                </Box>
                <Box flexDirection="row" alignItems="center">
                  <MaterialCommunityIcons
                    name="package-variant"
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    marginLeft="xs"
                  >
                    {t('common:units.item_count', {
                      count: order.items.length,
                    })}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}
        </Pressable>
      </Box>
    </MotiView>
  );
};

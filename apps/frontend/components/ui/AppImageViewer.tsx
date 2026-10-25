import React, { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gallery, fitContainer, type SwipeDirection } from 'react-native-zoom-toolkit';
import { Image, type ImageLoadEventData } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../base';
import { colors } from '@/core/theme/tokens';

export type ImageSource = { uri: string } | number;

type CounterParams = { current: number; total: number };

type AppImageViewerProps = {
  /** Image sources to display (network URIs or local require paths) */
  images: ImageSource[];
  /** Index of the image to display first upon opening */
  initialIndex?: number;
  /** Visibility flag to open/close the modal */
  visible: boolean;
  /** Callback triggered when the user requests to close the viewer */
  onClose: () => void;
  /** Accessible label for the close button; defaults to common:imageViewer.close */
  closeAccessibilityLabel?: string;
  /** Builds the accessible label for the counter; defaults to common:imageViewer.counterLabel */
  counterAccessibilityLabel?: (params: CounterParams) => string;
  /** Builds the visible footer text; defaults to "current / total" */
  footerText?: (params: CounterParams) => string;
};

/** One gallery cell: the image keeps its aspect ratio and fits the screen. */
const ViewerImage = ({ source }: { source: ImageSource }) => {
  const { width, height } = useWindowDimensions();
  const [aspectRatio, setAspectRatio] = useState(1);

  const handleLoad = useCallback((event: ImageLoadEventData) => {
    const { width: imageWidth, height: imageHeight } = event.source;
    if (imageWidth > 0 && imageHeight > 0) setAspectRatio(imageWidth / imageHeight);
  }, []);

  return (
    <Image
      source={source}
      style={fitContainer(aspectRatio, { width, height })}
      contentFit="contain"
      onLoad={handleLoad}
    />
  );
};

export const AppImageViewer = ({
  images,
  initialIndex = 0,
  visible,
  onClose,
  closeAccessibilityLabel,
  counterAccessibilityLabel,
  footerText,
}: AppImageViewerProps) => {
  const { t } = useTranslation('common');
  const [index, setIndex] = useState(initialIndex);
  const [openedAt, setOpenedAt] = useState(initialIndex);

  // Start from the requested image each time the viewer opens on a new one.
  if (openedAt !== initialIndex) {
    setOpenedAt(initialIndex);
    setIndex(initialIndex);
  }

  const renderItem = useCallback(
    (item: ImageSource) => <ViewerImage source={item} />,
    [],
  );
  const keyExtractor = useCallback(
    (item: ImageSource, itemIndex: number) =>
      typeof item === 'number' ? `${item}-${itemIndex}` : `${item.uri}-${itemIndex}`,
    [],
  );
  const handleSwipe = useCallback(
    (direction: SwipeDirection) => {
      // Horizontal swipes page between images; a vertical swipe dismisses.
      if (direction === 'up' || direction === 'down') onClose();
    },
    [onClose],
  );

  if (!images || images.length === 0) return null;

  const counter = { current: index + 1, total: images.length };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Gestures inside a Modal need their own root view on Android. */}
      <GestureHandlerRootView style={styles.root}>
        <Gallery
          key={initialIndex}
          data={images}
          initialIndex={initialIndex}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          onIndexChange={setIndex}
          onSwipe={handleSwipe}
        />

        <SafeAreaView edges={['top']} style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeAccessibilityLabel ?? t('imageViewer.close')}
            hitSlop={12}
            style={styles.closeButton}
          >
            <MaterialCommunityIcons name="close" size={24} color={colors.textPrimary} />
          </Pressable>
        </SafeAreaView>

        <SafeAreaView edges={['bottom']} style={styles.footer} pointerEvents="none">
          <Box
            backgroundColor="background"
            opacity={0.8}
            paddingHorizontal="m"
            paddingVertical="s"
            borderRadius="l"
            borderWidth={1}
            borderColor="separator"
            accessible
            accessibilityLabel={
              counterAccessibilityLabel?.(counter) ??
              t('imageViewer.counterLabel', counter)
            }
          >
            <Text variant="body-md" color="textPrimary" fontWeight="bold">
              {footerText ? footerText(counter) : `${counter.current} / ${counter.total}`}
            </Text>
          </Box>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.mediaBackground,
  },
  header: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  closeButton: {
    margin: 16,
    padding: 8,
    borderRadius: 20,
    // Dark translucent scrim, the same token other overlays use.
    backgroundColor: colors.focus,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
});

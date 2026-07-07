import React from 'react';
import { StyleSheet } from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';

import { Box, Text } from '../base';

type ImageSource = { uri: string } | number;

type CounterAccessibilityLabelBuilder = (params: {
  current: number;
  total: number;
}) => string;

type AppImageViewerProps = {
  /** Array of image sources to display (either network URIs or local require paths) */
  images: ImageSource[];
  /** Index of the image to display first upon opening */
  initialIndex?: number;
  /** Visibility flag to open/close the modal */
  visible: boolean;
  /** Callback triggered when the user requests to close the viewer */
  onClose: () => void;
  /** Accessible label for the close button */
  closeAccessibilityLabel?: string;
  /** Builds the accessible label for the image counter */
  counterAccessibilityLabel?: CounterAccessibilityLabelBuilder;
};

export const AppImageViewer = ({
  images,
  initialIndex = 0,
  visible,
  onClose,
  closeAccessibilityLabel = 'Close image viewer',
  counterAccessibilityLabel = ({ current, total }) =>
    `Image ${current} of ${total}`,
}: AppImageViewerProps) => {
  if (!images || images.length === 0) return null;

  const normalizedImages = images.map((img) => {
    if (typeof img === 'number') return img;
    return img;
  });

  const renderHeader = () => (
    <SafeAreaView edges={['top']} style={styles.headerContainer}>
      <IconButton
        icon="close"
        iconColor="white"
        size={28}
        onPress={onClose}
        style={styles.closeButton}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={closeAccessibilityLabel}
      />
    </SafeAreaView>
  );

  const renderFooter = ({ imageIndex }: { imageIndex: number }) => {
    const current = imageIndex + 1;
    const total = images.length;

    return (
      <SafeAreaView edges={['bottom']} style={styles.footerContainer}>
        <Box
          backgroundColor="background"
          opacity={0.8}
          paddingHorizontal="m"
          paddingVertical="s"
          borderRadius="l"
          borderWidth={1}
          borderColor="separator"
          accessible={true}
          accessibilityLabel={counterAccessibilityLabel({ current, total })}
        >
          <Text variant="body-md" color="textPrimary" fontWeight="bold">
            {current} / {total}
          </Text>
        </Box>
      </SafeAreaView>
    );
  };

  return (
    <ImageViewing
      images={normalizedImages}
      imageIndex={initialIndex}
      visible={visible}
      onRequestClose={onClose}
      swipeToCloseEnabled={true}
      doubleTapToZoomEnabled={true}
      animationType="fade"
      presentationStyle="overFullScreen"
      backgroundColor="#000000"
      HeaderComponent={renderHeader}
      FooterComponent={renderFooter}
    />
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 10,
  },
  closeButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    margin: 16,
  },
  footerContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
    zIndex: 10,
  },
});

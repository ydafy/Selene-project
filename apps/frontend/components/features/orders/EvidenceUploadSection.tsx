import React, { useState } from 'react';
import {
  TouchableOpacity,
  ActivityIndicator,
  ImageSourcePropType,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import * as Haptics from 'expo-haptics';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useImageUpload } from '../../../core/hooks/useImageUpload';
import { Theme } from '../../../core/theme';

type AllowedBuckets = 'evidence' | 'Avatars';

interface SlotConfig {
  label: string;
  icon: string;
  /** Optional translated intro shown in a dialog before the camera opens. */
  description?: string;
  /** Optional 5:3 illustration rendered inside that dialog. */
  image?: ImageSourcePropType;
}

interface Props {
  orderId: string;
  userId: string;
  maxPhotos?: number;
  slotsConfig?: SlotConfig[];
  onEvidenceComplete: (urls: string[]) => void;
  bucket?: AllowedBuckets;
  folder?: string;
  /** Translated confirm button text for the per-slot intro dialog. */
  captureLabel?: string;
  /** Already-translated suffixes appended to a slot's accessibility label. */
  photoStateLabels?: { added: string; empty: string };
}

export const EvidenceUploadSection = ({
  orderId,
  userId,
  maxPhotos = 3,
  slotsConfig,
  onEvidenceComplete,
  bucket = 'evidence',
  folder = 'shipments',
  captureLabel,
  photoStateLabels,
}: Props) => {
  const theme = useTheme<Theme>();
  const { takePhoto, uploadFile, uploading } = useImageUpload();

  // Inicializamos el array según maxPhotos
  const [photos, setPhotos] = useState<(string | null)[]>(
    new Array(maxPhotos).fill(null),
  );

  // Index of the slot whose intro dialog is open, or null when none.
  const [slotDialogIndex, setSlotDialogIndex] = useState<number | null>(null);

  const capture = async (index: number) => {
    const result = await takePhoto({ allowsEditing: false, quality: 0.8 });
    if (!result) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const path = `${folder}/${orderId}/${userId}/slot_${index}_${Date.now()}.jpg`;
      const url = await uploadFile(bucket, path, result.base64!, 'jpg');

      const newPhotos = [...photos];
      newPhotos[index] = url;
      setPhotos(newPhotos);

      // Filtramos nulos para enviar solo las URLs válidas al padre
      const validPhotos = newPhotos.filter((p): p is string => p !== null);
      onEvidenceComplete(validPhotos);
    } catch (error) {
      console.error('Upload failed', error);
    }
  };

  const handlePickImage = async (index: number) => {
    const slot = slotsConfig?.[index];
    // Slots with an intro description always show the dialog first; the
    // camera opens only after confirmation (every tap, not just the first).
    if (slot?.description) {
      setSlotDialogIndex(index);
      return;
    }
    await capture(index);
  };

  const activeSlot =
    slotDialogIndex !== null ? slotsConfig?.[slotDialogIndex] : undefined;

  return (
    <>
      <Box gap="s" flexDirection="row" marginBottom="m">
        {photos.map((photo, index) => (
          <Box key={index} flex={1} alignItems="center">
            <TouchableOpacity
              onPress={() => handlePickImage(index)}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={
                slotsConfig?.[index]
                  ? [
                      slotsConfig[index].label,
                      photo ? photoStateLabels?.added : photoStateLabels?.empty,
                    ]
                      .filter(Boolean)
                      .join('. ')
                  : undefined
              }
              accessibilityState={{ selected: Boolean(photo) }}
              style={{
                width: '100%',
                aspectRatio: 1,
                borderRadius: theme.borderRadii.m,
                backgroundColor: theme.colors.cardBackground,
                borderWidth: 1,
                borderColor: photo
                  ? theme.colors.success
                  : theme.colors.separator,
                borderStyle: photo ? 'solid' : 'dashed',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
              }}
            >
              {photo ? (
                <AppImage
                  source={{ uri: photo }}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : (
                <Box alignItems="center">
                  <MaterialCommunityIcons
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    name={(slotsConfig?.[index]?.icon || 'camera') as any}
                    size={24}
                    color={theme.colors.textSecondary}
                  />
                  {uploading && (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.primary}
                      style={{ marginTop: 8 }}
                    />
                  )}
                </Box>
              )}
            </TouchableOpacity>
            {slotsConfig?.[index] && (
              <Text
                variant="caption-md"
                marginTop="s"
                color="textSecondary"
                textAlign="center"
              >
                {slotsConfig[index].label}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {activeSlot && (
        <ConfirmDialog
          visible={slotDialogIndex !== null}
          title={activeSlot.label}
          description={activeSlot.description}
          onConfirm={() => {
            const index = slotDialogIndex;
            setSlotDialogIndex(null);
            if (index !== null) {
              capture(index);
            }
          }}
          onCancel={() => setSlotDialogIndex(null)}
          confirmLabel={captureLabel}
          icon="camera"
        >
          {activeSlot.image && (
            // Bounded 5:3 stage (~183x110 pt): the illustration is centred
            // and `contain` never crops a transparent source.
            <Box
              width="100%"
              height={180}
              marginTop="s"
              justifyContent="center"
              alignItems="center"
            >
              <AppImage
                source={activeSlot.image}
                contentFit="contain"
                style={{ height: '100%', aspectRatio: 5 / 3 }}
              />
            </Box>
          )}
        </ConfirmDialog>
      )}
    </>
  );
};

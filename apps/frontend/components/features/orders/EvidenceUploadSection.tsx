import React, { useEffect, useRef, useState } from 'react';
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
  disabled?: boolean;
  /** Synchronous preparing-screen exclusion before disabled props rerender. */
  canCapture?: () => boolean;
  onBusyChange?: (busy: boolean) => void;
  onFailure?: () => void;
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
  disabled = false,
  canCapture,
  onBusyChange,
  onFailure,
}: Props) => {
  const theme = useTheme<Theme>();
  const { takePhoto, uploadFile, uploading } = useImageUpload();

  // Inicializamos el array según maxPhotos
  const [photos, setPhotos] = useState<(string | null)[]>(
    new Array(maxPhotos).fill(null),
  );

  // Index of the slot whose intro dialog is open, or null when none.
  const [slotDialogIndex, setSlotDialogIndex] = useState<number | null>(null);

  const mounted = useRef(true);
  const busyRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const canCaptureRef = useRef(canCapture);
  canCaptureRef.current = canCapture;
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (disabled) setSlotDialogIndex(null); }, [disabled]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const capture = async (index: number) => {
    if (!mounted.current || disabledRef.current || busyRef.current || uploading) return;
    if (canCaptureRef.current?.() === false) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await takePhoto({ allowsEditing: false, quality: 0.8 });
      if (!result || !mounted.current || disabledRef.current) return;

      const path = `${folder}/${orderId}/${userId}/slot_${index}_${Date.now()}.jpg`;
      const url = await uploadFile(bucket, path, result.base64!, 'jpg');
      if (!mounted.current || disabledRef.current) return;

      const newPhotos = [...photos];
      newPhotos[index] = url;
      setPhotos(newPhotos);
      onEvidenceComplete(newPhotos.filter((p): p is string => p !== null));
      // Feedback cannot turn a saved upload into a failed capture.
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch { /* Optional feedback only. */ }
    } catch {
      console.warn('[EVIDENCE_UPLOAD]', { event: 'capture_or_upload_failed' });
      if (mounted.current) onFailure?.();
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  };

  const handlePickImage = async (index: number) => {
    if (!mounted.current || disabledRef.current || busyRef.current || uploading) return;
    if (canCaptureRef.current?.() === false) return;
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
              disabled={disabled || busy || uploading}
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
              accessibilityState={{ selected: Boolean(photo), disabled: disabled || busy || uploading, busy: busy || uploading }}
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

      {activeSlot && !disabled && !busy && (
        <ConfirmDialog
          visible={slotDialogIndex !== null}
          title={activeSlot.label}
          description={activeSlot.description}
          onConfirm={() => {
            if (!mounted.current || disabledRef.current || busyRef.current || uploading) return;
            if (canCaptureRef.current?.() === false) return;
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

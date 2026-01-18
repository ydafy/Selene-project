import React from 'react';
import { Alert, ActionSheetIOS, Platform, ScrollView } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { WizardSteps } from '../../components/features/sell/WizardSteps';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { ImageGridPicker } from '../../components/features/sell/ImageGridPicker';
import { useSellStore } from '../../core/store/useSellStore';
import { useProductImages } from '../../core/hooks/useProductImages';

const MAX_IMAGES = 5;

export default function SellImagesScreen() {
  const { t } = useTranslation(['sell', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Store
  const { draft, updateDraft } = useSellStore();
  const images = draft.images || [];

  // Hook de Imágenes
  const { pickImages, takePhoto, loading } = useProductImages();

  // Manejo de Agregar Fotos
  const handleAddPhotos = () => {
    const options = [
      t('fields.takePhoto'),
      t('fields.addPhotos'),
      t('common:actions.cancel'),
    ];
    const cancelButtonIndex = 2;

    const handleSelection = async (index: number) => {
      if (index === 0) {
        // Cámara
        const uri = await takePhoto();
        if (uri) {
          updateDraft({ images: [...images, uri] });
        }
      } else if (index === 1) {
        // Galería (Múltiple)
        const remainingSlots = MAX_IMAGES - images.length;
        const newUris = await pickImages(remainingSlots);
        if (newUris.length > 0) {
          const updated = [...images, ...newUris].slice(0, MAX_IMAGES);
          updateDraft({ images: updated });
        }
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex },
        handleSelection,
      );
    } else {
      Alert.alert(
        t('fields.imagesTitle'),
        undefined,
        [
          { text: t('fields.takePhoto'), onPress: () => handleSelection(0) },
          { text: t('fields.addPhotos'), onPress: () => handleSelection(1) },
          { text: t('common:actions.cancel'), style: 'cancel' },
        ],
        { cancelable: true },
      );
    }
  };

  const handleRemovePhoto = (index: number) => {
    const updated = images.filter((_, i) => i !== index);
    updateDraft({ images: updated });
  };

  const onNext = () => {
    if (images.length === 0) return;
    router.push('/sell/preview');
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        title={t('sell:steps.details')}
        showBack={true}
        backgroundColor="cardBackground"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 100,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 16,
        }}
      >
        {/* Header de la Pantalla */}
        <ScreenHeader
          title={t('sell:fields.imagesTitle')}
          subtitle={t('sell:fields.imagesSubtitle')}
        />

        {/* Línea de Progreso (Paso 2) */}
        <WizardSteps currentStep={2} />

        {/* Tarjeta Contenedora */}
        <Box
          backgroundColor="cardBackground"
          borderRadius="l"
          padding="m"
          marginTop="m"
          shadowColor="focus"
          shadowOpacity={0.3}
          shadowOffset={{ width: 0, height: 4 }}
          shadowRadius={8}
          elevation={5}
        >
          <ImageGridPicker
            images={images}
            onAdd={handleAddPhotos}
            onRemove={handleRemovePhoto}
          />

          {/* Mensaje de error visual si está vacío */}
          {images.length === 0 && (
            <Box
              marginTop="l"
              padding="m"
              backgroundColor="background"
              borderRadius="m"
            >
              <Text variant="body-sm" color="textSecondary" textAlign="center">
                {t('sell:errors.minImages')}
              </Text>
            </Box>
          )}
        </Box>

        <Box height={30} />

        <PrimaryButton
          onPress={onNext}
          disabled={images.length === 0 || loading}
          loading={loading}
        >
          {t('sell:fields.next')}
        </PrimaryButton>
      </ScrollView>
    </Box>
  );
}

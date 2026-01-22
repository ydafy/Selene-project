import React, { useState } from 'react';
import {
  ScrollView,
  Image,
  Keyboard,
  TouchableWithoutFeedback,
  TouchableOpacity,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ImageViewing from 'react-native-image-viewing';

import { Box, Text } from '../../../components/base';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../../components/layout/GlobalHeader';
import { ProductImageGallery } from '../../../components/features/product/ProductImageGallery';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Theme } from '../../../core/theme';
import { useAdminReviewLogic } from '../../../core/hooks/useAdminReviewLogic';
import { FormTextInput } from '../../../components/ui/FormTextInput';

export default function ReviewProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();

  const {
    product,
    proofUrls,
    loading,
    processing,
    viewerImages,
    executeVerdict,
  } = useAdminReviewLogic(id);

  // Estados puramente de UI (Modales, Visores)
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogMode, setDialogMode] = useState<'REJECT' | 'APPROVE_NOTE'>(
    'REJECT',
  );
  const [adminNote, setAdminNote] = useState('');

  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Handlers UI
  const openImage = (uri: string) => {
    const index = viewerImages.findIndex((img) => img.uri === uri);
    if (index >= 0) {
      setCurrentImageIndex(index);
      setIsViewerVisible(true);
    }
  };

  const openRejectDialog = () => {
    setDialogMode('REJECT');
    setAdminNote('');
    setDialogVisible(true);
  };

  const openApproveNoteDialog = () => {
    setDialogMode('APPROVE_NOTE');
    setAdminNote('');
    setDialogVisible(true);
  };

  if (loading || !product)
    return (
      <Box
        flex={1}
        backgroundColor="background"
        justifyContent="center"
        alignItems="center"
      >
        <Text>Cargando...</Text>
      </Box>
    );

  const vData = product.verification_data;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        title="Revisión Técnica"
        showBack={true}
        backgroundColor="cardBackground"
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 150 }}>
        {/* SECCIÓN 1: PÚBLICO */}
        <Box padding="m">
          <Text variant="subheader-md" color="textSecondary" marginBottom="s">
            LA PROMESA (Público)
          </Text>
          <Box
            backgroundColor="cardBackground"
            borderRadius="m"
            overflow="hidden"
          >
            <ProductImageGallery
              images={product.images}
              productId={product.id}
            />
            <Box padding="m">
              <Text variant="header-xl">{product.name}</Text>
              <Text variant="header-xl" color="primary">
                ${product.price}
              </Text>
              <Text variant="body-sm" marginTop="s">
                {product.description}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* SECCIÓN 2: EVIDENCIA */}
        <Box padding="m" paddingTop="xs">
          <Text variant="subheader-md" color="primary" marginBottom="s">
            LA EVIDENCIA (Privado)
          </Text>
          <Box
            backgroundColor="cardBackground"
            borderRadius="m"
            padding="m"
            gap="l"
          >
            {/* Física */}
            <Box>
              <Box flexDirection="row" alignItems="center" marginBottom="s">
                <MaterialCommunityIcons
                  name="file-document-edit-outline"
                  size={20}
                  color="white"
                />
                <Text variant="body-md" fontWeight="bold" marginLeft="s">
                  Prueba de Vida
                </Text>
              </Box>
              {proofUrls.physical ? (
                <TouchableOpacity
                  onPress={() => openImage(proofUrls.physical!)}
                  activeOpacity={0.9}
                >
                  <Image
                    source={{ uri: proofUrls.physical }}
                    style={{ width: '100%', height: 300, borderRadius: 8 }}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              ) : (
                <Text color="error">No hay foto física</Text>
              )}
            </Box>

            {/* Benchmark */}
            {proofUrls.performance && (
              <Box>
                <Box flexDirection="row" alignItems="center" marginBottom="s">
                  <MaterialCommunityIcons
                    name="rocket-launch-outline"
                    size={20}
                    color="white"
                  />
                  <Text variant="body-md" fontWeight="bold" marginLeft="s">
                    Benchmark
                  </Text>
                </Box>
                <TouchableOpacity
                  onPress={() => openImage(proofUrls.performance!)}
                  activeOpacity={0.9}
                >
                  <Image
                    source={{ uri: proofUrls.performance }}
                    style={{ width: '100%', height: 300, borderRadius: 8 }}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
                {vData?.benchmark_score && (
                  <Text
                    variant="header-xl"
                    color="primary"
                    textAlign="center"
                    marginTop="s"
                  >
                    Score: {vData.benchmark_score}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        </Box>
      </ScrollView>

      {/* FOOTER DE ACCIÓN */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="m"
        paddingBottom="xl"
        backgroundColor="cardBackground"
        style={{ borderTopWidth: 1, borderTopColor: '#333' }}
      >
        <Box flexDirection="row" gap="s" marginBottom="s">
          <PrimaryButton
            onPress={openRejectDialog}
            disabled={processing}
            style={{ flex: 1, backgroundColor: theme.colors.error }}
            icon="close-circle-outline"
          >
            Rechazar
          </PrimaryButton>

          <PrimaryButton
            onPress={() => executeVerdict('APPROVE')}
            disabled={processing}
            loading={processing}
            style={{ flex: 1, backgroundColor: theme.colors.success }}
            icon="check-circle-outline"
          >
            Aprobar
          </PrimaryButton>
        </Box>

        <PrimaryButton
          onPress={openApproveNoteDialog}
          disabled={processing}
          variant="outline"
          style={{ borderColor: theme.colors.primary }}
          labelStyle={{ color: theme.colors.primary }}
          icon="message-draw"
        >
          Aprobar con Nota
        </PrimaryButton>
      </Box>

      {/* DIÁLOGO UNIFICADO */}
      <ConfirmDialog
        visible={dialogVisible}
        title={
          dialogMode === 'REJECT' ? 'Rechazar Producto' : 'Aprobar con Nota'
        }
        description={
          dialogMode === 'REJECT'
            ? 'Explica por qué se rechaza para que el usuario corrija.'
            : 'El producto será aprobado, pero el usuario recibirá este mensaje.'
        }
        onConfirm={() => executeVerdict(dialogMode, adminNote)}
        onCancel={() => setDialogVisible(false)}
        confirmLabel={
          dialogMode === 'REJECT' ? 'Confirmar Rechazo' : 'Confirmar Aprobación'
        }
        isDangerous={dialogMode === 'REJECT'}
        icon={
          dialogMode === 'REJECT'
            ? 'alert-circle-outline'
            : 'information-outline'
        }
        dismissable={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <Box marginTop="m">
            <FormTextInput
              label={dialogMode === 'REJECT' ? 'Motivo' : 'Nota / Observación'}
              labelMode="static" // Usamos el estilo "Selene" con título afuera
              placeholder="Escribe aquí..."
              value={adminNote}
              onChangeText={setAdminNote}
              // --- EL TRUCO PARA EL TECLADO ---
              multiline={true} // Permite que el texto baje visualmente
              blurOnSubmit={true} // <--- CLAVE: Enter cierra el teclado
              returnKeyType="done" // Muestra "Listo" o "Check" en el teclado
              // --- ESTILOS PARA QUE SE VEA GRANDE ---
              style={{
                height: 120, // Altura fija grande
                textAlignVertical: 'top', // Texto empieza arriba
                backgroundColor: theme.colors.cardBackground, // O transparent si prefieres
              }}
              // Ajuste de padding interno si usas el modo static
              contentStyle={{ paddingTop: 12, paddingBottom: 12 }}
            />
          </Box>
        </TouchableWithoutFeedback>
      </ConfirmDialog>

      {/* Visor de Imágenes */}
      <ImageViewing
        images={viewerImages}
        imageIndex={currentImageIndex}
        visible={isViewerVisible}
        onRequestClose={() => setIsViewerVisible(false)}
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        animationType="fade"
        backgroundColor="#000000"
        HeaderComponent={() => (
          <Box position="absolute" top={50} right={20} zIndex={1}>
            <TouchableOpacity
              onPress={() => setIsViewerVisible(false)}
              style={{
                backgroundColor: 'rgba(0,0,0,0.5)',
                padding: 8,
                borderRadius: 20,
              }}
            >
              <MaterialCommunityIcons name="close" size={24} color="white" />
            </TouchableOpacity>
          </Box>
        )}
      />
    </Box>
  );
}

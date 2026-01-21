import React, { useEffect, useState, useMemo } from 'react';
import {
  ScrollView,
  Alert,
  Image,
  Keyboard,
  TouchableWithoutFeedback,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput as PaperInput } from 'react-native-paper';

import ImageViewing from 'react-native-image-viewing';

import { Box, Text } from '../../../components/base';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../../components/layout/GlobalHeader';
import { ProductImageGallery } from '../../../components/features/product/ProductImageGallery';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { supabase } from '../../../core/db/supabase';
import { Theme } from '../../../core/theme';
import { Product } from '@selene/types';

export default function ReviewProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  const router = useRouter();

  // Estado de Datos
  const [product, setProduct] = useState<Product | null>(null);
  const [proofUrls, setProofUrls] = useState<{
    physical?: string;
    performance?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Estado para el Diálogo de Notas (Rechazo o Aprobación con nota)
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogMode, setDialogMode] = useState<'REJECT' | 'APPROVE_NOTE'>(
    'REJECT',
  );
  const [adminNote, setAdminNote] = useState('');

  // Estado Visor de Imágenes
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // 1. CARGAR DATOS
  useEffect(() => {
    const loadData = async () => {
      if (!id) return;
      // Necesitamos el seller_id para enviarle la notificación, asegúrate de traerlo
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        Alert.alert('Error', 'No se pudo cargar');
        return;
      }
      setProduct(data as Product);

      const vData = data.verification_data;
      if (vData) {
        const urls: { physical?: string; performance?: string } = {};
        if (vData.proof_physical) {
          const { data: signed } = await supabase.storage
            .from('verification')
            .createSignedUrl(vData.proof_physical, 3600);
          if (signed) urls.physical = signed.signedUrl;
        }
        if (vData.proof_performance) {
          const { data: signed } = await supabase.storage
            .from('verification')
            .createSignedUrl(vData.proof_performance, 3600);
          if (signed) urls.performance = signed.signedUrl;
        }
        setProofUrls(urls);
      }
      setLoading(false);
    };
    loadData();
  }, [id]);

  // Preparar imágenes para visor
  const viewerImages = useMemo(() => {
    const imgs = [];
    if (proofUrls.physical) imgs.push({ uri: proofUrls.physical });
    if (proofUrls.performance) imgs.push({ uri: proofUrls.performance });
    return imgs;
  }, [proofUrls]);

  const openImage = (uri: string) => {
    const index = viewerImages.findIndex((img) => img.uri === uri);
    if (index >= 0) {
      setCurrentImageIndex(index);
      setIsViewerVisible(true);
    }
  };

  // 2. LÓGICA CENTRAL DE VEREDICTO + NOTIFICACIÓN
  const executeVerdict = async (
    verdict: 'APPROVE' | 'REJECT' | 'APPROVE_NOTE',
    note?: string,
  ) => {
    if (!product) return;

    setProcessing(true);
    try {
      const isRejection = verdict === 'REJECT';
      const isApproval = verdict === 'APPROVE' || verdict === 'APPROVE_NOTE';

      // A. Actualizar Producto
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: any = {
        status: isRejection ? 'REJECTED' : 'VERIFIED',
        rejection_reason: isRejection ? note : null, // Guardamos razón si es rechazo
      };

      const { error: prodError } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id);
      if (prodError) throw prodError;

      // B. Crear Notificación (El Feedback Loop)
      let notifTitle = '';
      let notifMessage = '';
      let notifType = 'info';

      if (verdict === 'REJECT') {
        notifTitle = 'Publicación Rechazada';
        notifMessage = `Tu producto "${product.name}" no pasó la verificación: ${note}`;
        notifType = 'error';
      } else if (verdict === 'APPROVE_NOTE') {
        notifTitle = 'Publicación Aprobada con Observaciones';
        notifMessage = `Tu producto "${product.name}" fue verificado. Nota de Selene: ${note}`;
        notifType = 'warning'; // Amarillo para llamar la atención
      } else {
        // APPROVE Simple
        notifTitle = '¡Publicación Verificada!';
        notifMessage = `Tu producto "${product.name}" ha sido aprobado y ya está visible para compradores.`;
        notifType = 'success';
      }

      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          user_id: product.seller_id, // El dueño del producto
          title: notifTitle,
          message: notifMessage,
          type: notifType,
          read: false,
          action_path: `/profile`, // Al tocar, ir al perfil (o al producto)
        });

      if (notifError) {
        console.error('Error creando notificación:', notifError);
        // No detenemos el flujo, el producto ya se actualizó
      }

      setDialogVisible(false);

      Alert.alert(
        isApproval ? '¡Aprobado!' : 'Rechazado',
        'Se ha actualizado el estado y notificado al usuario.',
        [{ text: 'Volver al Dashboard', onPress: () => router.back() }],
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo actualizar.');
    } finally {
      setProcessing(false);
    }
  };

  // Handlers para abrir el diálogo
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
      <Box flex={1} backgroundColor="background">
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
        <Box padding="m" paddingTop="xl">
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

      {/* FOOTER DE ACCIÓN (3 BOTONES) */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="m"
        paddingBottom="l"
        backgroundColor="cardBackground"
        style={{ borderTopWidth: 1, borderTopColor: '#333' }}
      >
        <Box flexDirection="row" gap="s" marginBottom="s">
          {/* Botón Rechazar */}
          <PrimaryButton
            onPress={openRejectDialog}
            disabled={processing}
            style={{ flex: 1, backgroundColor: theme.colors.error }}
            icon="close-circle-outline"
          >
            Rechazar
          </PrimaryButton>

          {/* Botón Aprobar Simple */}
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

        {/* Botón Aprobar con Nota (Ancho completo abajo) */}
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

      {/* DIÁLOGO UNIFICADO (Sirve para Rechazo y Nota) */}
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
            <PaperInput
              mode="outlined"
              label={dialogMode === 'REJECT' ? 'Motivo' : 'Nota / Observación'}
              placeholder="Escribe aquí..."
              value={adminNote}
              onChangeText={setAdminNote}
              numberOfLines={3}
              textColor={theme.colors.textPrimary}
              style={{ backgroundColor: theme.colors.background }}
              theme={{
                colors: {
                  primary:
                    dialogMode === 'REJECT'
                      ? theme.colors.error
                      : theme.colors.primary,
                  outline: theme.colors.textSecondary,
                },
              }}
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

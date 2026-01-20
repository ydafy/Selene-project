import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from 'react';
import {
  ScrollView,
  Alert,
  Image,
  Keyboard,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ImageViewing from 'react-native-image-viewing';

import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';

import { Box, Text } from '../../../components/base';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../../components/layout/GlobalHeader';
import { ProductImageGallery } from '../../../components/features/product/ProductImageGallery';
import { supabase } from '../../../core/db/supabase';
import { Theme } from '../../../core/theme';
import { Product } from '@selene/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput as PaperInput } from 'react-native-paper';

export default function ReviewProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const rejectSheetRef = useRef<BottomSheetModal>(null); // <--- 2. REF DEL SHEET
  const snapPoints = useMemo(() => ['90%'], []); // Altura cómoda para escribir

  const [product, setProduct] = useState<Product | null>(null);
  const [proofUrls, setProofUrls] = useState<{
    physical?: string;
    performance?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const [rejectReason, setRejectReason] = useState('');

  const viewerImages = useMemo(() => {
    const imgs = [];
    if (proofUrls.physical) imgs.push({ uri: proofUrls.physical });
    if (proofUrls.performance) imgs.push({ uri: proofUrls.performance });
    return imgs;
  }, [proofUrls]);

  // Función para abrir la foto correcta
  const openImage = (uri: string) => {
    const index = viewerImages.findIndex((img) => img.uri === uri);
    if (index >= 0) {
      setCurrentImageIndex(index);
      setIsViewerVisible(true);
    }
  };

  // 1. CARGAR DATOS Y GENERAR URLS FIRMADAS
  useEffect(() => {
    const loadData = async () => {
      if (!id) return;

      // A. Obtener producto
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        Alert.alert('Error', 'No se pudo cargar el producto');
        return;
      }

      setProduct(data as Product);

      // B. Generar URLs firmadas para las pruebas (Bucket Privado)
      const vData = data.verification_data;
      if (vData) {
        const urls: { physical?: string; performance?: string } = {};

        // Foto Física
        if (vData.proof_physical) {
          const { data: signed } = await supabase.storage
            .from('verification')
            .createSignedUrl(vData.proof_physical, 3600); // Valido por 1 hora
          if (signed) urls.physical = signed.signedUrl;
        }

        // Foto Benchmark
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

  // 2. LÓGICA DE APROBACIÓN
  const handleVerdict = async (verdict: 'APPROVE' | 'REJECT') => {
    // Validación
    if (verdict === 'REJECT' && !rejectReason.trim()) {
      Alert.alert('Error', 'Debes escribir un motivo para rechazar.');
      return;
    }

    setProcessing(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: any = {
        status: verdict === 'APPROVE' ? 'VERIFIED' : 'REJECTED',
        rejection_reason: verdict === 'REJECT' ? rejectReason : null,
      };

      const { error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      // Cerramos el Sheet si estaba abierto
      rejectSheetRef.current?.dismiss();

      Alert.alert(
        verdict === 'APPROVE' ? '¡Aprobado!' : 'Rechazado',
        verdict === 'APPROVE'
          ? 'Producto visible.'
          : 'Se ha notificado al usuario.',
        [{ text: 'Volver', onPress: () => router.back() }],
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo actualizar.');
    } finally {
      setProcessing(false);
    }
  };

  const renderBackdrop = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="close"
        onPress={() => {
          Keyboard.dismiss();
          rejectSheetRef.current?.dismiss();
        }}
      />
    ),
    [],
  );

  if (loading || !product) {
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
  }

  const vData = product.verification_data;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        title="Revisión Técnica"
        showBack={true}
        backgroundColor="cardBackground"
      />

      <ScrollView
        contentContainerStyle={{
          paddingBottom: 150,
          paddingTop: insets.top + 80,
        }}
      >
        {/* --- SECCIÓN 1: LO PÚBLICO (Contexto) --- */}
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

        {/* --- SECCIÓN 2: LA EVIDENCIA (Privado) --- */}
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
            {/* Evidencia 1: Física */}
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
                // CAMBIO: Envolvemos en TouchableOpacity
                <TouchableOpacity
                  onPress={() => openImage(proofUrls.physical!)}
                  activeOpacity={0.9}
                >
                  <Image
                    source={{ uri: proofUrls.physical }}
                    style={{ width: '100%', height: 350, borderRadius: 8 }}
                    resizeMode="contain"
                  />
                  {/* Indicador visual de zoom (Opcional pero recomendado) */}
                  <Box
                    position="absolute"
                    bottom={10}
                    right={10}
                    backgroundColor="separator"
                    borderRadius="full"
                    padding="xs"
                  >
                    <MaterialCommunityIcons
                      name="magnify-plus-outline"
                      size={20}
                      color="white"
                    />
                  </Box>
                </TouchableOpacity>
              ) : (
                <Text color="error">No hay foto física</Text>
              )}
            </Box>

            {/* Evidencia 2: Benchmark (Si existe) */}
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

                {/* CAMBIO: Envolvemos en TouchableOpacity */}
                <TouchableOpacity
                  onPress={() => openImage(proofUrls.performance!)}
                  activeOpacity={0.9}
                >
                  <Image
                    source={{ uri: proofUrls.performance }}
                    style={{ width: '100%', height: 350, borderRadius: 8 }}
                    resizeMode="contain"
                  />
                  <Box
                    position="absolute"
                    bottom={10}
                    right={10}
                    backgroundColor="separator"
                    borderRadius="full"
                    padding="xs"
                  >
                    <MaterialCommunityIcons
                      name="magnify-plus-outline"
                      size={20}
                      color="white"
                    />
                  </Box>
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

      {/* --- FOOTER DE ACCIÓN --- */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="m"
        paddingBottom="xl"
        backgroundColor="cardBackground"
        flexDirection="row"
        gap="m"
        style={{ borderTopWidth: 1, borderTopColor: '#333' }}
      >
        <PrimaryButton
          onPress={() => rejectSheetRef.current?.present()} // <--- ABRE EL SHEET
          disabled={processing}
          style={{ flex: 1, backgroundColor: theme.colors.error }}
          icon="close-circle-outline"
        >
          Rechazar
        </PrimaryButton>

        <PrimaryButton
          onPress={() => handleVerdict('APPROVE')}
          disabled={processing}
          loading={processing}
          style={{ flex: 1, backgroundColor: theme.colors.success }}
          icon="check-circle-outline"
        >
          Aprobar
        </PrimaryButton>
      </Box>

      <ImageViewing
        images={viewerImages}
        imageIndex={currentImageIndex}
        visible={isViewerVisible}
        onRequestClose={() => setIsViewerVisible(false)}
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        animationType="fade"
        backgroundColor="#000000" // Fondo negro para máximo contraste
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

      {/* 3. EL NUEVO BOTTOM SHEET DE RECHAZO */}
      <BottomSheetModal
        ref={rejectSheetRef}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
        //keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetView style={{ flex: 1, padding: 20 }}>
          <Text variant="header-xl" marginBottom="xl">
            Motivo del Rechazo
          </Text>
          <Text variant="body-md" color="textSecondary" marginBottom="m">
            Explica claramente por qué se rechaza para que el usuario pueda
            corregirlo.
          </Text>

          <PaperInput
            mode="outlined"
            label="Escribe aquí..."
            value={rejectReason}
            onChangeText={setRejectReason}
            multiline
            numberOfLines={4}
            textColor={theme.colors.textPrimary}
            style={{
              backgroundColor: theme.colors.background,
              marginBottom: 90,
            }}
            theme={{
              colors: {
                primary: theme.colors.error,
                outline: theme.colors.textSecondary,
              },
            }}
            autoFocus
          />

          <PrimaryButton
            onPress={() => handleVerdict('REJECT')}
            disabled={!rejectReason.trim() || processing}
            style={{ backgroundColor: theme.colors.error }}
            loading={processing}
          >
            Confirmar Rechazo
          </PrimaryButton>
        </BottomSheetView>
      </BottomSheetModal>
    </Box>
  );
}

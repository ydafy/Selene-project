import React, { useEffect, useState } from 'react';
import { ScrollView, Alert, Image } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../../../components/base';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../../components/layout/GlobalHeader';
import { ProductImageGallery } from '../../../components/features/product/ProductImageGallery';
import { supabase } from '../../../core/db/supabase';
import { Theme } from '../../../core/theme';
import { Product } from '@selene/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { TextInput as PaperInput } from 'react-native-paper';

export default function ReviewProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [product, setProduct] = useState<Product | null>(null);
  const [proofUrls, setProofUrls] = useState<{
    physical?: string;
    performance?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rejectDialogVisible, setRejectDialogVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

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
    // Validación: Si es rechazo, debe tener motivo
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

      setRejectDialogVisible(false);

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
                <Image
                  source={{ uri: proofUrls.physical }}
                  style={{ width: '100%', height: 350, borderRadius: 8 }}
                  resizeMode="contain"
                />
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
                <Image
                  source={{ uri: proofUrls.performance }}
                  style={{ width: '100%', height: 350, borderRadius: 8 }}
                  resizeMode="contain"
                />
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
          onPress={() => setRejectDialogVisible(true)}
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
      <ConfirmDialog
        visible={rejectDialogVisible}
        title="Rechazar Producto"
        description="Escribe la razón para que el usuario pueda corregirlo."
        onConfirm={() => handleVerdict('REJECT')}
        onCancel={() => setRejectDialogVisible(false)}
        confirmLabel="Confirmar Rechazo"
        isDangerous={true}
        icon="alert-circle-outline"
      >
        {/* Children: El Input va aquí adentro */}
        <Box marginTop="m">
          <PaperInput
            mode="outlined"
            label="Motivo"
            placeholder="Ej. La foto del papelito no es legible"
            value={rejectReason}
            onChangeText={setRejectReason}
            multiline
            numberOfLines={3}
            textColor={theme.colors.textPrimary}
            style={{ backgroundColor: theme.colors.background }}
            theme={{
              colors: {
                primary: theme.colors.error,
                outline: theme.colors.textSecondary,
              },
            }}
          />
        </Box>
      </ConfirmDialog>
    </Box>
  );
}

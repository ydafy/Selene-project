/**
 * @file apps/frontend/app/profile/orders/report/[id].tsx
 * @description Pantalla bivalente de resolución de conflictos.
 * Permite al comprador abrir una disputa inicial y al vendedor impugnar un retorno (contra-disputa).
 * Utiliza un Wizard de 3 pasos con validación técnica por categoría.
 */

import React, { useEffect, useMemo } from 'react';
import {
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { RadioButton } from 'react-native-paper';
import { ProductCategory } from '@selene/types';
import { useVideoUpload } from '@/core/hooks/useVideoUpload';

import { Box, Text } from '@/components/base';
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Checkbox } from '@/components/ui/Checkbox';
import { EvidenceUploadSection } from '@/components/features/orders/EvidenceUploadSection';
import { Theme } from '@/core/theme';

import { useDisputeStore, DisputeReason } from '@/core/store/useDisputeStore';
import {
  getChecklistForCategory,
  MIN_DESCRIPTION_LENGTH,
} from '@/core/constants/disputeChecklists';
import { useOrderById } from '@/core/hooks/useOrders';
import { useOrderActions } from '@/core/hooks/useOrderActions';
import { WizardSteps } from '@/components/features/sell/WizardSteps';
import { FormTextInput } from '@/components/ui/FormTextInput';
import { useAuthContext } from '@/components/auth/AuthProvider';

export default function ReportProblemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['disputes', 'common', 'orders']);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const {
    pickVideo,
    uploadVideo,
    uploading: uploadingVideo,
  } = useVideoUpload();

  // Data & Store
  const { data: order, isLoading } = useOrderById(id || '');
  const actions = useOrderActions(id || '');
  const store = useDisputeStore();

  const isSeller = session?.user.id === order?.items?.[0]?.seller_id;

  // Triage Logic
  // Obtenemos la categoría con fallback seguro
  const firstProduct = order?.items?.[0]?.product;
  const category = (firstProduct?.category as ProductCategory) || null;
  const questions = useMemo(
    () => getChecklistForCategory(category),
    [category],
  );

  // FIX: Reset solo al montar el componente
  useEffect(() => {
    store.reset();
  }, []);

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    store.setStep(store.currentStep + 1);
  };

  const handleBack = () => {
    store.setStep(store.currentStep - 1);
  };

  const screenTitle = isSeller
    ? t('disputes:titleSeller')
    : t('disputes:title');
  const screenSubtitle = isSeller ? 'Impugnar Retorno' : t('disputes:subtitle');

  const handleSubmit = async () => {
    if (!order) return;

    try {
      if (isSeller) {
        // EL VENDEDOR IMPUGNA (Contra-disputa)
        if (!order.dispute?.id)
          throw new Error(t('disputes:errors.noActiveDispute'));

        await actions.submitSellerReturnEvidence.execute({
          disputeId: order.dispute.id,
          images: store.images,
          videoUrl: store.videoUrl,
        });
      } else {
        if (!store.reason) throw new Error(t('disputes:reasons.required'));
        await actions.openDispute.execute({
          reason: store.reason,
          description: store.description,
          images: store.images,
          checklist: store.checklist,
          videoUrl: store.videoUrl,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      store.reset();
      router.replace(`/profile/orders/${id}`);
    } catch (error: unknown) {
      // FIX: Manejo de error sin 'any'
      const errorMessage =
        error instanceof Error ? error.message : t('common:errors.generic');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('common:states.errorTitle'), errorMessage);
    }
  };

  const isCurrentStepValid = store.isStepValid(
    store.currentStep,
    questions.length,
  );

  if (isLoading || !order) {
    return (
      <Box
        flex={1}
        backgroundColor="background"
        justifyContent="center"
        alignItems="center"
      >
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </Box>
    );
  }

  const handleUploadVideo = async () => {
    const asset = await pickVideo();
    if (!asset) return;

    try {
      // Usamos el ID del comprador para el folder si es disputa, o el del vendedor si es contra-disputa
      const folderUserId = isSeller ? session?.user.id : order.buyer_id;
      const url = await uploadVideo(order.id, folderUserId || '', asset.uri);

      store.setVideoUrl(url);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      //  Usamos el error para el log, ya no está huérfano
      console.error('[VIDEO_UPLOAD_ERROR]', error);
      Alert.alert(
        t('common:errors.errorTitle'),
        t('disputes:errors.videoUploadFailed'),
      );
    }
  };

  // --- RENDERS DE PASOS ---

  const renderTriage = () => (
    <Box>
      <Text variant="subheader-md" marginBottom="s">
        {t('disputes:triage.title')}
      </Text>
      <Text variant="caption-md" color="textSecondary" marginBottom="l">
        {t('disputes:triage.description')}
      </Text>

      <Box gap="m">
        {questions.map((q) => (
          <Checkbox
            key={q.id}
            status={store.checklist[q.id] ? 'checked' : 'unchecked'}
            onPress={() => store.toggleCheck(q.id)}
            label={
              <Text variant="body-md" color="textPrimary">
                {t(`disputes:${q.labelKey}`)}
              </Text>
            }
          />
        ))}
      </Box>

      <Box
        marginTop="xl"
        padding="m"
        backgroundColor="cardBackground"
        borderRadius="m"
        borderLeftWidth={2}
        borderLeftColor="primary"
      >
        <Text variant="caption-md" color="primary">
          {t('disputes:triage.footer')}
        </Text>
      </Box>
    </Box>
  );

  const renderDetails = () => {
    // Derivamos el estado de error para el componente
    const hasError =
      store.description.length > 0 &&
      store.description.length < MIN_DESCRIPTION_LENGTH;

    return (
      <Box gap="l">
        {/* SECCIÓN DE MOTIVOS (RADIO BUTTONS) */}
        <Box>
          <Text variant="subheader-md" marginBottom="m">
            {t('disputes:reasons.label')}
          </Text>
          <Box
            backgroundColor="cardBackground"
            borderRadius="m"
            overflow="hidden"
          >
            {(
              [
                'damaged',
                'not_working',
                'wrong_item',
                'incomplete',
                'other',
              ] as DisputeReason[]
            ).map((r) => (
              <RadioButton.Item
                key={r}
                label={t(`disputes:reasons.${r}`)}
                value={r}
                status={store.reason === r ? 'checked' : 'unchecked'}
                onPress={() => store.setReason(r)}
                color={theme.colors.primary}
                labelStyle={{
                  color: theme.colors.textPrimary,
                  fontFamily: 'Montserrat-Regular',
                  fontSize: 14,
                }}
              />
            ))}
          </Box>
        </Box>

        {/* SECCIÓN DE DESCRIPCIÓN CON FORMTEXTINPUT */}
        <Box>
          <FormTextInput
            labelMode="static"
            label={t('disputes:form.descriptionLabel')}
            helpTitle={t('disputes:form.descriptionHelpTitle')}
            helpDescription={t('disputes:form.descriptionHelpDesc')}
            placeholder={t('disputes:form.descriptionPlaceholder')}
            onChangeText={store.setDescription}
            value={store.description}
            error={hasError}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            style={{ height: 150, backgroundColor: 'transparent' }}
            contentStyle={{
              paddingTop: 0,
              paddingBottom: 0,
              marginTop: 8,
            }}
          />

          {/* Contador de caracteres dinámico */}
          <Box
            flexDirection="row"
            justifyContent="flex-end"
            marginTop="s"
            marginBottom={'l'}
          >
            <Text
              variant="caption-md"
              color={hasError ? 'error' : 'textSecondary'}
            >
              {store.description.length} / {MIN_DESCRIPTION_LENGTH}{' '}
              {t('disputes:form.minChars', { count: MIN_DESCRIPTION_LENGTH })}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  };

  const renderEvidence = () => (
    <Box gap="l">
      {/* SECCIÓN PRINCIPAL: VIDEO (OBLIGATORIO) */}
      <Box>
        <Text variant="subheader-md" marginBottom="xs">
          {t('disputes:evidence.videoTitle')}
        </Text>
        <Text variant="caption-md" color="textSecondary" marginBottom="m">
          {t('disputes:evidence.videoDesc')}
        </Text>

        <TouchableOpacity
          onPress={handleUploadVideo}
          disabled={uploadingVideo}
          style={{
            width: '100%',
            height: 160, // Más grande para destacar
            borderRadius: theme.borderRadii.m,
            backgroundColor: theme.colors.cardBackground,
            borderWidth: 2, // Borde más grueso
            borderColor: store.videoUrl
              ? theme.colors.success
              : theme.colors.primary,
            borderStyle: store.videoUrl ? 'solid' : 'dashed',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {uploadingVideo ? (
            <Box alignItems="center">
              <ActivityIndicator color={theme.colors.primary} size="large" />
              <Text variant="caption-md" marginTop="m">
                {t('disputes:evidence.uploadingVideo')}
              </Text>
            </Box>
          ) : store.videoUrl ? (
            <Box alignItems="center" gap="s">
              <MaterialCommunityIcons
                name="check-decagram"
                size={48}
                color={theme.colors.success}
              />
              <Text variant="body-md" color="success" fontWeight="bold">
                {t('disputes:evidence.videoReady')}
              </Text>
              <Text variant="caption-md" color="textSecondary">
                {t('disputes:evidence.changeVideo')}
              </Text>
            </Box>
          ) : (
            <Box alignItems="center">
              <MaterialCommunityIcons
                name="video-plus"
                size={48}
                color={theme.colors.primary}
              />
              <Text
                variant="body-md"
                color="primary"
                fontWeight="bold"
                marginTop="s"
              >
                {t('disputes:evidence.uploadBtn')}
              </Text>
              <Text variant="caption-md" color="textSecondary">
                {t('disputes:evidence.videoLimits')}
              </Text>
            </Box>
          )}
        </TouchableOpacity>
      </Box>

      {/* SECCIÓN SECUNDARIA: FOTOS (OPCIONAL) */}
      <Box>
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          marginBottom="s"
        >
          <Text variant="subheader-md">Fotos adicionales</Text>
          <Box
            backgroundColor="cardBackground"
            paddingHorizontal="s"
            borderRadius="s"
          >
            <Text variant="caption-md" color="textSecondary">
              {t('disputes:evidence.requiredPhoto')}
            </Text>
          </Box>
        </Box>

        <EvidenceUploadSection
          orderId={order.id}
          userId={order.buyer_id}
          maxPhotos={3}
          folder="disputes"
          bucket="evidence"
          slotsConfig={[
            {
              label: t('disputes:evidence.slots.defect'),
              icon: 'alert-circle-outline',
            },
            { label: t('disputes:evidence.slots.label'), icon: 'barcode-scan' },
            {
              label: t('disputes:evidence.slots.package'),
              icon: 'package-variant',
            },
          ]}
          onEvidenceComplete={(urls) => store.setImages(urls)}
        />
      </Box>
    </Box>
  );

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ title: screenTitle, headerShown: false }} />
      <GlobalHeader title={screenTitle} showBack />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: insets.top + 80,
            paddingBottom: insets.bottom + 50,
          }}
        >
          <ScreenHeader
            title={screenSubtitle}
            subtitle={`Orden #${order.id.slice(0, 8).toUpperCase()}`}
          />

          <Box marginVertical="l">
            <WizardSteps currentStep={store.currentStep} />
          </Box>

          {store.currentStep === 0 && renderTriage()}
          {store.currentStep === 1 && renderDetails()}
          {store.currentStep === 2 && renderEvidence()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* FOOTER DE NAVEGACIÓN */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="l"
        backgroundColor="background"
        borderTopWidth={1}
        borderTopColor="separator"
        paddingBottom={'l'}
        flexDirection="row"
        gap="m"
      >
        {store.currentStep > 0 && (
          <PrimaryButton
            variant="outline"
            onPress={handleBack}
            style={{ flex: 1 }}
            disabled={actions.openDispute.isLoading}
          >
            {t('disputes:actions.back')}
          </PrimaryButton>
        )}

        <PrimaryButton
          onPress={store.currentStep === 2 ? handleSubmit : handleNext}
          disabled={!isCurrentStepValid || actions.openDispute.isLoading}
          loading={actions.openDispute.isLoading}
          style={{ flex: 2 }}
          icon={store.currentStep === 2 ? 'shield-alert' : 'arrow-right'}
        >
          {store.currentStep === 2
            ? t('disputes:actions.submit')
            : t('disputes:actions.next')}
        </PrimaryButton>
      </Box>
    </Box>
  );
}

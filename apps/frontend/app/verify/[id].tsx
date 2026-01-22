import React, { useRef, useState } from 'react';
import { ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { VerificationMissionCard } from '../../components/features/verify/VerificationMissionCard';
import { BenchmarkGuideModal } from '../../components/features/verify/BenchmarkGuideModal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

import { useVerificationLogic } from '../../core/hooks/useVerificationLogic'; // <--- EL HOOK NUEVO
import { theme } from '@/core/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function VerifyProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation('verify');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Refs
  const scrollViewRef = useRef<ScrollView>(null);
  const guideModalRef = useRef<BottomSheetModal>(null);

  // Lógica extraída
  const {
    category,
    loadingCategory,
    physicalUri,
    performanceUri,
    score,
    setScore,
    isUploading,
    handleCamera,
    submitVerification,
    status,
    rejectionReason,
  } = useVerificationLogic(id);

  // Estado para Diálogos
  const [dialogConfig, setDialogConfig] = useState({
    visible: false,
    title: '',
    description: '',
    isError: false,
    onConfirm: () => {},
  });

  const closeDialog = () =>
    setDialogConfig((prev) => ({ ...prev, visible: false }));

  // Handlers UI
  const onCameraPress = async (target: 'physical' | 'performance') => {
    const result = await handleCamera(target);
    if (result === 'PERMISSION_DENIED') {
      setDialogConfig({
        visible: true,
        title: 'Permiso Requerido',
        description:
          'Necesitamos acceso a la cámara para verificar el producto.',
        isError: true,
        onConfirm: closeDialog,
      });
    }
  };

  const onSubmitPress = async () => {
    // Validaciones de UI antes de llamar a lógica
    const requiresBenchmark = category && ['GPU', 'CPU'].includes(category);
    const requiresInfo = category && ['RAM', 'Motherboard'].includes(category);

    if (!physicalUri) return;

    if (requiresBenchmark && (!performanceUri || !score)) {
      setDialogConfig({
        visible: true,
        title: t('alerts.errorTitle'),
        description: t('alerts.missingFields'),
        isError: true,
        onConfirm: closeDialog,
      });
      return;
    }
    if (requiresInfo && !performanceUri) {
      setDialogConfig({
        visible: true,
        title: t('alerts.errorTitle'),
        description: t('alerts.missingFields'),
        isError: true,
        onConfirm: closeDialog,
      });
      return;
    }

    try {
      await submitVerification();
      // Éxito
      setDialogConfig({
        visible: true,
        title: t('alerts.successTitle'),
        description: t('alerts.successMessage'),
        isError: false,
        onConfirm: () => {
          closeDialog();
          router.replace('/(tabs)/profile');
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      setDialogConfig({
        visible: true,
        title: t('alerts.errorTitle'),
        description: t('alerts.errorMessage'),
        isError: true,
        onConfirm: closeDialog,
      });
    }
  };

  if (loadingCategory) return <Box flex={1} backgroundColor="background" />;

  const requiresBenchmark = category && ['GPU', 'CPU'].includes(category);
  const requiresInfo = category && ['RAM', 'Motherboard'].includes(category);
  let guideType: 'benchmark' | 'info' | 'mobo' = 'benchmark';

  if (category === 'RAM') {
    guideType = 'info';
  } else if (category === 'Motherboard') {
    guideType = 'mobo';
  } else {
    guideType = 'benchmark';
  }
  const canSubmit =
    (requiresBenchmark && physicalUri && performanceUri && score) ||
    (requiresInfo && physicalUri && performanceUri) ||
    (!requiresBenchmark && !requiresInfo && physicalUri);

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        title={t('screen.title')}
        showBack={true}
        backgroundColor="cardBackground"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
        style={{
          flex: 1,
          marginBottom: Platform.OS === 'ios' ? 0 : insets.bottom,
        }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 60 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: insets.top + 90,
            paddingBottom: 70,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            title={t('screen.title')}
            subtitle={t('screen.subtitle')}
          />

          {status === 'REJECTED' && rejectionReason && (
            <Box
              backgroundColor="background"
              padding="m"
              borderRadius="m"
              marginBottom="m"
              marginTop="m"
              borderWidth={1}
              borderColor="error"
            >
              <Box flexDirection="row" alignItems="center" marginBottom="xs">
                <MaterialCommunityIcons
                  name="alert-circle"
                  size={20}
                  color={theme.colors.error}
                />
                <Text
                  variant="subheader-md"
                  color="error"
                  marginLeft="s"
                  fontWeight="bold"
                >
                  {t('rejection.title')}
                </Text>
              </Box>

              <Text
                variant="body-md"
                color="textPrimary"
                style={{ marginTop: 4 }}
              >
                {rejectionReason}
              </Text>

              <Text variant="caption-md" color="textSecondary" marginTop="s">
                {t('rejection.subtitle')}
              </Text>
            </Box>
          )}

          <VerificationMissionCard
            title={t('missions.physicalTitle')}
            description={t('missions.physicalDesc')}
            instruction={t('missions.physicalInstruction')}
            icon="file-document-edit-outline"
            imageUri={physicalUri}
            onPressCamera={() => onCameraPress('physical')}
          />

          {(requiresBenchmark || requiresInfo) && (
            <VerificationMissionCard
              title={
                requiresBenchmark
                  ? t('missions.performanceTitle')
                  : t('missions.infoTitle')
              }
              description={
                requiresBenchmark
                  ? t('missions.performanceDesc')
                  : t('missions.infoDesc')
              }
              instruction={
                requiresBenchmark
                  ? t('missions.performanceInstruction')
                  : category === 'RAM'
                    ? t('missions.infoInstructionRAM')
                    : t('missions.infoInstructionMobo')
              }
              icon={
                requiresBenchmark
                  ? 'rocket-launch-outline'
                  : 'information-outline'
              }
              imageUri={performanceUri}
              onPressCamera={() => onCameraPress('performance')}
              onPressHelp={() => guideModalRef.current?.present()}
              showScoreInput={!!requiresBenchmark}
              scoreValue={score}
              onScoreChange={setScore}
              onScoreFocus={() =>
                setTimeout(
                  () => scrollViewRef.current?.scrollToEnd({ animated: true }),
                  100,
                )
              }
            />
          )}

          <Box gap="m" marginTop="m">
            <PrimaryButton
              onPress={onSubmitPress}
              loading={isUploading}
              disabled={!canSubmit || isUploading}
              icon="check-circle-outline"
            >
              {t('actions.submit')}
            </PrimaryButton>

            <PrimaryButton
              onPress={() => router.replace('/(tabs)/profile')}
              variant="outline"
              disabled={isUploading}
            >
              {t('actions.saveExit')}
            </PrimaryButton>
          </Box>
        </ScrollView>
      </KeyboardAvoidingView>

      <BenchmarkGuideModal
        innerRef={guideModalRef}
        onDismiss={() => {}}
        type={guideType}
      />

      {/* DIÁLOGO CENTRALIZADO */}
      <ConfirmDialog
        visible={dialogConfig.visible}
        title={dialogConfig.title}
        description={dialogConfig.description}
        onConfirm={dialogConfig.onConfirm}
        onCancel={closeDialog}
        hideCancel={true} // Modo Alerta
        isDangerous={dialogConfig.isError}
        icon={
          dialogConfig.isError ? 'alert-circle-outline' : 'check-circle-outline'
        }
      />
    </Box>
  );
}

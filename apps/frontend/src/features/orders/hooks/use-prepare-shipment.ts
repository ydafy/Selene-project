import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Linking } from 'react-native';
import { useLocalSearchParams, useRouter, usePreventRemove } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { Address } from '@selene/types';
import { useAuthContext } from '../../../shared/lib/auth/auth-provider';
import {
  PackagePreset,
  PackagePresetsMap,
  useSystemConfig,
} from '../../../shared/hooks/use-system-config';
import { authenticateAsync } from '../../../shared/lib/biometrics';
import { useConnectOnboarding } from '../../payments/hooks/use-connect-onboarding';
import { useOrderById } from './use-orders';
import { useOrderActions } from './use-order-actions';
import { useShipmentLabelRefresh } from './use-shipment-label-refresh';
import { resolvePreparingBox } from '../logic/preparing-box';
import {
  generateLabelWithRecovery,
  openGeneratedLabel,
  type LabelDiagnostic,
} from '../logic/shipping-label-outcome';
import { resolveShipmentLabelState } from '../logic/shipment-label-state';

export const EVIDENCE_MIN_PHOTOS = 3;

export function usePrepareShipment() {
  const { id, shipment_id } = useLocalSearchParams<{
    id: string;
    shipment_id?: string;
  }>();
  const selectedShipmentId = Array.isArray(shipment_id)
    ? shipment_id[0]
    : shipment_id;
  const { t } = useTranslation(['orders', 'common']);
  const router = useRouter();

  const {
    data: order,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useOrderById(id);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const actions = useOrderActions(id || '');

  const { session } = useAuthContext();
  const userId = session?.user.id;

  const sellerShipments = useMemo(() => {
    return (
      order?.shipments?.filter((shipment) => shipment.seller_id === userId) ??
      []
    );
  }, [order?.shipments, userId]);

  const selectedShipment = useMemo(() => {
    if (!selectedShipmentId) return null;
    return (
      sellerShipments.find((shipment) => shipment.id === selectedShipmentId) ??
      null
    );
  }, [selectedShipmentId, sellerShipments]);

  const targetShipmentId = selectedShipment?.id;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submissionInFlight = useRef(false);
  const evidenceBusy = useRef(false);
  const [isEvidenceBusy, setIsEvidenceBusy] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isProcessing = isAuthenticating || actions.generateLabel.isLoading;
  const canInteract = useCallback(
    () => mounted.current && !submissionInFlight.current && !isProcessing,
    [isProcessing],
  );
  const hasExistingLabel = Boolean(selectedShipment?.label_url);
  const labelState = resolveShipmentLabelState(
    selectedShipment,
    Boolean(error),
  );
  const canGenerateLabel = labelState === 'ready' && !isFetching;

  // Bloquea hardware back (Android) y swipe de borde (iOS) mientras procesa:
  usePreventRemove(isProcessing, () => {});

  const { data: systemConfig } = useSystemConfig();
  const packagePresets = systemConfig?.package_presets as unknown as
    PackagePresetsMap | undefined;
  const presetId = selectedShipment?.items[0]?.product?.package_preset ?? null;
  const preparingBox = resolvePreparingBox(presetId, packagePresets);
  const boxPreset: PackagePreset | undefined =
    'preset' in preparingBox ? preparingBox.preset : undefined;
  // Mirrors the server: without a usable box no label can be generated.
  const boxBlocked = preparingBox.status === 'unavailable';

  const { isComplete: onboardingDone, isLoading: onboardingLoading } =
    useConnectOnboarding(userId);

  const addressModalRef = useRef<BottomSheetModal>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<Address | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);
  const [labelOpenError, setLabelOpenError] = useState(false);

  const reportLabelDiagnostic = useCallback(
    (event: LabelDiagnostic) => {
      console.warn('[PREPARE_SHIPMENT]', {
        event,
        shipmentId: targetShipmentId,
      });
    },
    [targetShipmentId],
  );

  const handleRefreshLabelStatus = useCallback(async () => {
    setErrorMsg(null);
    try {
      const refreshed = await refetch({ cancelRefetch: false });
      if (refreshed.error) reportLabelDiagnostic('status_refresh_failed');
    } catch {
      reportLabelDiagnostic('status_refresh_failed');
    }
  }, [refetch, reportLabelDiagnostic]);

  useShipmentLabelRefresh(targetShipmentId, handleRefreshLabelStatus);

  const handleOpenLabel = async (url: string) => {
    if (!canInteract()) return false;
    setLabelOpenError(false);
    const opened = await openGeneratedLabel(
      url,
      (value) => Linking.openURL(value),
      reportLabelDiagnostic,
    );
    if (!mounted.current) return false;
    if (!opened) {
      setLabelOpenError(true);
      setErrorMsg(t('orders:prepare.errors.labelOpenFailed'));
    }
    return opened;
  };

  const handleAddressSelect = useCallback((addr: Address) => {
    if (!mounted.current || submissionInFlight.current) return;
    setSelectedOrigin(addr);
  }, []);

  const remainingPhotos = Math.max(
    0,
    EVIDENCE_MIN_PHOTOS - evidenceUrls.length,
  );

  const handleConfirm = async () => {
    if (
      !mounted.current ||
      submissionInFlight.current ||
      evidenceBusy.current ||
      isProcessing ||
      !selectedOrigin ||
      !targetShipmentId ||
      boxBlocked ||
      !canGenerateLabel ||
      evidenceUrls.length < EVIDENCE_MIN_PHOTOS
    )
      return;

    submissionInFlight.current = true;
    setIsAuthenticating(true);
    setErrorMsg(null);

    try {
      addressModalRef.current?.dismiss();
      const auth = await authenticateAsync(t('orders:prepare.securityReason'));
      if (!auth.success || !mounted.current) return;

      const result = await generateLabelWithRecovery({
        generate: () =>
          actions.generateLabel.execute({
            shipmentId: targetShipmentId,
            originAddressId: selectedOrigin.id,
            shippingEvidence: { images: evidenceUrls },
          }),
        recover: async () => {
          const refreshed = await refetch();
          if (refreshed.error) throw refreshed.error;
          return (
            refreshed.data?.shipments?.find(
              (shipment) =>
                shipment.id === targetShipmentId &&
                shipment.seller_id === userId,
            )?.label_url ?? null
          );
        },
        feedback: () =>
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        report: reportLabelDiagnostic,
      });

      if (!mounted.current) return;
      if (result.kind === 'generated') {
        setLabelUrl(result.labelUrl);
        setLabelOpenError(false);
        setShowSuccess(true);
      } else {
        setErrorMsg(t(`orders:${result.errorKey}`));
      }
    } catch {
      reportLabelDiagnostic('generation_unconfirmed');
      if (mounted.current)
        setErrorMsg(t('orders:prepare.errors.resultUnconfirmed'));
    } finally {
      submissionInFlight.current = false;
      if (mounted.current) setIsAuthenticating(false);
    }
  };

  const handleEvidenceBusyChange = (busy: boolean) => {
    if (!mounted.current) return;
    evidenceBusy.current = busy;
    setIsEvidenceBusy(busy);
  };

  const handleEvidenceFailure = () => {
    if (mounted.current && !submissionInFlight.current)
      setErrorMsg(t('orders:prepare.errors.evidenceFailed'));
  };

  const handleEvidenceComplete = (urls: string[]) => {
    if (mounted.current && !submissionInFlight.current) setEvidenceUrls(urls);
  };

  const handleSuccessConfirm = async () => {
    if (!labelUrl || !(await handleOpenLabel(labelUrl))) return;
    if (!mounted.current || submissionInFlight.current) return;
    setShowSuccess(false);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/profile/orders/${id}`);
    }
  };

  return {
    id,
    userId,
    order,
    isLoading,
    isFetching,
    refetch,
    errorMsg,
    evidenceUrls,
    sellerShipments,
    selectedShipment,
    targetShipmentId,
    isProcessing,
    isEvidenceBusy,
    canInteract,
    hasExistingLabel,
    labelState,
    canGenerateLabel,
    preparingBox,
    boxPreset,
    boxBlocked,
    onboardingDone,
    onboardingLoading,
    addressModalRef,
    selectedOrigin,
    showSuccess,
    labelOpenError,
    remainingPhotos,
    handleRefreshLabelStatus,
    handleOpenLabel,
    handleAddressSelect,
    handleConfirm,
    handleEvidenceBusyChange,
    handleEvidenceFailure,
    handleEvidenceComplete,
    handleSuccessConfirm,
  };
}

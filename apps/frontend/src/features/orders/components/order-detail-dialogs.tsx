import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { EnrichedOrder, EnrichedShipment } from '@selene/types';

import { ConfirmDialog } from '@/shared/ui/feedback/confirm-dialog';
import { ReviewModal } from '@/features/orders/components/review-modal';

interface OrderDetailDialogsProps {
  order: EnrichedOrder;
  shipment: EnrichedShipment;
  cancelVisible: boolean;
  cancelDescription: string;
  isCancelling: boolean;
  onConfirmCancel: () => void;
  onDismissCancel: () => void;
  deliveryVisible: boolean;
  isConfirmingDelivery: boolean;
  onConfirmDelivery: () => void;
  onDismissDelivery: () => void;
  reviewModalRef: React.Ref<BottomSheetModal>;
  activeReviewProductId: string | null;
  onReviewSuccess: () => void;
  reviewError: string | null;
  onRetryReview: () => void;
  onDismissReviewError: () => void;
}

export function OrderDetailDialogs({
  order,
  shipment,
  cancelVisible,
  cancelDescription,
  isCancelling,
  onConfirmCancel,
  onDismissCancel,
  deliveryVisible,
  isConfirmingDelivery,
  onConfirmDelivery,
  onDismissDelivery,
  reviewModalRef,
  activeReviewProductId,
  onReviewSuccess,
  reviewError,
  onRetryReview,
  onDismissReviewError,
}: OrderDetailDialogsProps) {
  const { t } = useTranslation();

  return (
    <>
      <ConfirmDialog
        visible={cancelVisible}
        title={t('orders:dialogs.cancelTitle')}
        description={cancelDescription}
        onConfirm={onConfirmCancel}
        onCancel={onDismissCancel}
        isDangerous
        confirmLabel={t('orders:actions.confirmCancel')}
        loading={isCancelling}
      />

      <ConfirmDialog
        visible={deliveryVisible}
        title={t('orders:dialogs.deliveryTitle')}
        description={t('orders:dialogs.deliveryMsg')}
        onConfirm={onConfirmDelivery}
        onCancel={onDismissDelivery}
        confirmLabel={t('orders:dialogs.deliveryConfirm')}
        cancelLabel={t('orders:dialogs.deliveryCancel')}
        loading={isConfirmingDelivery}
        icon="package-variant"
      />

      <ReviewModal
        ref={reviewModalRef}
        order={order}
        sellerId={shipment.seller_id}
        shipmentId={shipment.id}
        productId={activeReviewProductId ?? undefined}
        productName={
          activeReviewProductId
            ? shipment.items?.find(
                (i) => i.product_id === activeReviewProductId,
              )?.product?.name
            : undefined
        }
        onSuccess={onReviewSuccess}
      />

      <ConfirmDialog
        visible={!!reviewError}
        title={t('orders:dialogs.reviewErrorTitle')}
        description={reviewError ?? ''}
        onConfirm={onRetryReview}
        onCancel={onDismissReviewError}
        confirmLabel={t('orders:dialogs.reviewErrorRetry')}
        cancelLabel={t('orders:dialogs.reviewErrorClose')}
      />
    </>
  );
}

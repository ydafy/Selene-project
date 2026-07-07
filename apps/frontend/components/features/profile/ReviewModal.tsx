import React, { useState, forwardRef, useCallback, useMemo } from 'react';
import { TouchableWithoutFeedback, Keyboard, StyleSheet } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { StarRating } from '../../ui/StarRating';
import { useReviewAction } from '../../../core/hooks/useReviewAction';
import { useAuthContext } from '../../auth/AuthProvider';
import { Theme } from '../../../core/theme';
import { EnrichedOrder } from '@selene/types';

interface Props {
  order: EnrichedOrder;
  /**
   * Vendedor objetivo de la reseña. En órdenes multi-vendedor el detalle
   * pasa el `seller_id` del envío actual (`currentShipment.seller_id`) para
   * calificar al vendedor correcto en lugar de siempre `order.items[0]`.
   * Si se omite, se conserva el comportamiento previo (primer item).
   */
  sellerId?: string;
  /**
   * Shipment being reviewed. Threads the shipment-safe identity tuple
   * `(reviewer_id, shipment_id, product_id)` through `useReviewAction` so the
   * resulting review can earn the verified-purchase badge. `null`/omitted for
   * legacy order-first reviews (no verified-purchase attribution).
   */
  shipmentId?: string;
  /**
   * Product within the shipment being reviewed. Pairs with `shipmentId` to
   * prove verified-purchase linkage. `null`/omitted for legacy reviews.
   * V1 ships ONE review per shipment scoped to the shipment's first product;
   * V2 will expand to one review per product within a shipment.
   */
  productId?: string;
  /**
   * Optional product name to render under the subtitle so the buyer sees
   * exactly which product they are rating in a multi-product shipment (V2).
   * Dynamic data — NOT a translatable string. Omitted for legacy reviews.
   */
  productName?: string;
  onSuccess?: () => void;
}

export const ReviewModal = forwardRef<BottomSheetModal, Props>(
  ({ order, sellerId, shipmentId, productId, productName, onSuccess }, ref) => {
    const theme = useTheme<Theme>();
    const { t } = useTranslation(['profile', 'common']);
    const { session } = useAuthContext();
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');

    const snapPoints = useMemo(() => ['50%'], []);

    const { mutateAsync: submitReview, isPending } = useReviewAction(order.id);

    const reviewSellerId = sellerId || order.shipments[0]?.seller_id || '';

    const handleSend = async () => {
      if (rating === 0) return;
      try {
        const reviewInput = {
          orderId: order.id,
          rating,
          comment,
          sellerId: reviewSellerId,
          reviewerId: session?.user.id ?? '',
          shipmentId: shipmentId,
          productId: productId,
        };
        console.log(
          '[ReviewModal] submitReview input:',
          JSON.stringify(reviewInput, null, 2),
        );
        await submitReview(reviewInput);
        onSuccess?.();
        Toast.show({
          type: 'success',
          text1: t('profile:review.successTitle', 'Review enviada'),
          text2: t('profile:review.successMsg', 'Gracias por tu calificación.'),
        });
        if (typeof ref !== 'function' && ref?.current) {
          ref.current.dismiss();
        }
      } catch (e) {
        console.error(
          '[ReviewModal] submitReview error:',
          e,
          // PostgREST errors carry code/details/hint on the error object
          e instanceof Error
            ? JSON.stringify(
                {
                  name: e.name,
                  message: e.message,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ...(e as any),
                },
                null,
                2,
              )
            : e,
        );
        Toast.show({
          type: 'error',
          text1: t('common:states.errorTitle'),
          text2:
            e instanceof Error
              ? `[${(e as any).code || 'ERROR'}] ${e.message}`
              : t('common:errors.generic'),
        });
        if (typeof ref !== 'function' && ref?.current) {
          ref.current.dismiss();
        }
      }
    };

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} opacity={0.7} pressBehavior="close" />
      ),
      [],
    );

    return (
      <BottomSheetModal
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
        onDismiss={() => {
          setRating(0);
          setComment('');
        }}
      >
        <BottomSheetScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <Box padding="l" gap="l">
              <Box alignItems="center">
                <Text variant="header-xl" color="textPrimary">
                  {t('review.title')}
                </Text>
                <Text variant="body-sm" color="textSecondary" marginTop="xs">
                  {t('review.subtitle')}
                </Text>
                {productName && (
                  <Text
                    variant="body-sm"
                    color="textPrimary"
                    marginTop="xs"
                    fontWeight="bold"
                    numberOfLines={1}
                  >
                    {productName}
                  </Text>
                )}
              </Box>

              <StarRating
                rating={rating}
                onRatingChange={setRating}
                size={40}
              />

              <Box
                backgroundColor="background"
                borderRadius="m"
                padding="m"
                borderWidth={0.5}
                borderColor="separator"
              >
                <BottomSheetTextInput
                  placeholder={t('review.commentPlaceholder')}
                  placeholderTextColor={theme.colors.textSecondary}
                  multiline
                  numberOfLines={4}
                  value={comment}
                  onChangeText={setComment}
                  style={{
                    color: theme.colors.textPrimary,
                    fontFamily: 'Montserrat-Regular',
                    height: 80,
                    textAlignVertical: 'top',
                  }}
                />
              </Box>

              <PrimaryButton
                onPress={handleSend}
                loading={isPending}
                disabled={rating === 0}
                icon="check-decagram"
              >
                {t('review.confirmButton')}
              </PrimaryButton>
            </Box>
          </TouchableWithoutFeedback>
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
});

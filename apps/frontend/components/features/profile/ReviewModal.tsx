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
  onSuccess?: () => void;
}

export const ReviewModal = forwardRef<BottomSheetModal, Props>(
  ({ order, onSuccess }, ref) => {
    const theme = useTheme<Theme>();
    const { t } = useTranslation(['profile', 'common']);
    const { session } = useAuthContext();
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');

    const snapPoints = useMemo(() => ['50%'], []);

    const { mutateAsync: submitReview, isPending } = useReviewAction(order.id);

    const handleSend = async () => {
      if (rating === 0) return;
      try {
        await submitReview({
          rating,
          comment,
          sellerId: order.items[0]?.seller_id ?? '',
          reviewerId: session?.user.id ?? '',
        });
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
        Toast.show({
          type: 'error',
          text1: t('common:states.errorTitle'),
          text2: e instanceof Error ? e.message : t('common:errors.generic'),
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

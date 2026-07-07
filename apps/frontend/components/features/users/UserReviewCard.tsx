/**
 * @file components/features/users/UserReviewCard.tsx
 * @description Reusable, atomic review card component for seller profiles.
 *
 * Implements:
 * 1. Image recycling and initials fallback for buyer avatars via AppImage.
 * 2. High-contrast vector rating stars (MaterialCommunityIcons).
 * 3. Verified Purchase badge with dynamic product name binding.
 * 4. WCAG-compliant screen reader accessibility descriptions.
 *
 * @version 1.0
 * @domain profile-reviews-ui
 */
import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { SellerReview } from '../../../core/hooks/useSellerReviews';
import { Theme } from '../../../core/theme';
import { useTranslation } from 'react-i18next';
import { getUserReviewCardPresentation } from './UserReviewCard.helpers';

export { getUserReviewCardPresentation } from './UserReviewCard.helpers';

type UserReviewCardProps = {
  /** The full relational review data from the useSellerReviews query */
  review: SellerReview;
};

export const UserReviewCard = ({ review }: UserReviewCardProps) => {
  const theme = useTheme<Theme>();
  const { t, i18n } = useTranslation('profile');
  const presentation = getUserReviewCardPresentation(
    review,
    i18n.language || 'en-US',
    {
      userFallback: t('public.a11y.reviewUserFallback'),
      itemFallback: t('public.reviewItemFallback'),
      noComment: t('public.a11y.reviewNoComment'),
      reviewFrom: t('public.a11y.reviewFrom'),
      rating: t('public.a11y.reviewRating'),
      outOfFive: t('public.a11y.reviewOutOfFive'),
      reviewedOn: t('public.reviewDatePrefix'),
      comment: t('public.a11y.reviewComment'),
      verifiedPurchase: t('public.a11y.reviewVerifiedPurchase'),
    },
  );

  if (!presentation.shouldRender) {
    return null;
  }

  // Fallback calculations for avatar initials
  const initials = review.reviewer?.username
    ? review.reviewer.username.slice(0, 2).toUpperCase()
    : 'US';

  // Dynamic accessibility description for screen readers (a11y)
  const accessibilityLabel = presentation.accessibilityLabel;

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Fila superior: Comprador + Estrellas */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom="s"
      >
        <Box flexDirection="row" alignItems="center" gap="s">
          <Box
            width={32}
            height={32}
            borderRadius="full"
            overflow="hidden"
            backgroundColor="background"
            justifyContent="center"
            alignItems="center"
          >
            {review.reviewer?.avatar_url ? (
              <AppImage
                source={{ uri: review.reviewer.avatar_url }}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <Text variant="caption-md" color="textSecondary">
                {initials}
              </Text>
            )}
          </Box>
          <Text variant="body-sm" fontWeight="bold">
            @{review.reviewer?.username || 'Usuario'}
          </Text>
        </Box>

        {/* Estrellas de Calificación */}
        <Box flexDirection="row" gap="xs">
          {[...Array(5)].map((_, idx) => (
            <MaterialCommunityIcons
              key={idx}
              name={idx < review.rating ? 'star' : 'star-outline'}
              size={14}
              color={
                idx < review.rating
                  ? theme.colors.primary
                  : theme.colors.textSecondary
              }
            />
          ))}
        </Box>
      </Box>

      {/* Comentario de la reseña */}
      <Text variant="body-md" color="textPrimary" marginBottom="s">
        {review.comment}
      </Text>

      <Text variant="caption-md" color="textSecondary" marginBottom="s">
        {t('public.reviewDatePrefix')} {presentation.formattedDate}
      </Text>

      {/* Badge de Compra Verificada */}
      {presentation.showVerifiedBadge ? (
        <Box
          flexDirection="row"
          alignItems="center"
          gap="xs"
          alignSelf="flex-start"
          backgroundColor="background"
          paddingHorizontal="s"
          paddingVertical="xs"
          borderRadius="m"
        >
          <MaterialCommunityIcons
            name="shield-check"
            size={14}
            color={theme.colors.primary}
          />
          <Text variant="caption-md" color="primary" fontWeight="bold">
            {t('public.verifiedPurchase', {
              product: review.product?.name ?? t('public.reviewItemFallback'),
            })}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Text } from '../base';
import { StarRating } from './StarRating';

interface Props {
  rating: number;
  comment: string | null;
  createdAt: string;
}

const formatDate = (iso: string) => {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} días`;
  if (diffDays < 30) return `Hace ${Math.floor(diffDays / 7)} semanas`;
  return date.toLocaleDateString();
};

export const ReviewCard = ({ rating, comment, createdAt }: Props) => {
  const { t } = useTranslation('profile');

  return (
    <Box
      backgroundColor="cardBackground"
      borderRadius="m"
      padding="m"
      gap="s"
    >
      <Text variant="subheader-md" color="textPrimary">
        {t('review.yourReview', 'Tu calificación')}
      </Text>

      <StarRating rating={rating} interactive={false} size={28} />

      {comment ? (
        <Text variant="body-md" color="textPrimary">
          {comment}
        </Text>
      ) : null}

      <Text variant="caption-md" color="textSecondary">
        {formatDate(createdAt)}
      </Text>
    </Box>
  );
};

/**
 * @file components/features/onboarding/OnboardingSteps.tsx
 * @description Stateless presentation steps for Stripe Connect onboarding.
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation, Trans } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';
import type { StripeOnboardingStatus } from '@selene/types';
import type { ConnectOnboardingStatusGuidanceKey } from '../../../core/utils/connectOnboardingUi';
import stripeStep2Image from '../../../assets/images/stripe/stripe-step-2.webp';
import stripeStep3Image from '../../../assets/images/stripe/stripe-step-3.webp';

export const ONBOARDING_GUIDE_IMAGES = [stripeStep2Image, stripeStep3Image];

export const ONBOARDING_GUIDE_IMAGE_INDEX = {
  accountType: 0,
  businessDetails: 1,
} as const;

const GUIDANCE_CARD_DEFINITIONS = [
  {
    icon: 'bank-outline',
    titleKey: 'wallet:onboarding.guidance.tip3_title',
    descriptionKey: 'wallet:onboarding.guidance.tip3_desc',
  },
  {
    icon: 'file-document-outline',
    titleKey: 'wallet:onboarding.guidance.tip2_title',
    descriptionKey: 'wallet:onboarding.guidance.tip2_desc',
  },
  {
    icon: 'shield-check-outline',
    titleKey: 'wallet:onboarding.guidance.tip1_title',
    descriptionKey: 'wallet:onboarding.guidance.tip1_desc',
  },
] as const satisfies ReadonlyArray<{
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  titleKey: string;
  descriptionKey: string;
}>;

const GUIDANCE_CARD_TOTAL = GUIDANCE_CARD_DEFINITIONS.length;

const stripTransTags = (value: string) => value.replace(/<[^>]*>/g, '');

interface GuidanceCardProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description: string;
  index: number;
}

const GuidanceCard = ({
  icon,
  title,
  description,
  index,
}: GuidanceCardProps) => {
  const { t } = useTranslation(['wallet']);
  const theme = useTheme<Theme>();
  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={t('wallet:onboarding.guidance.cardLabel', {
        index,
        total: GUIDANCE_CARD_TOTAL,
        title,
        description,
      })}
    >
      <Box flexDirection="row" alignItems="flex-start" gap="s">
        <MaterialCommunityIcons
          name={icon}
          size={22}
          color={theme.colors.primary}
          style={{ marginTop: 2 }}
        />
        <Box flex={1}>
          <Text variant="body-md" fontWeight="bold" marginBottom="xs">
            {title}
          </Text>
          <Text variant="body-sm" color="textSecondary">
            {description}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

interface StripeGuideImageCardProps {
  imageIndex: number;
  onImagePress: () => void;
}

const StripeGuideImageCard = ({
  imageIndex,
  onImagePress,
}: StripeGuideImageCardProps) => {
  const { t } = useTranslation(['wallet']);
  const theme = useTheme<Theme>();

  return (
    <Box
      backgroundColor="cardBackground"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      overflow="hidden"
      style={{
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 5,
      }}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onImagePress}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={t('wallet:onboarding.image.openLabel')}
      >
        <AppImage
          source={ONBOARDING_GUIDE_IMAGES[imageIndex]}
          style={{ width: '100%', height: 200 }}
          contentFit="contain"
        />
        <Box
          position="absolute"
          bottom={12}
          right={12}
          backgroundColor="background"
          opacity={0.8}
          paddingHorizontal="s"
          paddingVertical="xs"
          borderRadius="m"
          flexDirection="row"
          alignItems="center"
          gap="xs"
        >
          <MaterialCommunityIcons
            name="magnify-plus-outline"
            size={14}
            color={theme.colors.primary}
          />
          <Text variant="caption-md" color="textPrimary">
            {t('wallet:onboarding.image.viewScreen')}
          </Text>
        </Box>
      </TouchableOpacity>
    </Box>
  );
};

export const OnboardingStep0 = () => {
  const { t } = useTranslation(['wallet']);
  return (
    <Box gap="m">
      {GUIDANCE_CARD_DEFINITIONS.map((card, index) => (
        <GuidanceCard
          key={card.titleKey}
          icon={card.icon}
          title={t(card.titleKey)}
          description={stripTransTags(t(card.descriptionKey))}
          index={index + 1}
        />
      ))}
    </Box>
  );
};

interface Step1Props {
  onImagePress: () => void;
}

export const OnboardingStep1 = ({ onImagePress }: Step1Props) => {
  return (
    <Box gap="m">
      <Box backgroundColor="cardBackground" padding="m" borderRadius="m">
        <Text variant="body-md" color="textSecondary">
          <Trans
            i18nKey="wallet:onboarding.guidance.accountType_desc"
            components={{
              resaltar: (
                <Text
                  color="textPrimary"
                  fontStyle="italic"
                  fontWeight="bold"
                />
              ),
            }}
          />
        </Text>
      </Box>

      <StripeGuideImageCard
        imageIndex={ONBOARDING_GUIDE_IMAGE_INDEX.accountType}
        onImagePress={onImagePress}
      />
    </Box>
  );
};

interface Step2Props {
  onImagePress: () => void;
}

export const OnboardingStep2 = ({ onImagePress }: Step2Props) => {
  return (
    <Box gap="m">
      <Box backgroundColor="cardBackground" padding="m" borderRadius="m">
        <Text variant="body-md" color="textSecondary">
          <Trans
            i18nKey="wallet:onboarding.guidance.tip2_desc"
            components={{
              resaltar: (
                <Text
                  color="textPrimary"
                  fontStyle="italic"
                  fontWeight="bold"
                />
              ),
            }}
          />
        </Text>
      </Box>

      <StripeGuideImageCard
        imageIndex={ONBOARDING_GUIDE_IMAGE_INDEX.businessDetails}
        onImagePress={onImagePress}
      />
    </Box>
  );
};

const STATUS_GUIDANCE_ICON = {
  new: 'bank-outline',
  pending: 'progress-clock',
  rejected: 'alert-circle-outline',
} as const satisfies Record<
  ConnectOnboardingStatusGuidanceKey,
  keyof typeof MaterialCommunityIcons.glyphMap
>;

interface Step3Props {
  status: StripeOnboardingStatus | null;
  statusGuidanceKey: ConnectOnboardingStatusGuidanceKey | null;
}

export const OnboardingStep3 = ({
  status,
  statusGuidanceKey,
}: Step3Props) => {
  const { t } = useTranslation(['wallet']);
  const theme = useTheme<Theme>();
  const guidanceKey =
    statusGuidanceKey ??
    (status === 'pending' || status === 'rejected' ? status : 'new');

  return (
    <Box gap="m" alignItems="center" paddingVertical="m">
      <Box
        backgroundColor="cardBackground"
        padding="m"
        borderRadius="m"
        alignItems="center"
      >
        <MaterialCommunityIcons
          name={STATUS_GUIDANCE_ICON[guidanceKey]}
          size={64}
          color={theme.colors.primary}
          style={{ marginBottom: 12 }}
        />
        <Text
          variant="body-md"
          fontWeight="bold"
          textAlign="center"
          color="textPrimary"
          marginBottom="xs"
          style={{ paddingHorizontal: 16 }}
        >
          {t(`wallet:onboarding.statusGuidance.${guidanceKey}Title`)}
        </Text>
        <Text
          variant="body-md"
          textAlign="center"
          color="textSecondary"
          style={{ paddingHorizontal: 16 }}
        >
          {t(`wallet:onboarding.statusGuidance.${guidanceKey}Desc`)}
        </Text>
      </Box>
    </Box>
  );
};

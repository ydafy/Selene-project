/**
 * @file features/payments/components/onboarding-guide.tsx
 * @description Stateless pieces of the Stripe Connect onboarding guide.
 */
import { type ReactNode, useState } from 'react';
import { Pressable } from 'react-native';
import { useTranslation, Trans } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import MaterialCommunityIcons, {
  type MaterialDesignIconsIconName,
} from '@react-native-vector-icons/material-design-icons';

import { Box, Text } from '@/shared/ui/base';
import { Theme } from '@/shared/theme';

const GUIDE_CARDS = [
  { key: 'phone', icon: 'cellphone-message' },
  { key: 'ine', icon: 'card-account-details-outline' },
  { key: 'clabe', icon: 'bank-outline' },
] as const satisfies ReadonlyArray<{
  key: string;
  icon: MaterialDesignIconsIconName;
}>;

const stripTransTags = (value: string) => value.replace(/<[^>]*>/g, '');

interface GuideCardProps {
  cardKey: (typeof GUIDE_CARDS)[number]['key'];
  icon: MaterialDesignIconsIconName;
  index: number;
}

const GuideCard = ({ cardKey, icon, index }: GuideCardProps) => {
  const { t } = useTranslation(['sellerOnboarding']);
  const theme = useTheme<Theme>();
  const titleKey = `sellerOnboarding:guidance.${cardKey}Title` as const;
  const descriptionKey = `sellerOnboarding:guidance.${cardKey}Desc` as const;
  const title = t(titleKey);

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={t('sellerOnboarding:guidance.cardLabel', {
        index,
        total: GUIDE_CARDS.length,
        title,
        description: stripTransTags(t(descriptionKey)),
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
            <Trans
              i18nKey={descriptionKey}
              components={{
                resaltar: (
                  <Text
                    variant="body-sm"
                    color="textPrimary"
                    fontWeight="bold"
                  />
                ),
              }}
            />
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export const OnboardingGuideCards = () => {
  const { t } = useTranslation(['sellerOnboarding']);
  return (
    <Box gap="m">
      {GUIDE_CARDS.map((card, index) => (
        <GuideCard
          key={card.key}
          cardKey={card.key}
          icon={card.icon}
          index={index + 1}
        />
      ))}
      <Text variant="body-sm" color="textSecondary">
        {t('sellerOnboarding:guidance.termsNote')}
      </Text>
    </Box>
  );
};

interface PaymentsExplanationToggleProps {
  children: ReactNode;
}

/** Collapsed by default so the success screen stays short. */
export const PaymentsExplanationToggle = ({
  children,
}: PaymentsExplanationToggleProps) => {
  const { t } = useTranslation(['sellerOnboarding']);
  const theme = useTheme<Theme>();
  const [expanded, setExpanded] = useState(false);

  return (
    <Box
      width="100%"
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="m"
      gap="m"
    >
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Text variant="subheader-md" color="textPrimary">
            {t('sellerOnboarding:success.paymentsToggle')}
          </Text>
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={theme.colors.textSecondary}
          />
        </Box>
      </Pressable>
      {expanded && children}
    </Box>
  );
};

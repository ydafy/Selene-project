import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';

const STEP_KEYS = [
  'purchaseProgress.published',
  'purchaseProgress.verifying',
  'purchaseProgress.ready',
] as const;

type PurchaseProgressStepsProps = {
  /** Zero-based index of the current step. Earlier steps are done. */
  currentStep: number;
};

const DOT_SIZE = 16;

export const PurchaseProgressSteps = ({
  currentStep,
}: PurchaseProgressStepsProps) => {
  const { t } = useTranslation('product');
  const current = Math.min(Math.max(currentStep, 0), STEP_KEYS.length - 1);

  return (
    <Box
      flexDirection="row"
      alignItems="flex-start"
      accessible
      accessibilityLabel={t('purchaseProgress.a11y', {
        step: current + 1,
        total: STEP_KEYS.length,
        name: t(STEP_KEYS[current]),
      })}
    >
      {STEP_KEYS.map((key, index) => {
        const done = index < current;
        const isCurrent = index === current;
        return (
          <Box key={key} flex={1} alignItems="center">
            <Box
              flexDirection="row"
              alignItems="center"
              alignSelf="stretch"
              height={DOT_SIZE}
            >
              <Box
                flex={1}
                height={2}
                backgroundColor={
                  index > 0 && index <= current ? 'primary' : 'textSecondary'
                }
                opacity={index === 0 ? 0 : index <= current ? 1 : 0.3}
              />
              <Box
                width={DOT_SIZE}
                height={DOT_SIZE}
                borderRadius="full"
                borderWidth={2}
                borderColor={done || isCurrent ? 'primary' : 'textSecondary'}
                backgroundColor={done ? 'primary' : 'cardBackground'}
                alignItems="center"
                justifyContent="center"
              >
                {isCurrent && (
                  <Box
                    width={6}
                    height={6}
                    borderRadius="full"
                    backgroundColor="primary"
                  />
                )}
              </Box>
              <Box
                flex={1}
                height={2}
                backgroundColor={index < current ? 'primary' : 'textSecondary'}
                opacity={
                  index === STEP_KEYS.length - 1 ? 0 : index < current ? 1 : 0.3
                }
              />
            </Box>
            <Text
              variant="body-sm"
              color={isCurrent ? 'textPrimary' : 'textSecondary'}
              marginTop="xs"
              textAlign="center"
              style={isCurrent ? { fontFamily: 'Montserrat-Bold' } : undefined}
            >
              {t(key)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

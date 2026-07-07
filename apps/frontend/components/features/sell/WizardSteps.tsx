import React from 'react';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import {
  buildWizardStepA11yLabel,
  buildWizardParentA11yLabel,
} from './wizardA11y';

type WizardStepsProps = {
  currentStep: number;
  /** Array of localized step names passed dynamically by the parent screen */
  steps: string[];
};

export const WizardSteps = ({ currentStep, steps }: WizardStepsProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('sell');

  // Defensive check: if no steps are provided, render nothing safely
  if (!steps || steps.length === 0) return null;

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      marginBottom="m"
      paddingHorizontal="s"
      accessible={true}
      accessibilityRole="header"
      accessibilityLabel={buildWizardParentA11yLabel(
        currentStep,
        steps.length,
        steps,
        t,
      )}
    >
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <Box
            key={step}
            flexDirection="row"
            alignItems="center"
            flex={1}
            accessible={true}
            accessibilityLabel={buildWizardStepA11yLabel(
              step,
              index,
              currentStep,
              steps.length,
              t,
            )}
          >
            <Box alignItems="center" flex={1}>
              {/* Barra de Progreso */}
              <Box
                height={6}
                width="100%"
                borderRadius="s"
                backgroundColor={
                  isCompleted || isActive ? 'primary' : 'cardBackground'
                }
                marginBottom="xs"
                style={{
                  // El paso activo tiene un brillo (glow) cyberpunk
                  shadowColor: isActive ? theme.colors.primary : 'transparent',
                  shadowOpacity: isActive ? 0.8 : 0,
                  shadowRadius: isActive ? 4 : 0,
                  elevation: isActive ? 5 : 0,
                }}
              />

              <Box flexDirection="row" alignItems="center">
                {/* Icono de Check si está completado */}
                {isCompleted && (
                  <MaterialCommunityIcons
                    name="check-decagram"
                    size={12}
                    color={theme.colors.success}
                    style={{ marginRight: 4 }}
                  />
                )}

                <Text
                  variant={isActive ? 'body-sm' : 'caption-md'}
                  color={isActive || isCompleted ? 'primary' : 'textPrimary'}
                  fontWeight={isActive ? 'bold' : 'normal'}
                >
                  {step}
                </Text>
              </Box>
            </Box>

            {index < steps.length - 1 && <Box width={8} />}
          </Box>
        );
      })}
    </Box>
  );
};

import React from 'react';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

type WizardStepsProps = {
  currentStep: number;
};

const STEPS = ['Info', 'Specs', 'Fotos', 'Fin'];

export const WizardSteps = ({ currentStep }: WizardStepsProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      marginBottom="m"
      paddingHorizontal="s"
    >
      {STEPS.map((step, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <Box key={step} flexDirection="row" alignItems="center" flex={1}>
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
                  // El paso activo tiene un brillo (glow)
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

            {index < STEPS.length - 1 && <Box width={8} />}
          </Box>
        );
      })}
    </Box>
  );
};

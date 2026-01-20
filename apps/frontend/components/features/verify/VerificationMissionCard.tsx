import React from 'react';
import { Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Theme } from '../../../core/theme';

type VerificationMissionCardProps = {
  title: string;
  description: string;
  instruction: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  imageUri: string | null;
  onPressCamera: () => void;
  onPressHelp?: () => void;
  scoreValue?: string;
  onScoreChange?: (text: string) => void;
  showScoreInput?: boolean;
  onScoreFocus?: () => void;
};

export const VerificationMissionCard = ({
  title,
  description,
  instruction,
  icon,
  imageUri,
  onPressCamera,
  onPressHelp,
  scoreValue,
  onScoreChange,
  showScoreInput = false,
  onScoreFocus,
}: VerificationMissionCardProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('verify'); // <--- 2. Hook de traducción
  const isCompleted = !!imageUri;

  return (
    <Box
      backgroundColor="cardBackground"
      borderRadius="l"
      padding="m"
      marginBottom="l"
      style={styles.shadow}
    >
      {/* HEADER */}
      <Box flexDirection="row" alignItems="flex-start" marginBottom="m">
        <Box
          width={40}
          height={40}
          borderRadius="m"
          backgroundColor="background"
          alignItems="center"
          justifyContent="center"
          marginRight="m"
          borderWidth={1}
          borderColor={isCompleted ? 'primary' : 'textSecondary'}
        >
          <MaterialCommunityIcons
            name={isCompleted ? 'check' : icon}
            size={24}
            color={
              isCompleted ? theme.colors.primary : theme.colors.textSecondary
            }
          />
        </Box>

        <Box flex={1}>
          <Text
            variant="subheader-md"
            color={isCompleted ? 'primary' : 'textPrimary'}
          >
            {title}
          </Text>
          <Text variant="body-sm" color="textSecondary">
            {description}
          </Text>

          {/* Botón de Ayuda movido aquí para mejor UX */}
          {onPressHelp && (
            <TouchableOpacity onPress={onPressHelp} style={{ marginTop: 8 }}>
              <Text
                variant="caption-md"
                color="primary"
                textDecorationLine="underline"
              >
                {t('guide.buttonLabel')}
              </Text>
            </TouchableOpacity>
          )}
        </Box>
      </Box>

      {/* CONTENIDO */}
      <Box
        backgroundColor="background"
        borderRadius="m"
        overflow="hidden"
        borderWidth={1}
        borderColor={isCompleted ? 'primary' : 'separator'}
        style={!isCompleted ? { borderStyle: 'dashed' } : {}}
      >
        {isCompleted ? (
          <Box position="relative">
            <Image
              source={{ uri: imageUri }}
              style={{ width: '100%', height: 300 }}
              resizeMode="cover"
            />
            {/*
                SOLUCIÓN VISIBILIDAD:
                Fondo semitransparente absoluto en la esquina inferior derecha
            */}
            <Box
              position="absolute"
              bottom={10}
              right={10}
              borderRadius="m"
              padding="xs"
            >
              <PrimaryButton
                onPress={onPressCamera}
                labelStyle={{ fontSize: 12 }}
                style={{ height: 60, paddingHorizontal: 16 }}
                icon="camera-retake-outline"
              >
                {t('actions.changePhoto')}
              </PrimaryButton>
            </Box>
          </Box>
        ) : (
          <Box padding="l" alignItems="center" justifyContent="center">
            <Text
              variant="body-md"
              textAlign="center"
              marginBottom="m"
              color="textSecondary"
            >
              {instruction}
            </Text>
            <PrimaryButton onPress={onPressCamera} icon="camera">
              {t('actions.takePhoto')} {/* Texto traducido */}
            </PrimaryButton>
          </Box>
        )}
      </Box>

      {/* INPUT SCORE */}
      {showScoreInput && isCompleted && (
        <Box marginTop="m">
          <Text variant="caption-md" color="primary" marginBottom="xs">
            {t('missions.performanceScoreLabel')}
          </Text>
          <TextInput
            mode="outlined"
            value={scoreValue}
            onChangeText={onScoreChange}
            onFocus={onScoreFocus}
            placeholder={t('missions.performanceScorePlaceholder')}
            keyboardType="numeric"
            textColor={theme.colors.textPrimary}
            style={{ backgroundColor: theme.colors.background }}
            theme={{
              colors: {
                primary: theme.colors.primary,
                outline: theme.colors.textSecondary,
                onSurfaceVariant: theme.colors.textSecondary,
              },
            }}
            right={
              <TextInput.Icon
                icon="chart-bar"
                color={theme.colors.textSecondary}
              />
            }
          />
        </Box>
      )}
    </Box>
  );
};

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
});

/**
 * @file components/features/home/sections/ShellFeatureLine.tsx
 * @description Layout genérico para líneas editoriales con badges.
 */

import React, { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti';
import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';

interface BadgeProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
}

/**
 * Badge individual memoizado para optimizar el scroll.
 */
const InlineBadge = memo(({ icon, label }: BadgeProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      backgroundColor="background"
      paddingHorizontal="s"
      paddingVertical="xs"
      borderRadius="s"
      borderWidth={0.5}
      borderColor="separator"
      marginHorizontal="xs"
      style={{
        alignSelf: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
      }}
    >
      <MotiView
        from={{ opacity: 0.3 }}
        animate={{ opacity: 1 }}
        transition={{ loop: true, duration: 2000, repeatReverse: true }}
      >
        <MaterialCommunityIcons
          name={icon}
          size={12}
          color={theme.colors.primary}
          style={{ marginRight: 6 }}
        />
      </MotiView>

      <Text
        variant="caption-md"
        color="textPrimary"
        style={{ fontSize: 10, letterSpacing: 0.5, fontWeight: 'bold' }}
      >
        {label.toUpperCase()}
      </Text>
    </Box>
  );
});

export const ShellFeatureLine = memo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ parts }: { parts: (string | { icon: any; label: string })[] }) => {
    /**
     * Lógica de resaltado de marca Selene.
     */
    const renderStyledText = (text: string) => {
      return text.split(' ').map((word, i) => {
        const isBrand = word.toLowerCase().includes('selene');
        return (
          <Text
            key={i}
            variant="subheader-md"
            color={isBrand ? 'primary' : 'textPrimary'}
            style={{
              lineHeight: 34,
              fontStyle: isBrand ? 'italic' : 'normal',
              fontWeight: isBrand ? 'bold' : 'normal',
            }}
          >
            {word}{' '}
          </Text>
        );
      });
    };

    return (
      <Box
        padding="l"
        borderBottomWidth={1}
        borderBottomColor="separator"
        flexDirection="row"
        flexWrap="wrap"
        alignItems="center"
        justifyContent="center"
      >
        {parts.map((part, index) => (
          <React.Fragment key={index}>
            {typeof part === 'string' ? (
              renderStyledText(part)
            ) : (
              <InlineBadge icon={part.icon} label={part.label} />
            )}
          </React.Fragment>
        ))}
      </Box>
    );
  },
);

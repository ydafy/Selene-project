import React, { useState } from 'react';
import { ImageSourcePropType, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';

/**
 * Default 16:9 illustration per packing step, keyed by step index in the
 * order: box, protection, filler, sealing, label.
 */
const DEFAULT_STEP_IMAGES: ImageSourcePropType[] = [
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../assets/images/packaging/paso-1-caja.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../assets/images/packaging/paso-2-proteccion.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../assets/images/packaging/paso-3-relleno.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../assets/images/packaging/paso-4-sellado.webp'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../assets/images/packaging/paso-5-etiqueta.webp'),
];

type GuideStep = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Already-translated step title (always visible). */
  title: string;
  /** Already-translated hint shown under the image when expanded. */
  hint: string;
  /** Optional per-step illustration; falls back to the default step image. */
  image?: ImageSourcePropType;
};

type WhereInfo = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Already-translated row title (always visible). */
  title: string;
  /** Already-translated bulleted items shown when expanded. */
  items: string[];
  /** Already-translated label for the external-link button. */
  cta: string;
};

type PackagingGuideCardProps = {
  /** Already-translated section title. */
  title: string;
  /** Ordered packing steps (rows 1..N of the accordion). */
  steps: GuideStep[];
  /** "Where do I get the materials?" row (last accordion row). */
  where: WhereInfo;
  /** Already-translated consequence line shown once at the bottom. */
  consequence: string;
};

/**
 * "Pack it like this" block: an accordion where all row titles stay visible
 * and exactly one row is expanded at a time (tapping a row expands it and
 * collapses the previous one; tapping the expanded row collapses it).
 * Label-agnostic: it receives already-translated strings so it stays reusable.
 */
export const PackagingGuideCard = ({
  title,
  steps,
  where,
  consequence,
}: PackagingGuideCardProps) => {
  const theme = useTheme<Theme>();
  // Index of the expanded row: 0..steps.length-1 for steps, steps.length for
  // the "where" row. Row 1 is expanded by default.
  const [expanded, setExpanded] = useState(0);

  const toggle = (index: number) => {
    setExpanded((current) => (current === index ? -1 : index));
  };

  const rows = [
    ...steps.map((step, index) => ({
      key: step.title,
      index,
      icon: step.icon,
      title: step.title,
      image: step.image ?? DEFAULT_STEP_IMAGES[index],
      hint: step.hint,
    })),
    {
      key: where.title,
      index: steps.length,
      icon: where.icon,
      title: where.title,
      image: undefined,
      hint: undefined,
    },
  ];

  return (
    <>
      <Text variant="subheader-lg" marginBottom="m" color="primary">
        {title}
      </Text>
      <Box
        backgroundColor="cardBackground"
        padding="m"
        borderRadius="l"
        marginBottom="l"
        borderWidth={1}
        borderColor="separator"
      >
        {rows.map((row, rowIndex) => (
          <Box key={row.key}>
            <TouchableOpacity
              onPress={() => toggle(row.index)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: expanded === row.index }}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                gap="s"
                paddingVertical="s"
                minHeight={44}
              >
                <MaterialCommunityIcons
                  name={row.icon}
                  size={20}
                  color={theme.colors.primary}
                />
                <Text
                  variant="body-sm"
                  color="textPrimary"
                  fontWeight={expanded === row.index ? 'bold' : undefined}
                  flex={1}
                >
                  {row.title}
                </Text>
                <MaterialCommunityIcons
                  name={expanded === row.index ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={theme.colors.textSecondary}
                />
              </Box>
            </TouchableOpacity>

            {expanded === row.index && (row.image || row.hint) && (
              <Box marginBottom="s" width="100%">
                {row.image && (
                  // Bounded 200x120 pt stage (5:3): the illustration is
                  // centred and never inherits the source's intrinsic height.
                  <Box
                    width="100%"
                    height={120}
                    justifyContent="center"
                    alignItems="center"
                  >
                    <AppImage
                      source={row.image}
                      contentFit="contain"
                      style={{ height: '100%', aspectRatio: 5 / 3 }}
                    />
                  </Box>
                )}
                {row.hint && (
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    marginTop="xs"
                    textAlign="center"
                  >
                    {row.hint}
                  </Text>
                )}
              </Box>
            )}

            {expanded === row.index && row.index === steps.length && (
              <>
                {where.items.map((item) => (
                  <Box
                    key={item}
                    flexDirection="row"
                    alignItems="flex-start"
                    gap="xs"
                  >
                    <Text variant="caption-md" color="textSecondary">
                      •
                    </Text>
                    <Text variant="caption-md" color="textSecondary" flex={1}>
                      {item}
                    </Text>
                  </Box>
                ))}
              </>
            )}

            {rowIndex < rows.length - 1 && (
              <Box height={1} backgroundColor="separator" />
            )}
          </Box>
        ))}

        <Box flexDirection="row" alignItems="center" gap="s" marginTop="s">
          <MaterialCommunityIcons
            name="alert-outline"
            size={16}
            color={theme.colors.warning}
          />
          <Text variant="caption-md" color="textSecondary" flex={1}>
            {consequence}
          </Text>
        </Box>
      </Box>
    </>
  );
};

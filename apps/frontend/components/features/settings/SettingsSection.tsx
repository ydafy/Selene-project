import { Box, Text } from '../../base';

type SettingsSectionProps = {
  title: string;
  children: React.ReactNode;
};

/**
 * Visual grouping for settings rows: header + rounded card with rows inside.
 */
export const SettingsSection = ({ title, children }: SettingsSectionProps) => {
  return (
    <Box marginBottom="l">
      <Text
        variant="caption-md"
        color="textSecondary"
        marginHorizontal="m"
        marginBottom="s"
        style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}
      >
        {title}
      </Text>
      <Box
        marginHorizontal="m"
        backgroundColor="cardBackground"
        borderRadius="l"
        overflow="hidden"
      >
        {children}
      </Box>
    </Box>
  );
};

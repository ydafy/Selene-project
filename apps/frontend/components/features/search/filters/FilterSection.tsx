import { Box, Text } from '../../../base';
import { AppChip } from '../../../ui/AppChip';

type FilterSectionProps = {
  title: string;
  options: string[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

export const FilterSection = ({
  title,
  options,
  selectedValues,
  onToggle,
}: FilterSectionProps) => {
  return (
    <Box marginBottom="xl">
      <Text
        variant="subheader-md"
        color="primary"
        style={{ textTransform: 'uppercase', letterSpacing: 1 }}
        marginBottom="m"
      >
        {title}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" gap="s">
        {options.map((option) => {
          const isSelected = selectedValues.includes(option);
          return (
            <AppChip
              key={option}
              label={option}
              selected={isSelected}
              showSelectedCheck={false}
              backgroundColor={isSelected ? 'primary' : 'background'}
              textColor={isSelected ? 'background' : 'textPrimary'}
              onPress={() => onToggle(option)}
            />
          );
        })}
      </Box>
    </Box>
  );
};

import { Box, Text } from '../../components/base';
import { ScreenLayout } from '../../components/layout/ScreenLayout';

export default function SearchScreen() {
  return (
    <ScreenLayout>
      <Box flex={1} justifyContent="center" alignItems="center">
        <Text variant="header-xl">Search Screen</Text>
      </Box>
    </ScreenLayout>
  );
}

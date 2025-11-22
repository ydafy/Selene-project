import { Box, Text } from '../../components/base';
import { ScreenLayout } from '../../components/layout/ScreenLayout';

export default function CartScreen() {
  return (
    <ScreenLayout>
      <Box flex={1} justifyContent="center" alignItems="center">
        <Text variant="header-xl">Cart Screen</Text>
      </Box>
    </ScreenLayout>
  );
}

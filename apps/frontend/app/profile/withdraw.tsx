import { Stack, useRouter } from 'expo-router';

import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../components/layout/GlobalHeader';

export default function WithdrawDeprecatedScreen() {
  const router = useRouter();

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title="Withdrawals disabled" showBack />
      <Box flex={1} padding="l" justifyContent="center">
        <Text variant="header-xl" marginBottom="m" textAlign="center">
          Manual withdrawals are no longer available
        </Text>
        <Text variant="body-md" color="textSecondary" textAlign="center" marginBottom="xl">
          Stripe Connect now pays sellers automatically. Legacy payout requests
          are preserved only as historical audit records.
        </Text>
        <PrimaryButton onPress={() => router.back()}>Back</PrimaryButton>
      </Box>
    </Box>
  );
}

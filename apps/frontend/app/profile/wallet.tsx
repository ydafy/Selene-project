import { Stack, useRouter } from 'expo-router';

import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../components/layout/GlobalHeader';

export default function WalletDeprecatedScreen() {
  const router = useRouter();

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title="Wallet disabled" showBack />
      <Box flex={1} padding="l" justifyContent="center">
        <Text variant="header-xl" marginBottom="m" textAlign="center">
          Stripe Connect handles seller payouts
        </Text>
        <Text variant="body-md" color="textSecondary" textAlign="center" marginBottom="xl">
          The legacy Selene wallet is now read-only during the Connect cutover.
          Sellers manage payouts from their Stripe Express dashboard.
        </Text>
        <PrimaryButton onPress={() => router.back()}>Back to profile</PrimaryButton>
      </Box>
    </Box>
  );
}

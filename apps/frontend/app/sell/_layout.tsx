import { Stack } from 'expo-router';

import { useExitGuard } from '../../core/hooks/useExitGuard';
import { useSellStore } from '../../core/store/useSellStore';
import { isSellDraftDirty } from '../../core/utils/sellDraftDirty';

export default function SellLayout() {
  const draft = useSellStore((state) => state.draft);
  const { ExitDialog } = useExitGuard(isSellDraftDirty(draft));

  return (
    <>
      <Stack screenOptions={{ presentation: 'modal', headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
      </Stack>
      <ExitDialog />
    </>
  );
}

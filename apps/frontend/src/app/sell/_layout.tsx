import { Stack } from 'expo-router';

import { useExitGuard } from '../../shared/hooks/use-exit-guard';
import { useSellStore } from '../../core/store/useSellStore';
import { isSellDraftDirty } from '../../core/utils/sellDraftDirty';

export default function SellLayout() {
  const draft = useSellStore((state) => state.draft);
  const resetDraft = useSellStore((state) => state.resetDraft);
  const { ExitDialog } = useExitGuard({
    enabled: isSellDraftDirty(draft),
    onDiscard: resetDraft,
  });

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

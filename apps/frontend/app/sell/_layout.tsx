import { Stack } from 'expo-router';

export default function SellLayout() {
  return (
    <Stack screenOptions={{ presentation: 'modal', headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

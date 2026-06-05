import { ScrollView } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useProfile } from '../../core/hooks/useProfile';
import { AccountSection } from '../../components/features/settings/AccountSection';
import { GeneralSection } from '../../components/features/settings/GeneralSection';
import { SecuritySection } from '../../components/features/settings/SecuritySection';
import { DeleteAccountSection } from '../../components/features/settings/DeleteAccountSection';
import { SettingsSection } from '../../components/features/settings/SettingsSection';

export default function SettingsScreen() {
  const { t } = useTranslation('settings');
  const { session, loading } = useAuthContext();
  const insets = useSafeAreaInsets();

  // Block screen until session resolves. Prevents skeleton flicker
  // during AsyncStorage read + redirect bounce for logged-out users.
  if (loading) return null;
  if (!session) return <Redirect href="/(tabs)/profile" />;

  const userId = session.user.id;
  const { data: profile, isLoading: isLoadingProfile } = useProfile(userId);

  return (
    <ScreenLayout disableSafeArea>
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title={t('title')} showBack />

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 80,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title={t('sections.account')}>
          {isLoadingProfile || !profile ? (
            <Box padding="m">
              <Skeleton width="60%" height={16} borderRadius={4} />
              <Box height={8} />
              <Skeleton width="40%" height={12} borderRadius={4} />
            </Box>
          ) : (
            <AccountSection
              userId={userId}
              username={profile.username}
              isLoading={isLoadingProfile}
            />
          )}
        </SettingsSection>

        <SettingsSection title={t('sections.general')}>
          <GeneralSection />
        </SettingsSection>

        <SettingsSection title={t('sections.security')}>
          <SecuritySection />
        </SettingsSection>

        <SettingsSection title={t('sections.privacy')}>
          <DeleteAccountSection />
        </SettingsSection>
      </ScrollView>
    </ScreenLayout>
  );
}

import { ScrollView } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { AccountSection } from '../../components/features/settings/AccountSection';
import { SecuritySection } from '../../components/features/settings/SecuritySection';
import { DeleteAccountSection } from '../../components/features/settings/DeleteAccountSection';
import { LegalesSection } from '../../components/features/settings/LegalesSection';
import { SoporteSection } from '../../components/features/settings/SoporteSection';
import { SettingsSection } from '../../components/features/settings/SettingsSection';

export default function SettingsScreen() {
  const { t } = useTranslation('settings');
  const { session, loading } = useAuthContext();
  const insets = useSafeAreaInsets();

  // Block screen until session resolves. Prevent skeleton flicker + hook mismatch.
  if (loading) return null;
  if (!session) return <Redirect href="/(tabs)/profile" />;

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
          <AccountSection email={session.user.email} />
        </SettingsSection>

        <SettingsSection title={t('sections.security')}>
          <SecuritySection />
        </SettingsSection>

        <SettingsSection title={t('sections.privacy')}>
          <DeleteAccountSection />
        </SettingsSection>

        <SettingsSection title={t('sections.legal')}>
          <LegalesSection />
        </SettingsSection>

        <SettingsSection title={t('sections.support')}>
          <SoporteSection />
        </SettingsSection>
      </ScrollView>
    </ScreenLayout>
  );
}

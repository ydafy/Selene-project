import { ScrollView } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlobalHeader } from '../../shared/ui/global-header';
import { ScreenLayout } from '../../shared/ui/screen-layout';
import { useAuthContext } from '../../shared/lib/auth/auth-provider';
import { AccountSection } from '../../features/settings/components/account-section';
import { SecuritySection } from '../../features/settings/components/security-section';
import { NotificationsSection } from '../../features/notifications/components/notifications-section';
import { DeleteAccountSection } from '../../features/settings/components/delete-account-section';
import { LegalesSection } from '../../features/settings/components/legales-section';
import { SoporteSection } from '../../features/settings/components/soporte-section';
import { SettingsSection } from '../../features/settings/components/settings-section';

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

        <SettingsSection title={t('sections.notifications')}>
          <NotificationsSection />
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

import { useTranslation } from 'react-i18next';

import { useAuthContext } from '../../auth/AuthProvider';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { pushRegistrar } from '../../../core/push/pushRegistration';
import {
  pushPermissionPrompt,
  usePushPromptStore,
} from '../../../core/push/pushPermission';
import type { PushPermissionMoment } from '../../../core/push/pushPermission.logic';

const COPY: Record<PushPermissionMoment, { title: string; body: string }> = {
  purchase: {
    title: 'permission.purchaseTitle',
    body: 'permission.purchaseBody',
  },
  favorite: {
    title: 'permission.favoriteTitle',
    body: 'permission.favoriteBody',
  },
  listing: { title: 'permission.listingTitle', body: 'permission.listingBody' },
};

/** Pre-prompt that explains the value of push before the one-time OS dialog. */
export const PushPermissionPrompt = () => {
  const { t } = useTranslation('notifications');
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const moment = usePushPromptStore((state) => state.moment);

  if (!moment) return null;

  const close = () => usePushPromptStore.setState({ moment: null });
  const accept = () => {
    close();
    void pushPermissionPrompt.request().then((granted) => {
      // Register now instead of waiting for the next foreground.
      if (granted && userId) void pushRegistrar.register(userId);
    });
  };

  return (
    <ConfirmDialog
      visible
      title={t(COPY[moment].title)}
      description={t(COPY[moment].body)}
      onConfirm={accept}
      onCancel={close}
      confirmLabel={t('permission.confirm')}
      cancelLabel={t('permission.cancel')}
      icon="bell-outline"
    />
  );
};

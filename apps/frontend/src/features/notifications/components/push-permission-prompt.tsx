import { useTranslation } from 'react-i18next';

import { useAuthContext } from '@/shared/lib/auth/auth-provider';
import { ConfirmDialog } from '@/shared/ui/feedback/confirm-dialog';
import { pushRegistrar } from '../lib/push-registration';
import {
  closePushPermission,
  pushPermissionPrompt,
  usePushPromptStore,
} from '../lib/push-permission';
import type { PushPermissionMoment } from '../logic/push-permission.logic';

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

  const close = closePushPermission;
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

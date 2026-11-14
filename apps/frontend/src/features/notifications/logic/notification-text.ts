import { z } from 'zod';
import type { Notification } from '@selene/types';
import { getVerifiedEventIdentity } from './notification-presentation';

type Translate = (key: string, values?: Record<string, unknown>) => string;
/** Formats integer cents as a currency string for the active locale. */
type FormatAmount = (cents: number) => string;

type NotificationText = { title: string; message: string | null };
type Kind = NonNullable<ReturnType<typeof getVerifiedEventIdentity>>['kind'];
type Resolver = (
  payload: unknown,
  t: Translate,
  formatAmount: FormatAmount,
) => NotificationText | null;

// Matches the reasons fn_notify_held_payouts notifies about; the bank codes share one sentence.
const payoutBlockedMessageKey = {
  onboarding_rejected: 'onboardingRejected',
  onboarding_pending: 'onboardingPending',
  payouts_disabled: 'payoutsDisabled',
  errored: 'bankAccount',
  verification_failed: 'bankAccount',
  tokenized_account_number_deactivated: 'bankAccount',
} as const;

const payoutBlockedPayload = z.object({
  amount_cents: z.number().int().nonnegative(),
  currency: z.literal('mxn'),
  block_reason: z.enum(
    Object.keys(payoutBlockedMessageKey) as [
      keyof typeof payoutBlockedMessageKey,
      ...(keyof typeof payoutBlockedMessageKey)[],
    ],
  ),
  is_reminder: z.boolean(),
});

// Kinds opt in here; every other kind keeps the stored server copy (#52).
const resolvers: Partial<Record<Kind, Resolver>> = {
  'shipment.payout_blocked': (payload, t, formatAmount) => {
    const parsed = payoutBlockedPayload.safeParse(payload);
    if (!parsed.success) return null;
    const { amount_cents, block_reason, is_reminder } = parsed.data;
    return {
      title: t(
        is_reminder
          ? 'notifications:payoutBlocked.reminderTitle'
          : 'notifications:payoutBlocked.title',
      ),
      message: t(
        `notifications:payoutBlocked.messages.${payoutBlockedMessageKey[block_reason]}`,
        { amount: formatAmount(amount_cents) },
      ),
    };
  },
};

/** Localized title and message for opted-in kinds; the stored text otherwise or when the payload is malformed. */
export function getNotificationText(
  notification: Notification,
  t: Translate,
  formatAmount: FormatAmount,
): NotificationText {
  const identity = getVerifiedEventIdentity(notification);
  const resolver = identity ? resolvers[identity.kind] : undefined;
  return (
    resolver?.(notification.event_payload, t, formatAmount) ?? {
      title: notification.title,
      message: notification.message,
    }
  );
}

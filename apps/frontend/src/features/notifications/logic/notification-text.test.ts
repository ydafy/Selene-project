import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import type { Notification } from '@selene/types';
import en from '@/shared/i18n/locales/en/notifications.json';
import es from '@/shared/i18n/locales/es/notifications.json';
import { formatCentsWithLocale } from '@/shared/utils/money/format-cents-with-locale';
import { getNotificationText } from './notification-text';

const storedTitle = 'No podemos enviarte el pago de una venta';
const storedMessage =
  'Stripe rechazó tu cuenta de cobro. Revisa tu configuración de pagos para recibir $1,234.50 MXN.';

const blocked = (payload: Record<string, unknown>): Notification => ({
  id: 'n',
  user_id: 'u',
  created_at: '2026-11-13',
  deleted_at: null,
  title: storedTitle,
  message: storedMessage,
  type: 'warning',
  read: false,
  action_path: '/sell/onboarding',
  event_kind: 'shipment.payout_blocked',
  source_event_key: 'shipment.payout_blocked:ship-1:0',
  event_payload: {
    order_id: 'order-1',
    shipment_id: 'ship-1',
    amount_cents: 123450,
    currency: 'mxn',
    recipient_role: 'seller',
    block_reason: 'onboarding_rejected',
    reminder_stage: 0,
    is_reminder: false,
    ...payload,
  },
});

async function translator(lng: 'es' | 'en') {
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    resources: { es: { notifications: es }, en: { notifications: en } },
    ns: ['notifications'],
    defaultNS: 'notifications',
    interpolation: { escapeValue: false },
  });
  const locale = lng === 'es' ? 'es-MX' : 'en-US';
  return {
    t: instance.t.bind(instance) as (
      key: string,
      values?: Record<string, unknown>,
    ) => string,
    formatAmount: (cents: number) => formatCentsWithLocale(cents, locale),
  };
}

describe('localized notification text for shipment.payout_blocked', () => {
  test('Spanish text matches the stored copy for every reason and stage', async () => {
    const { t, formatAmount } = await translator('es');
    const cases = [
      ['onboarding_rejected', 'Stripe rechazó tu cuenta de cobro.'],
      [
        'onboarding_pending',
        'Stripe necesita más datos de tu cuenta de cobro.',
      ],
      ['payouts_disabled', 'Stripe pausó los pagos a tu cuenta.'],
      ['errored', 'Tu cuenta bancaria tiene un problema.'],
      ['verification_failed', 'Tu cuenta bancaria tiene un problema.'],
      [
        'tokenized_account_number_deactivated',
        'Tu cuenta bancaria tiene un problema.',
      ],
    ] as const;
    for (const [reason, sentence] of cases) {
      expect(
        getNotificationText(blocked({ block_reason: reason }), t, formatAmount),
      ).toEqual({
        title: 'No podemos enviarte el pago de una venta',
        message: `${sentence} Revisa tu configuración de pagos para recibir $1,234.50 MXN.`,
      });
    }
    expect(
      getNotificationText(
        blocked({ is_reminder: true, reminder_stage: 7 }),
        t,
        formatAmount,
      ).title,
    ).toBe('Tu pago sigue retenido');
  });

  test('English text is built from the payload, not the stored Spanish', async () => {
    const { t, formatAmount } = await translator('en');
    expect(getNotificationText(blocked({}), t, formatAmount)).toEqual({
      title: "We can't send you the payment for a sale",
      message:
        'Stripe rejected your payout account. Check your payment setup to receive MX$1,234.50.',
    });
    expect(
      getNotificationText(
        blocked({
          is_reminder: true,
          reminder_stage: 14,
          block_reason: 'errored',
          amount_cents: 5,
        }),
        t,
        formatAmount,
      ),
    ).toEqual({
      title: 'Your payment is still on hold',
      message:
        'There is a problem with your bank account. Check your payment setup to receive MX$0.05.',
    });
    for (const reason of ['onboarding_pending', 'payouts_disabled']) {
      const { message } = getNotificationText(
        blocked({ block_reason: reason }),
        t,
        formatAmount,
      );
      expect(message).toStartWith('Stripe ');
      expect(message).toEndWith(
        'Check your payment setup to receive MX$1,234.50.',
      );
    }
  });

  test('a malformed payload falls back to the stored title and message', async () => {
    const { t, formatAmount } = await translator('en');
    const stored = { title: storedTitle, message: storedMessage };
    for (const payload of [
      { block_reason: undefined },
      { block_reason: 'payouts_schedule_not_manual' },
      { block_reason: 7 },
      { amount_cents: 12.5 },
      { amount_cents: '123450' },
      { amount_cents: -1 },
      { amount_cents: undefined },
      { is_reminder: 'yes' },
      { is_reminder: undefined },
      { currency: 'usd' },
    ]) {
      expect(getNotificationText(blocked(payload), t, formatAmount)).toEqual(
        stored,
      );
    }
    for (const overrides of [
      { event_payload: [] },
      { event_payload: null },
      { source_event_key: 'other:ship-1:0' },
      {
        event_payload: {
          ...(blocked({}).event_payload as object),
          recipient_role: 'buyer',
        },
      },
    ]) {
      expect(
        getNotificationText(
          Object.assign(blocked({}), overrides),
          t,
          formatAmount,
        ),
      ).toEqual(stored);
    }
  });

  test('other kinds keep the stored title and message, including a null message', async () => {
    const { t, formatAmount } = await translator('en');
    const other = Object.assign(blocked({}), {
      event_kind: 'shipment.funds_released',
      source_event_key: 'shipment.funds_released:ship-1',
      title: 'Liberamos tu pago',
      message: null,
    });
    expect(getNotificationText(other, t, formatAmount)).toEqual({
      title: 'Liberamos tu pago',
      message: null,
    });
  });
});

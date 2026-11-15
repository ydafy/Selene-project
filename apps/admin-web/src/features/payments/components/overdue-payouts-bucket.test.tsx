import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverduePayoutsBucket } from './overdue-payouts-bucket';
import { OverduePayoutCard } from './overdue-payout-card';
import type { OverduePayout } from '../logic/connect-payout-release-queue';
import {
  holdNoteErrorMessage,
  overdueRefundErrorMessage,
} from '../logic/overdue-payouts';

const rejected: OverduePayout = {
  shipmentId: '7b310000-0000-4000-8000-000000000011',
  orderId: '7b320000-0000-4000-8000-000000000011',
  sellerId: 'seller-1',
  sellerName: 'aurora',
  stripeAccountId: 'acct_1',
  sellerPayoutBlockReason: 'onboarding_rejected',
  daysSinceCompleted: 41,
  completedAt: '2026-10-04T10:00:00.000Z',
  heldAmountCents: 251000,
  latestHoldNote: null,
};
const disabled: OverduePayout = {
  ...rejected,
  shipmentId: '7b310000-0000-4000-8000-000000000022',
  sellerId: 'seller-2',
  sellerName: 'boris',
  sellerPayoutBlockReason: 'payouts_disabled',
  daysSinceCompleted: 30,
  latestHoldNote: {
    note: 'Stripe sigue revisando la cuenta.',
    notedAt: '2026-11-14T05:27:34.123Z',
    notedBy: '00000000-0000-4000-8000-000000000001',
  },
};

type Element = React.ReactElement<Record<string, unknown>>;
function nodes(value: React.ReactNode): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  // The card is a pure component; expand it so its buttons are reachable.
  if (value.type === OverduePayoutCard)
    return nodes(
      OverduePayoutCard(
        value.props as unknown as Parameters<typeof OverduePayoutCard>[0],
      ),
    );
  return [value, ...nodes(value.props.children as React.ReactNode)];
}
function label(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(label).join('');
  return React.isValidElement<Record<string, unknown>>(value)
    ? label(value.props.children as React.ReactNode)
    : '';
}
function harness(overrides: Record<string, unknown> = {}) {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  spyOn(React, 'useState').mockImplementation(((initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (next: unknown) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
      },
    ];
  }) as typeof React.useState);
  spyOn(React, 'useRef').mockImplementation(((initial: unknown) => {
    const index = refIndex++;
    refs[index] ??= { current: initial };
    return refs[index];
  }) as typeof React.useRef);
  const notes: Array<[string, string]> = [];
  const refunds: string[] = [];
  const props = {
    payouts: [rejected, disabled],
    isLoading: false,
    onRecordHoldNote: async (shipmentId: string, note: string) => {
      notes.push([shipmentId, note]);
    },
    onRefund: async (shipmentId: string) => {
      refunds.push(shipmentId);
      return {
        status: 'refunded',
        shipmentId,
        refundId: 're_1',
        amountCents: 10600,
      };
    },
    ...overrides,
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return OverduePayoutsBucket(
      props as Parameters<typeof OverduePayoutsBucket>[0],
    );
  };
  const html = () => renderToStaticMarkup(render());
  const buttons = (text: string) =>
    nodes(render()).filter(
      (n) =>
        n.type === 'button' &&
        label(n.props.children as React.ReactNode) === text,
    );
  const button = (text: string) => buttons(text)[0];
  const click = async (text: string, index = 0) => {
    const found = buttons(text)[index];
    expect(found, `Missing button: ${text}`).toBeDefined();
    await (found!.props.onClick as () => unknown)();
  };
  const type = (value: string) => {
    const input = nodes(render()).find((n) => n.type === 'textarea')!;
    expect(input).toBeDefined();
    (input.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value },
    });
  };
  return { render, html, button, buttons, click, type, notes, refunds };
}
afterEach(() => mock.restore());

it('shows a loading state and an empty state, never invented rows', () => {
  const loading = harness({ isLoading: true }).html();
  expect(loading).toContain('Consultando pagos vencidos');
  expect(loading).not.toContain('aurora');
  const empty = harness({ payouts: [] }).html();
  expect(empty).toContain('Ningún pago vencido');
});

it('shows the block reason, days held, held amount and the latest hold note of each shipment', () => {
  const html = harness().html();
  expect(html).toContain('Pagos vencidos');
  expect(html).toContain('@aurora');
  expect(html).toContain('Stripe rechazó el registro del vendedor');
  expect(html).toContain('Retenido hace 41 días');
  expect(html).toContain('$2,510');
  expect(html).toContain('Sin notas todavía');
  expect(html).toContain('Stripe deshabilitó los pagos');
  expect(html).toContain('Retenido hace 30 días');
  expect(html).toContain('Stripe sigue revisando la cuenta.');
  expect(html).toContain('00000000');
  expect(html).toContain('2026-11-14T05:27:34.123Z');
});

it('shows the server count of sellers with overdue payouts', () => {
  const html = harness({
    pagination: { page: 0, totalGroups: 21 },
    onPageChange: () => undefined,
  }).html();
  expect(html).toContain('21 vendedores con pagos retenidos 30 días o más');
  expect(
    harness({
      payouts: [rejected],
      pagination: { page: 0, totalGroups: 1 },
    }).html(),
  ).toContain('1 vendedor con pagos retenidos 30 días o más');
  expect(html).toContain('Página 1 de 2');
});

it('offers the refund only when Stripe rejected the seller registration', () => {
  const h = harness();
  expect(h.buttons('Seguir reteniendo')).toHaveLength(2);
  expect(h.buttons('Reembolsar al comprador')).toHaveLength(1);
  const only = harness({ payouts: [disabled] });
  expect(only.buttons('Reembolsar al comprador')).toHaveLength(0);
});

it('requires a 1-1000 character note and shows a counter before sending', async () => {
  const h = harness();
  await h.click('Seguir reteniendo');
  let html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain('0/1000');
  h.type('   ');
  await h.click('Guardar nota');
  expect(h.notes).toEqual([]);
  expect(h.html()).toContain(holdNoteErrorMessage('INVALID_HOLD_NOTE'));
  h.type('a'.repeat(1001));
  html = h.html();
  expect(html).toContain('1001/1000');
  await h.click('Guardar nota');
  expect(h.notes).toEqual([]);
});

it('sends the trimmed note for that shipment and closes the dialog', async () => {
  const h = harness();
  await h.click('Seguir reteniendo');
  h.type('  Stripe sigue revisando.  ');
  expect(h.html()).toContain('23/1000');
  await h.click('Guardar nota');
  expect(h.notes).toEqual([[rejected.shipmentId, 'Stripe sigue revisando.']]);
  expect(h.html()).not.toContain('<dialog');
});

it('keeps the note dialog open with a mapped message and allows a retry', async () => {
  for (const code of [
    'PAYOUT_NOT_OVERDUE',
    'INVALID_HOLD_NOTE',
    'ADMIN_ONLY',
    'INTERNAL_ERROR',
  ]) {
    const h = harness({
      onRecordHoldNote: async () => {
        throw Object.assign(new Error('x'), { code });
      },
    });
    await h.click('Seguir reteniendo');
    h.type('Nota');
    await h.click('Guardar nota');
    const html = h.html();
    expect(html).toContain('<dialog');
    expect(html).toContain(holdNoteErrorMessage(code));
    expect(h.button('Guardar nota')?.props.disabled).not.toBe(true);
  }
});

it('sends one note on a double click', async () => {
  let finish: () => void = () => undefined;
  const calls: string[] = [];
  const h = harness({
    onRecordHoldNote: (id: string) => {
      calls.push(id);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  await h.click('Seguir reteniendo');
  h.type('Nota');
  const save = h.button('Guardar nota')!.props.onClick as () => Promise<void>;
  const first = save();
  const second = save();
  expect(calls).toHaveLength(1);
  expect(h.button('Guardando...')?.props.disabled).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(calls).toHaveLength(1);
});

it('explains the refund plainly before sending anything, and sends only the shipment id', async () => {
  const h = harness();
  await h.click('Reembolsar al comprador');
  const html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain('lo que pagó por este envío');
  expect(html).toContain(
    'Selene absorbe el envío que ya pagó y la comisión de Stripe',
  );
  expect(html).toContain('No se puede deshacer');
  expect(html).toContain('El servidor calcula el monto');
  expect(h.refunds).toEqual([]);
  await h.click('Confirmar reembolso');
  expect(h.refunds).toEqual([rejected.shipmentId]);
});

it('shows a refunded outcome with the amount the server refunded', async () => {
  const h = harness();
  await h.click('Reembolsar al comprador');
  await h.click('Confirmar reembolso');
  const html = h.html();
  expect(html).toContain('Reembolso hecho');
  expect(html).toContain('$106');
  expect(h.buttons('Confirmar reembolso')).toHaveLength(0);
  await h.click('Cerrar');
  expect(h.html()).not.toContain('<dialog');
});

it('shows a 202 as pending in Stripe and never offers to send it again', async () => {
  const h = harness({
    onRefund: async (shipmentId: string) => ({
      status: 'pending',
      shipmentId,
      refundId: 're_p',
      amountCents: 10600,
    }),
  });
  await h.click('Reembolsar al comprador');
  await h.click('Confirmar reembolso');
  const html = h.html();
  expect(html).toContain('pendiente en Stripe');
  expect(html).toContain('$106');
  expect(html).not.toContain('Reembolso hecho');
  expect(h.buttons('Confirmar reembolso')).toHaveLength(0);
});

it('explains a failed Stripe refund, points to the manual repayment, and blocks a second try', async () => {
  const h = harness({
    onRefund: async () => {
      throw Object.assign(new Error('x'), { code: 'REFUND_FAILED' });
    },
  });
  await h.click('Reembolsar al comprador');
  await h.click('Confirmar reembolso');
  const html = h.html();
  expect(html).toContain(
    overdueRefundErrorMessage('REFUND_FAILED').replaceAll('>', '&gt;'),
  );
  expect(html).toContain('Reembolsos con problemas');
  expect(h.buttons('Confirmar reembolso')).toHaveLength(0);
});

it('maps other refusals to specific messages and keeps a retry for them', async () => {
  for (const code of [
    'REFUND_IN_PROGRESS',
    'SELLER_ACCOUNT_NOT_REJECTED',
    'PAYMENT_METHOD_NOT_REFUNDABLE',
    'PAYOUT_NOT_OVERDUE',
    'INTERNAL_ERROR',
  ]) {
    const h = harness({
      onRefund: async () => {
        throw Object.assign(new Error('x'), { code });
      },
    });
    await h.click('Reembolsar al comprador');
    await h.click('Confirmar reembolso');
    expect(h.html()).toContain(overdueRefundErrorMessage(code));
    expect(h.buttons('Confirmar reembolso')).toHaveLength(1);
  }
});

it('sends one refund on a double click and disables the confirmation while pending', async () => {
  let finish: (value: unknown) => void = () => undefined;
  const calls: string[] = [];
  const h = harness({
    onRefund: (id: string) => {
      calls.push(id);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await h.click('Reembolsar al comprador');
  const confirm = h.button('Confirmar reembolso')!.props
    .onClick as () => Promise<void>;
  const first = confirm();
  const second = confirm();
  expect(calls).toHaveLength(1);
  expect(h.button('Reembolsando...')?.props.disabled).toBe(true);
  expect(h.button('Cancelar')?.props.disabled).toBe(true);
  finish({
    status: 'refunded',
    shipmentId: rejected.shipmentId,
    refundId: 're_1',
    amountCents: 10600,
  });
  await Promise.all([first, second]);
  expect(calls).toHaveLength(1);
});

it('disables both actions while another overdue action is running', () => {
  const h = harness({ isBusy: true });
  for (const text of ['Seguir reteniendo', 'Reembolsar al comprador'])
    for (const found of h.buttons(text))
      expect(found.props.disabled).toBe(true);
});

import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RefundProblemsBucket } from './RefundProblemsBucket';
import { resolveRefundErrorMessage, type RefundProblem } from '../../../lib/shipmentRefundProblems';

const base: RefundProblem = {
  shipmentId: '11111111-aaaa-bbbb-cccc-000000000001',
  orderId: '22222222-aaaa-bbbb-cccc-000000000001',
  buyerId: 'buyer-1',
  shipmentStatus: 'cancelled',
  kind: 'refund_failed',
  refundId: 're_failed_1',
  refundFailureReason: 'expired_or_canceled_card',
  amountOwedCents: 123456,
  paymentIntentId: 'pi_1',
  since: '2026-10-22T10:00:00.000Z',
};
const KIND_LABELS = {
  refund_failed: 'Reembolso fallido',
  refund_canceled: 'Reembolso cancelado',
  refund_not_found: 'Reembolso no encontrado',
  refund_ambiguous: 'Reembolso ambiguo',
} as const;

type Element = React.ReactElement<Record<string, unknown>>;
function nodes(value: React.ReactNode): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children as React.ReactNode)];
}
function label(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
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
    return [states[index], (next: unknown) => {
      states[index] = typeof next === 'function' ? next(states[index]) : next;
    }];
  }) as typeof React.useState);
  spyOn(React, 'useRef').mockImplementation(((initial: unknown) => {
    const index = refIndex++;
    refs[index] ??= { current: initial };
    return refs[index];
  }) as typeof React.useRef);
  const resolved: Array<[string, string]> = [];
  const props = {
    problems: [base],
    isLoading: false,
    isError: false,
    isResolving: false,
    onRetry: () => undefined,
    onResolve: async (shipmentId: string, reference: string) => {
      resolved.push([shipmentId, reference]);
    },
    ...overrides,
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return RefundProblemsBucket(props as Parameters<typeof RefundProblemsBucket>[0]);
  };
  const html = () => renderToStaticMarkup(render());
  const button = (text: string) =>
    nodes(render()).find((n) => n.type === 'button' && label(n.props.children as React.ReactNode) === text);
  const click = async (text: string) => {
    const found = button(text);
    expect(found, `Missing button: ${text}`).toBeDefined();
    await (found!.props.onClick as () => unknown)();
  };
  const type = (value: string) => {
    const input = nodes(render()).find((n) => n.type === 'input')!;
    expect(input).toBeDefined();
    (input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } });
  };
  return { render, html, button, click, type, resolved };
}
afterEach(() => mock.restore());

it('does not claim empty or show rows while loading', () => {
  const h = harness({ isLoading: true });
  const html = h.html();
  expect(html).toContain('Consultando reembolsos con problema');
  expect(html).not.toContain('Ningún reembolso pendiente');
  expect(html).not.toContain('re_failed_1');
});

it('shows an error state, never empty or partial rows, and wires the retry', () => {
  const onRetry = () => undefined;
  const h = harness({ isError: true, onRetry });
  const html = h.html();
  expect(html).toContain('Error al cargar reembolsos');
  expect(html).not.toContain('Ningún reembolso pendiente');
  expect(html).not.toContain('re_failed_1');
  expect(nodes(h.render()).some((n) => n.props.onRetry === onRetry)).toBe(true);
});

it('shows the empty state only when resolved with no problems', () => {
  const html = harness({ problems: [] }).html();
  expect(html).toContain('Ningún reembolso pendiente');
  expect(html).not.toContain('Consultando reembolsos');
});

it('renders the label of every kind', () => {
  for (const [kind, text] of Object.entries(KIND_LABELS)) {
    expect(harness({ problems: [{ ...base, kind }] }).html()).toContain(text);
  }
});

it('renders the row fields from integer cents', () => {
  const html = harness().html();
  expect(html).toContain('1,234.56');
  expect(html).toContain('11111111');
  expect(html).toContain('22222222');
  expect(html).toContain('re_failed_1');
  expect(html).toContain('expired or canceled card');
  expect(html).toContain('2026-10-22T10:00:00.000Z');
  expect(html).toContain('cancelled');
  expect(html).toContain('Marcar resuelto');
});

it('omits the refund id and reason when the server has none', () => {
  const html = harness({
    problems: [{ ...base, kind: 'refund_not_found', refundId: null, refundFailureReason: null }],
  }).html();
  expect(html).toContain('Reembolso no encontrado');
  expect(html).not.toContain('Reembolso Stripe');
  expect(html).not.toContain('Motivo');
});

it('opens a confirmation that explains the external repayment, without calling the server', async () => {
  const h = harness();
  expect(h.html()).not.toContain('<dialog');
  await h.click('Marcar resuelto');
  const html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain('fuera de Stripe');
  expect(html).toContain('se cancelará');
  expect(h.resolved).toEqual([]);
});

it('requires a reference before sending anything', async () => {
  const h = harness();
  await h.click('Marcar resuelto');
  h.type('   ');
  await h.click('Confirmar resolución');
  expect(h.resolved).toEqual([]);
  expect(h.html()).toContain(resolveRefundErrorMessage('INVALID_RESOLUTION_REFERENCE'));
  h.type('a'.repeat(201));
  await h.click('Confirmar resolución');
  expect(h.resolved).toEqual([]);
});

it('sends the exact shipment and trimmed reference, then closes the confirmation', async () => {
  const h = harness();
  await h.click('Marcar resuelto');
  h.type('  SPEI-998877  ');
  await h.click('Confirmar resolución');
  expect(h.resolved).toEqual([[base.shipmentId, 'SPEI-998877']]);
  expect(h.html()).not.toContain('<dialog');
});

it('dispatches once on a double click and disables the confirmation while pending', async () => {
  let finish: () => void = () => undefined;
  const calls: string[] = [];
  const h = harness({
    onResolve: (shipmentId: string) => {
      calls.push(shipmentId);
      return new Promise<void>((resolve) => { finish = resolve; });
    },
  });
  await h.click('Marcar resuelto');
  h.type('SPEI-1');
  const confirm = h.button('Confirmar resolución')!.props.onClick as () => Promise<void>;
  const first = confirm();
  const second = confirm();
  expect(calls).toHaveLength(1);
  expect(h.button('Confirmando...')?.props.disabled).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(calls).toHaveLength(1);
});

it('disables the confirmation while the mutation is pending', async () => {
  const h = harness({ isResolving: true });
  await h.click('Marcar resuelto');
  expect(h.button('Confirmando...')?.props.disabled).toBe(true);
});

it('keeps the confirmation open with a mapped message on server errors and allows a retry', async () => {
  let fail = true;
  const calls: string[] = [];
  const h = harness({
    onResolve: async (_id: string, reference: string) => {
      calls.push(reference);
      if (fail) throw Object.assign(new Error('boom'), { code: 'REFUND_NOT_RESOLVABLE' });
    },
  });
  await h.click('Marcar resuelto');
  h.type('SPEI-1');
  await h.click('Confirmar resolución');
  let html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain(resolveRefundErrorMessage('REFUND_NOT_RESOLVABLE'));
  expect(html).toContain('SPEI-1');
  fail = false;
  await h.click('Confirmar resolución');
  expect(calls).toEqual(['SPEI-1', 'SPEI-1']);
  html = h.html();
  expect(html).not.toContain('<dialog');
});

it('maps each stable code and falls back to a generic message', async () => {
  for (const code of ['SHIPMENT_STATUS_UNEXPECTED', 'INVALID_RESOLUTION_REFERENCE', 'ADMIN_ONLY', 'INTERNAL_ERROR']) {
    const h = harness({
      onResolve: async () => { throw Object.assign(new Error('x'), { code }); },
    });
    await h.click('Marcar resuelto');
    h.type('SPEI-1');
    await h.click('Confirmar resolución');
    expect(h.html()).toContain(resolveRefundErrorMessage(code).replaceAll("'", '&#x27;'));
  }
  const h = harness({ onResolve: async () => { throw new Error('network'); } });
  await h.click('Marcar resuelto');
  h.type('SPEI-1');
  await h.click('Confirmar resolución');
  expect(h.html()).toContain(resolveRefundErrorMessage(null));
});

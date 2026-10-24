import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CarrierReviewsBucket } from './CarrierReviewsBucket';
import { resolveCarrierReviewErrorMessage, type CarrierReview } from '../../../lib/carrierReviews';

const base: CarrierReview = {
  shipmentId: '11111111-aaaa-bbbb-cccc-000000000001',
  orderId: '22222222-aaaa-bbbb-cccc-000000000001',
  sellerId: '33333333-aaaa-bbbb-cccc-000000000001',
  trackingNumber: 'TRK-998877',
  carrier: 'fedex',
  labelCostCents: 123456,
  reason: 'carrier_refused',
  carrierOutcome: 'refused',
  requiredAt: '2026-10-22T10:00:00.000Z',
};
const REASON_TEXT = {
  tracking_unknown: 'No pudimos confirmar el tracking',
  carrier_refused: 'El carrier rechazó la cancelación',
  carrier_ambiguous: 'El carrier no dio una respuesta clara',
} as const;
const REFUND = 'Reembolsar al comprador';
const CLOSE = 'Cerrar sin reembolso';
const CONFIRM_REFUND = 'Confirmar reembolso';
const CONFIRM_CLOSE = 'Confirmar cierre';

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
  const resolved: Array<[string, string, string]> = [];
  const props = {
    reviews: [base],
    isLoading: false,
    isError: false,
    isResolving: false,
    onRetry: () => undefined,
    onResolve: async (shipmentId: string, resolution: string, note: string) => {
      resolved.push([shipmentId, resolution, note]);
    },
    ...overrides,
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return CarrierReviewsBucket(props as Parameters<typeof CarrierReviewsBucket>[0]);
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
    const field = nodes(render()).find((n) => n.type === 'textarea')!;
    expect(field).toBeDefined();
    (field.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } });
  };
  return { render, html, button, click, type, resolved };
}
afterEach(() => mock.restore());

it('does not claim empty or show rows while loading', () => {
  const html = harness({ isLoading: true }).html();
  expect(html).toContain('Consultando cancelaciones con el carrier');
  expect(html).not.toContain('Ninguna cancelación pendiente');
  expect(html).not.toContain('TRK-998877');
});

it('shows an error state, never empty or partial rows, and wires the retry', () => {
  const onRetry = () => undefined;
  const h = harness({ isError: true, onRetry });
  const html = h.html();
  expect(html).toContain('Error al cargar cancelaciones con el carrier');
  expect(html).not.toContain('Ninguna cancelación pendiente');
  expect(html).not.toContain('TRK-998877');
  expect(nodes(h.render()).some((n) => n.props.onRetry === onRetry)).toBe(true);
});

it('shows the empty state only when resolved with no reviews', () => {
  const html = harness({ reviews: [] }).html();
  expect(html).toContain('Ninguna cancelación pendiente');
  expect(html).not.toContain('Consultando cancelaciones');
});

it('renders the Spanish label of every reason', () => {
  for (const [reason, text] of Object.entries(REASON_TEXT)) {
    expect(harness({ reviews: [{ ...base, reason }] }).html()).toContain(text);
  }
});

it('renders the row fields from integer cents with the waiting time', () => {
  const html = harness().html();
  expect(html).toContain('Cancelaciones con el carrier');
  expect(html).toContain('1,234.56');
  expect(html).toContain('11111111');
  expect(html).toContain('22222222');
  expect(html).toContain('33333333');
  expect(html).toContain('TRK-998877');
  expect(html).toContain('fedex');
  expect(html).toContain('Esperando');
  expect(html).toContain('2026-10-22T10:00:00.000Z');
  expect(html).toContain(REFUND);
  expect(html).toContain(CLOSE);
});

it('says so when the tracking number, carrier or label cost are unknown', () => {
  const html = harness({
    reviews: [{ ...base, trackingNumber: null, carrier: null, labelCostCents: null, reason: 'tracking_unknown' }],
  }).html();
  expect(html).not.toContain('TRK-998877');
  expect(html).toContain('Sin tracking');
  expect(html).toContain('Sin dato');
});

it('opens the refund confirmation warning about the label cost, without calling the server', async () => {
  const h = harness();
  expect(h.html()).not.toContain('<dialog');
  await h.click(REFUND);
  const html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain('1,234.56');
  expect(html).toContain('próximo ciclo automático');
  expect(h.button(CONFIRM_REFUND)).toBeDefined();
  expect(h.resolved).toEqual([]);
});

it('opens the close confirmation explaining there is no refund', async () => {
  const h = harness();
  await h.click(CLOSE);
  const html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain('no se reembolsará');
  expect(h.button(CONFIRM_CLOSE)).toBeDefined();
  expect(h.resolved).toEqual([]);
});

it('requires a note before sending anything', async () => {
  const h = harness();
  await h.click(CLOSE);
  h.type('   ');
  await h.click(CONFIRM_CLOSE);
  expect(h.resolved).toEqual([]);
  expect(h.html()).toContain(resolveCarrierReviewErrorMessage('INVALID_REVIEW_NOTE').replaceAll("'", '&#x27;'));
  h.type('a'.repeat(501));
  await h.click(CONFIRM_CLOSE);
  expect(h.resolved).toEqual([]);
});

it('sends the exact shipment, resolution and trimmed note, then closes the confirmation', async () => {
  const h = harness();
  await h.click(REFUND);
  h.type('  El carrier confirmó que no escaneó  ');
  await h.click(CONFIRM_REFUND);
  expect(h.resolved).toEqual([[base.shipmentId, 'refund_approved', 'El carrier confirmó que no escaneó']]);
  expect(h.html()).not.toContain('<dialog');

  const close = harness();
  await close.click(CLOSE);
  close.type('Paquete en tránsito');
  await close.click(CONFIRM_CLOSE);
  expect(close.resolved).toEqual([[base.shipmentId, 'closed_no_refund', 'Paquete en tránsito']]);
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
  await h.click(CLOSE);
  h.type('nota');
  const confirm = h.button(CONFIRM_CLOSE)!.props.onClick as () => Promise<void>;
  const first = confirm();
  const second = confirm();
  expect(calls).toHaveLength(1);
  expect(h.button('Confirmando...')?.props.disabled).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(calls).toHaveLength(1);
});

it('disables the row actions while the mutation is pending', () => {
  const h = harness({ isResolving: true });
  expect(h.button(REFUND)?.props.disabled).toBe(true);
  expect(h.button(CLOSE)?.props.disabled).toBe(true);
});

it('keeps the confirmation open with a mapped message on server errors and allows a retry', async () => {
  let fail = true;
  const calls: string[] = [];
  const h = harness({
    onResolve: async (_id: string, _resolution: string, note: string) => {
      calls.push(note);
      if (fail) throw Object.assign(new Error('boom'), { code: 'CARRIER_REVIEW_NOT_PENDING' });
    },
  });
  await h.click(CLOSE);
  h.type('nota 1');
  await h.click(CONFIRM_CLOSE);
  let html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain(resolveCarrierReviewErrorMessage('CARRIER_REVIEW_NOT_PENDING'));
  expect(html).toContain('nota 1');
  fail = false;
  await h.click(CONFIRM_CLOSE);
  expect(calls).toEqual(['nota 1', 'nota 1']);
  html = h.html();
  expect(html).not.toContain('<dialog');
});

it('maps each stable code and falls back to a generic message', async () => {
  const codes = [
    'AUTH_REQUIRED',
    'ADMIN_ONLY',
    'SHIPMENT_NOT_FOUND',
    'CARRIER_REVIEW_ALREADY_RESOLVED',
    'CANCELLATION_EXTERNAL_ALREADY_STARTED',
    'SHIPMENT_NOT_CANCELABLE',
    'INTERNAL_ERROR',
  ];
  for (const code of codes) {
    const h = harness({
      onResolve: async () => { throw Object.assign(new Error('x'), { code }); },
    });
    await h.click(REFUND);
    h.type('nota');
    await h.click(CONFIRM_REFUND);
    expect(h.html()).toContain(resolveCarrierReviewErrorMessage(code).replaceAll("'", '&#x27;'));
  }
  const h = harness({ onResolve: async () => { throw new Error('network'); } });
  await h.click(REFUND);
  h.type('nota');
  await h.click(CONFIRM_REFUND);
  expect(h.html()).toContain(resolveCarrierReviewErrorMessage(null));
});

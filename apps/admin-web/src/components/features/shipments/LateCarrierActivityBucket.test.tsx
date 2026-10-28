import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LateCarrierActivityBucket } from './LateCarrierActivityBucket';
import { resolveLateCarrierActivityErrorMessage, type LateCarrierActivity } from '../../../lib/lateCarrierActivity';

const base: LateCarrierActivity = {
  shipmentId: '11111111-aaaa-bbbb-cccc-000000000001',
  orderId: '22222222-aaaa-bbbb-cccc-000000000001',
  sellerId: '33333333-aaaa-bbbb-cccc-000000000001',
  trackingNumber: 'TRK-998877',
  carrier: 'fedex',
  shipmentStatus: 'cancelled',
  source: 'preparing_timeout',
  refundStatus: 'succeeded',
  activityAt: '2026-10-22T10:00:00.000Z',
  eventType: 'delivered',
};
const ACK = 'Marcar revisado';
const CONFIRM = 'Confirmar revisión';

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
  const acknowledged: Array<[string, string]> = [];
  const props = {
    cases: [base],
    isLoading: false,
    isError: false,
    isAcknowledging: false,
    onRetry: () => undefined,
    onAcknowledge: async (shipmentId: string, note: string) => {
      acknowledged.push([shipmentId, note]);
    },
    ...overrides,
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return LateCarrierActivityBucket(props as Parameters<typeof LateCarrierActivityBucket>[0]);
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
  const chip = () => {
    const found = nodes(render()).find((n) => n.props['data-testid'] === 'late-carrier-activity-count');
    return found ? label(found.props.children as React.ReactNode) : null;
  };
  return { render, html, button, click, type, chip, acknowledged };
}
afterEach(() => mock.restore());

it('explains in plain words what happened, what to do and what marking it does', () => {
  const html = harness({ isLoading: true }).html();
  expect(html).toContain('ya iniciamos el reembolso al comprador');
  expect(html).toContain('Habla con el vendedor o el comprador');
  expect(html).toContain('solo queda anotado y sale de la lista');
  expect(html).not.toMatch(/carrier registró movimiento|empezó el reembolso de la cancelación/);
});

it('shows the title and a dash instead of a count while loading, never rows or empty', () => {
  const h = harness({ isLoading: true });
  const html = h.html();
  expect(html).toContain('Paquetes que se movieron después de cancelar');
  expect(html).toContain('Consultando actividad del carrier');
  expect(html).not.toContain('Ningún caso pendiente');
  expect(html).not.toContain('TRK-998877');
  expect(h.chip()).toBe('—');
});

it('shows an error state with a dash, never empty or partial rows, and wires the retry', () => {
  const onRetry = () => undefined;
  const h = harness({ isError: true, onRetry });
  const html = h.html();
  expect(html).toContain('Error al cargar la actividad del carrier');
  expect(html).not.toContain('Ningún caso pendiente');
  expect(html).not.toContain('TRK-998877');
  expect(h.chip()).toBe('—');
  expect(nodes(h.render()).some((n) => n.props.onRetry === onRetry)).toBe(true);
});

it('shows the empty state with a zero count only when resolved with no cases', () => {
  const h = harness({ cases: [] });
  const html = h.html();
  expect(html).toContain('Ningún caso pendiente');
  expect(html).not.toContain('Consultando actividad');
  expect(h.chip()).toBe('0');
});

it('stays neutral: no technical or security wording', () => {
  const html = harness().html();
  expect(html).not.toMatch(/vulnerab|race|carrera|exploit/i);
});

it('renders the row fields with the carrier event, state and time since', () => {
  const h = harness();
  const html = h.html();
  expect(h.chip()).toBe('1');
  expect(html).toContain('11111111');
  expect(html).toContain('22222222');
  expect(html).toContain('33333333');
  expect(html).toContain('TRK-998877');
  expect(html).toContain('fedex');
  expect(html).toContain('Entregado');
  expect(html).toContain('Cancelado');
  expect(html).toContain('Reembolsado');
  expect(html).toContain('Hace');
  expect(html).toContain('2026-10-22T10:00:00.000Z');
  expect(html).toContain(ACK);
});

it('says so when the tracking number, carrier or refund state are unknown', () => {
  const html = harness({
    cases: [{ ...base, trackingNumber: null, carrier: null, refundStatus: null }],
  }).html();
  expect(html).not.toContain('TRK-998877');
  expect(html).toContain('Sin tracking');
  expect(html).toContain('Sin carrier');
  expect(html).toContain('Sin dato');
});

it('counts several cases', () => {
  const h = harness({ cases: [base, { ...base, shipmentId: '44444444-aaaa-bbbb-cccc-000000000001' }] });
  expect(h.chip()).toBe('2');
});

it('opens the acknowledgement form without calling the server', async () => {
  const h = harness();
  expect(h.html()).not.toContain('<dialog');
  await h.click(ACK);
  const html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain('Nota para el registro');
  expect(h.button(CONFIRM)).toBeDefined();
  expect(h.acknowledged).toEqual([]);
});

it('requires a note of 1 to 200 characters before sending anything', async () => {
  const h = harness();
  await h.click(ACK);
  h.type('   ');
  await h.click(CONFIRM);
  expect(h.acknowledged).toEqual([]);
  expect(h.html()).toContain(resolveLateCarrierActivityErrorMessage('INVALID_ACKNOWLEDGEMENT_NOTE'));
  h.type('a'.repeat(201));
  await h.click(CONFIRM);
  expect(h.acknowledged).toEqual([]);
});

it('sends the exact shipment and trimmed note, then closes the form', async () => {
  const h = harness();
  await h.click(ACK);
  h.type('  Hablé con el vendedor  ');
  await h.click(CONFIRM);
  expect(h.acknowledged).toEqual([[base.shipmentId, 'Hablé con el vendedor']]);
  expect(h.html()).not.toContain('<dialog');
});

it('dispatches once on a double click and disables the confirmation while pending', async () => {
  let finish: () => void = () => undefined;
  const calls: string[] = [];
  const h = harness({
    onAcknowledge: (shipmentId: string) => {
      calls.push(shipmentId);
      return new Promise<void>((resolve) => { finish = resolve; });
    },
  });
  await h.click(ACK);
  h.type('nota');
  const confirm = h.button(CONFIRM)!.props.onClick as () => Promise<void>;
  const first = confirm();
  const second = confirm();
  expect(calls).toHaveLength(1);
  expect(h.button('Confirmando...')?.props.disabled).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(calls).toHaveLength(1);
});

it('disables the row action while the mutation is pending', () => {
  expect(harness({ isAcknowledging: true }).button(ACK)?.props.disabled).toBe(true);
});

it('keeps the form open with a mapped message on server errors and allows a retry', async () => {
  let fail = true;
  const calls: string[] = [];
  const h = harness({
    onAcknowledge: async (_id: string, note: string) => {
      calls.push(note);
      if (fail) throw Object.assign(new Error('boom'), { code: 'LATE_CARRIER_ACTIVITY_NOT_FOUND' });
    },
  });
  await h.click(ACK);
  h.type('nota 1');
  await h.click(CONFIRM);
  let html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain(resolveLateCarrierActivityErrorMessage('LATE_CARRIER_ACTIVITY_NOT_FOUND'));
  expect(html).toContain('nota 1');
  fail = false;
  await h.click(CONFIRM);
  expect(calls).toEqual(['nota 1', 'nota 1']);
  html = h.html();
  expect(html).not.toContain('<dialog');
});

it('falls back to a generic message for an unknown failure', async () => {
  const h = harness({ onAcknowledge: async () => { throw new Error('network'); } });
  await h.click(ACK);
  h.type('nota');
  await h.click(CONFIRM);
  expect(h.html()).toContain(resolveLateCarrierActivityErrorMessage(null));
});

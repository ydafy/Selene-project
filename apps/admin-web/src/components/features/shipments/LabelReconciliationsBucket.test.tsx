import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LabelReconciliationsBucket } from './LabelReconciliationsBucket';
import { resolveLabelReconciliationErrorMessage, type LabelReconciliation } from '../../../lib/labelReconciliations';

const base: LabelReconciliation = {
  shipmentId: '11111111-aaaa-bbbb-cccc-000000000001',
  orderId: '22222222-aaaa-bbbb-cccc-000000000001',
  sellerId: '33333333-aaaa-bbbb-cccc-000000000001',
  sellerName: 'vendedor_uno',
  buyerId: '44444444-aaaa-bbbb-cccc-000000000001',
  buyerName: 'comprador_uno',
  createdAt: '2026-10-20T10:00:00.000Z',
  state: 'orphan_pending',
  stuckAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  claimExpiresAt: null,
  lastLabelEventAt: null,
  quoteCarrier: 'paquetexpress',
  quoteService: 'ground',
  quoteCostCents: 15000,
  quoteRatedAt: '2026-10-20T10:00:00.000Z',
  originPostalCode: '64000',
  originCity: 'Monterrey',
  destinationPostalCode: '06600',
  destinationCity: 'Ciudad de México',
};
const FOUND = 'La guía existe';
const NONE = 'No hay guía';
const SAVE = 'Guardar guía';
const CONFIRM_NONE = 'Confirmar: no hay guía';

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
  const resolved: unknown[] = [];
  const props = {
    cases: [base],
    isLoading: false,
    isError: false,
    isResolving: false,
    onRetry: () => undefined,
    onResolve: async (input: unknown) => {
      resolved.push(input);
    },
    ...overrides,
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return LabelReconciliationsBucket(props as Parameters<typeof LabelReconciliationsBucket>[0]);
  };
  const html = () => renderToStaticMarkup(render());
  const button = (text: string) =>
    nodes(render()).find((n) => n.type === 'button' && label(n.props.children as React.ReactNode) === text);
  const click = async (text: string) => {
    const found = button(text);
    expect(found, `Missing button: ${text}`).toBeDefined();
    await (found!.props.onClick as () => unknown)();
  };
  const type = (name: string, value: string) => {
    const field = nodes(render()).find((n) => n.props.name === name);
    expect(field, `Missing field: ${name}`).toBeDefined();
    (field!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } });
  };
  const chip = () => {
    const found = nodes(render()).find((n) => n.props['data-testid'] === 'label-reconciliations-count');
    return found ? label(found.props.children as React.ReactNode) : null;
  };
  const alert = () => {
    const found = nodes(render()).find((n) => n.props.role === 'alert');
    return found ? label(found.props.children as React.ReactNode).toLowerCase() : null;
  };
  const fillFound = (overrides: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      trackingNumber: 'PX123',
      labelUrl: 'https://labels.example/px123.pdf',
      enviaShipmentId: '98765',
      costPesos: '93.50',
      note: 'Está en el panel de Envía',
      ...overrides,
    };
    for (const [name, value] of Object.entries(values)) type(name, value);
  };
  return { render, html, button, click, type, chip, alert, fillFound, resolved };
}
afterEach(() => mock.restore());

it('explains in plain words what is wrong and what to do', () => {
  const html = harness({ isLoading: true }).html();
  expect(html).toContain('Guías que no sabemos si se crearon');
  expect(html).toContain('no supimos si Envía la creó');
  expect(html).toContain('Busca el envío en el panel de Envía');
  expect(html).not.toMatch(/orphan|claim|RPC|webhook|timeout/i);
});

it('shows a dash instead of a count while loading, never rows or empty', () => {
  const h = harness({ isLoading: true });
  const html = h.html();
  expect(html).toContain('Consultando guías');
  expect(html).not.toContain('Ninguna guía por revisar');
  expect(html).not.toContain('vendedor_uno');
  expect(h.chip()).toBe('—');
});

it('shows an error state with a dash, never empty or partial rows, and wires the retry', () => {
  const onRetry = () => undefined;
  const h = harness({ isError: true, onRetry });
  const html = h.html();
  expect(html).toContain('Error al cargar las guías por revisar');
  expect(html).not.toContain('Ninguna guía por revisar');
  expect(html).not.toContain('vendedor_uno');
  expect(h.chip()).toBe('—');
  expect(nodes(h.render()).some((n) => n.props.onRetry === onRetry)).toBe(true);
});

it('shows the empty state with a zero count only when resolved with no cases', () => {
  const h = harness({ cases: [] });
  expect(h.html()).toContain('Ninguna guía por revisar');
  expect(h.html()).not.toContain('Consultando guías');
  expect(h.chip()).toBe('0');
});

it('renders what the admin needs to find the label in the Envía panel', () => {
  const h = harness();
  const html = h.html();
  expect(h.chip()).toBe('1');
  expect(html).toContain('11111111');
  expect(html).toContain('22222222');
  expect(html).toContain('vendedor_uno');
  expect(html).toContain('comprador_uno');
  expect(html).toContain('Monterrey');
  expect(html).toContain('64000');
  expect(html).toContain('Ciudad de México');
  expect(html).toContain('06600');
  expect(html).toContain('paquetexpress');
  expect(html).toContain('ground');
  expect(html).toContain('$150');
  expect(html).toContain('Hace 3 h');
  expect(html).toContain('2026-10-20T10:00:00.000Z');
  expect(html).toContain(FOUND);
  expect(html).toContain(NONE);
});

it('says so when names, route or quote are unknown, falling back to short ids', () => {
  const html = harness({
    cases: [{
      ...base,
      sellerName: null,
      buyerName: null,
      quoteCarrier: null,
      quoteService: null,
      quoteCostCents: null,
      originCity: null,
      originPostalCode: null,
      destinationCity: null,
      destinationPostalCode: null,
    }],
  }).html();
  expect(html).toContain('33333333');
  expect(html).toContain('44444444');
  expect(html).toContain('Sin dato');
});

it('tells an unanswered request from an expired attempt, using the claim expiry', () => {
  const orphan = harness().html();
  expect(orphan).toContain('Envía no respondió');
  const expired = harness({
    cases: [{ ...base, state: 'claimed', claimExpiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), stuckAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }],
  }).html();
  expect(expired).toContain('El intento se quedó sin terminar');
  expect(expired).toContain('Hace 2 h');
});

it('counts several cases', () => {
  const h = harness({ cases: [base, { ...base, shipmentId: '55555555-aaaa-bbbb-cccc-000000000001' }] });
  expect(h.chip()).toBe('2');
});

it('opens the label form without calling the server', async () => {
  const h = harness();
  expect(h.html()).not.toContain('<dialog');
  await h.click(FOUND);
  const html = h.html();
  expect(html).toContain('<dialog');
  for (const text of ['Número de guía', 'URL de la guía', 'ID de envío en Envía', 'Costo de la guía (MXN)', 'Nota para el registro']) {
    expect(html).toContain(text);
  }
  expect(h.button(SAVE)).toBeDefined();
  expect(h.resolved).toEqual([]);
});

it('shows which field is wrong and sends nothing for bad label data', async () => {
  const cases: Array<[Record<string, string>, string]> = [
    [{ trackingNumber: ' ' }, 'número de guía'],
    [{ labelUrl: 'no es url' }, 'enlace completo'],
    [{ enviaShipmentId: '' }, 'id del envío'],
    [{ costPesos: 'abc' }, 'costo en pesos'],
    [{ costPesos: '-5' }, 'costo en pesos'],
    [{ note: '  ' }, 'nota de entre'],
  ];
  for (const [override, text] of cases) {
    const h = harness();
    await h.click(FOUND);
    h.fillFound(override);
    await h.click(SAVE);
    expect(h.resolved).toEqual([]);
    expect(h.alert()).toContain(text.toLowerCase());
  }
});

it('sends the exact shipment, trimmed fields and the cost in integer cents, then closes', async () => {
  const h = harness();
  await h.click(FOUND);
  h.fillFound({ trackingNumber: '  PX123 ', note: '  Está en Envía  ' });
  await h.click(SAVE);
  expect(h.resolved).toEqual([{
    shipmentId: base.shipmentId,
    resolution: 'label_found',
    note: 'Está en Envía',
    enviaShipmentId: '98765',
    trackingNumber: 'PX123',
    labelUrl: 'https://labels.example/px123.pdf',
    providerCostCents: 9350,
  }]);
  expect(h.html()).not.toContain('<dialog');
});

it('explains in plain words what "no hay guía" does before confirming', async () => {
  const h = harness();
  await h.click(NONE);
  const html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain('regresa al vendedor para que genere la guía otra vez');
  expect(html).toContain('se cancela y se reembolsa al comprador');
  expect(html).toContain('no se puede deshacer');
  expect(h.button(CONFIRM_NONE)).toBeDefined();
  expect(h.resolved).toEqual([]);
});

it('requires a note of 1 to 200 characters before releasing the shipment', async () => {
  const h = harness();
  await h.click(NONE);
  h.type('note', '   ');
  await h.click(CONFIRM_NONE);
  expect(h.resolved).toEqual([]);
  expect(h.html()).toContain(resolveLabelReconciliationErrorMessage('INVALID_RESOLUTION_NOTE'));
  h.type('note', 'a'.repeat(201));
  await h.click(CONFIRM_NONE);
  expect(h.resolved).toEqual([]);
});

it('sends only the shipment, the resolution and the trimmed note for "no hay guía"', async () => {
  const h = harness();
  await h.click(NONE);
  h.type('note', '  Revisé el panel, no hay guía  ');
  await h.click(CONFIRM_NONE);
  expect(h.resolved).toEqual([{ shipmentId: base.shipmentId, resolution: 'no_label', note: 'Revisé el panel, no hay guía' }]);
  expect(h.html()).not.toContain('<dialog');
});

it('dispatches once on a double click and disables the confirmation while pending', async () => {
  let finish: () => void = () => undefined;
  const calls: unknown[] = [];
  const h = harness({
    onResolve: (input: unknown) => {
      calls.push(input);
      return new Promise<void>((resolve) => { finish = resolve; });
    },
  });
  await h.click(NONE);
  h.type('note', 'nota');
  const confirm = h.button(CONFIRM_NONE)!.props.onClick as () => Promise<void>;
  const first = confirm();
  const second = confirm();
  expect(calls).toHaveLength(1);
  expect(h.button('Confirmando...')?.props.disabled).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(calls).toHaveLength(1);
});

it('disables both row actions while a resolution is pending', () => {
  const h = harness({ isResolving: true });
  expect(h.button(FOUND)?.props.disabled).toBe(true);
  expect(h.button(NONE)?.props.disabled).toBe(true);
});

it('keeps the form open with a mapped message on server errors and allows a retry', async () => {
  let fail = true;
  const calls: unknown[] = [];
  const h = harness({
    onResolve: async (input: unknown) => {
      calls.push(input);
      if (fail) throw Object.assign(new Error('boom'), { code: 'INVALID_PROVIDER_RESULT' });
    },
  });
  await h.click(FOUND);
  h.fillFound();
  await h.click(SAVE);
  let html = h.html();
  expect(html).toContain('<dialog');
  expect(html).toContain(resolveLabelReconciliationErrorMessage('INVALID_PROVIDER_RESULT'));
  expect(html).toContain('PX123');
  fail = false;
  await h.click(SAVE);
  expect(calls).toHaveLength(2);
  html = h.html();
  expect(html).not.toContain('<dialog');
});

it('shows a friendly message when the shipment was already resolved', async () => {
  const h = harness({ onResolve: async () => { throw Object.assign(new Error('conflict'), { code: 'ALREADY_RESOLVED' }); } });
  await h.click(NONE);
  h.type('note', 'nota');
  await h.click(CONFIRM_NONE);
  const html = h.html();
  expect(html).toContain(resolveLabelReconciliationErrorMessage('ALREADY_RESOLVED'));
  expect(html).toContain('ya no está pendiente');
});

it('falls back to a generic message for an unknown failure', async () => {
  const h = harness({ onResolve: async () => { throw new Error('network'); } });
  await h.click(NONE);
  h.type('note', 'nota');
  await h.click(CONFIRM_NONE);
  expect(h.html()).toContain(resolveLabelReconciliationErrorMessage(null));
});

import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { CopyableReference } from './CopyableReference';

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator',
);
afterEach(() => {
  mock.restore();
  if (originalNavigator)
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
});

function harness(writeText?: (value: string) => Promise<void>) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: writeText ? { writeText } : undefined },
  });
  const values: unknown[] = [];
  let index = 0;
  spyOn(React, 'useState').mockImplementation(((initial: unknown) => {
    const slot = index++;
    if (!(slot in values)) values[slot] = initial;
    return [
      values[slot],
      (value: unknown) => {
        values[slot] = value;
      },
    ];
  }) as typeof React.useState);
  const render = () => {
    index = 0;
    return CopyableReference({ label: 'ID de ejecución', value: 'run-exact' });
  };
  return { render };
}

it('copies the exact reference and reports success only after clipboard acceptance', async () => {
  const copied: string[] = [];
  let accept!: () => void;
  const pending = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const h = harness(async (value) => {
    copied.push(value);
    await pending;
  });
  const dd = h.render().props.children[1];
  const button = dd.props.children[1];
  expect(button.props['aria-label']).toBe('Copiar ID de ejecución');
  const request = button.props.onClick();
  expect(copied).toEqual(['run-exact']);
  expect(JSON.stringify(h.render())).not.toContain('Copiado');
  accept();
  await request;
  expect(JSON.stringify(h.render())).toContain('Copiado');
});

it('reports rejected or unavailable clipboard without claiming success', async () => {
  for (const write of [
    undefined,
    async () => {
      throw new Error('denied');
    },
  ]) {
    const h = harness(write);
    const button = h.render().props.children[1].props.children[1];
    await button.props.onClick();
    expect(JSON.stringify(h.render())).toContain('No se pudo copiar');
    expect(JSON.stringify(h.render())).not.toContain('Copiado');
    mock.restore();
  }
});

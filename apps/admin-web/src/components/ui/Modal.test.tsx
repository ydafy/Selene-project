import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Modal } from './Modal';

afterEach(() => mock.restore());

it('renders a named native dialog and an accessible close action', () => {
  const html = renderToStaticMarkup(
    <Modal title="Seller details" onClose={() => undefined}>
      <p>Existing details</p>
    </Modal>,
  );
  expect(html).toContain('<dialog');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('aria-labelledby=');
  expect(html).toContain('Seller details');
  expect(html).toContain('aria-label="Cerrar detalle"');
  expect(html).toContain('Existing details');
});

it('uses showModal for native focus containment and closes on Escape or close control', () => {
  const calls: string[] = [];
  const native = {
    open: false,
    showModal: () => {
      calls.push('showModal');
      native.open = true;
    },
    close: () => {
      calls.push('close');
      native.open = false;
    },
  };
  let effect!: () => void | (() => void);
  spyOn(React, 'useRef').mockReturnValue({ current: native });
  spyOn(React, 'useId').mockReturnValue('detail-title');
  spyOn(React, 'useLayoutEffect').mockImplementation((fn) => {
    effect = fn;
  });
  const dialog = Modal({
    title: 'Seller details',
    onClose: () => {
      calls.push('onClose');
    },
    children: <p>Details</p>,
  });
  const cleanup = effect();
  expect(calls).toEqual(['showModal']);
  let prevented = false;
  dialog.props.onCancel({
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(true);
  expect(calls).toEqual(['showModal', 'onClose']);
  const close = dialog.props.children[1];
  close.props.onClick();
  expect(calls).toEqual(['showModal', 'onClose', 'onClose']);
  if (typeof cleanup === 'function') cleanup();
  expect(calls).toEqual(['showModal', 'onClose', 'onClose', 'close']);
});

import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InputModal } from './InputModal';

afterEach(() => mock.restore());

const props = {
  onClose: () => undefined,
  onConfirm: () => undefined,
  title: 'Rechazar',
  description: 'Escribe el motivo',
  placeholder: 'Motivo',
  confirmLabel: 'Confirmar',
};

it('renders nothing while closed', () => {
  expect(renderToStaticMarkup(<InputModal {...props} isOpen={false} />)).toBe(
    '',
  );
});

it('opens with an empty reason and a disabled confirm button', () => {
  const html = renderToStaticMarkup(
    <InputModal {...props} isOpen minLength={5} />,
  );
  expect(html).toContain('Rechazar');
  expect(html).toContain('<textarea');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirmar<\/button>/);
});

it('keeps the typed reason only while open: closing holds no state to reset', () => {
  const useState = spyOn(React, 'useState');
  expect(InputModal({ ...props, isOpen: false })).toBeNull();
  expect(useState).not.toHaveBeenCalled();
});

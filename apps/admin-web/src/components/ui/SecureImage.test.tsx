import { afterEach, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: null }),
      }),
    },
  },
}));

const { SecureImage } = await import('./SecureImage');

afterEach(() => mock.restore());

it('shows a direct public URL on the first render', () => {
  const html = renderToStaticMarkup(
    <SecureImage
      path="https://cdn.example.com/a.jpg"
      alt="Foto"
      className="img"
    />,
  );
  expect(html).toContain('<img src="https://cdn.example.com/a.jpg"');
});

it('follows the path prop when it changes', () => {
  const first = renderToStaticMarkup(
    <SecureImage path="https://cdn.example.com/a.jpg" alt="Foto" />,
  );
  const second = renderToStaticMarkup(
    <SecureImage path="https://cdn.example.com/b.jpg" alt="Foto" />,
  );
  expect(first).toContain('a.jpg');
  expect(second).toContain('b.jpg');
  expect(second).not.toContain('a.jpg');
});

it('reports a missing path as unavailable on the first render', () => {
  expect(renderToStaticMarkup(<SecureImage path="" alt="Foto" />)).toContain(
    'No disponible',
  );
});

it('shows the loading placeholder while a storage path is being signed', () => {
  const html = renderToStaticMarkup(
    <SecureImage path="user/1/id.jpg" alt="Foto" />,
  );
  expect(html).toContain('animate-pulse');
  expect(html).not.toContain('<img');
});

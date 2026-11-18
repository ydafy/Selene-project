import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserReportsList, type UserReport } from './user-reports-list';

const open: UserReport = {
  id: 'report-open',
  created_at: '2026-11-17T10:00:00.000Z',
  reason: 'fraud',
  details: 'Pidió el pago fuera de la app',
  status: 'open',
  outcome: null,
  resolved_at: null,
  reporter: { username: 'compradora' },
};
const resolved: UserReport = {
  id: 'report-resolved',
  created_at: '2026-11-10T10:00:00.000Z',
  reason: 'spam',
  details: null,
  status: 'resolved',
  outcome: 'warned',
  resolved_at: '2026-11-12T10:00:00.000Z',
  reporter: null,
};

it('shows the reason label, the details and the open status', () => {
  const html = renderToStaticMarkup(
    <UserReportsList reports={[open]} total={1} />,
  );
  expect(html).toContain('Fraude o estafa');
  expect(html).toContain('Pidió el pago fuera de la app');
  expect(html).toContain('Abierta');
  expect(html).toContain('@compradora');
  expect(html).not.toContain('fraud<');
});

it('shows the outcome of a resolved report and no details when there are none', () => {
  const html = renderToStaticMarkup(
    <UserReportsList reports={[resolved]} total={1} />,
  );
  expect(html).toContain('Spam');
  expect(html).toContain('Resuelta: usuario advertido');
  expect(html).not.toContain('Sin detalles');
  expect(html).not.toContain('&quot;');
});

it('keeps the empty state when the user has no reports', () => {
  const html = renderToStaticMarkup(<UserReportsList reports={[]} total={0} />);
  expect(html).toContain('Este usuario no tiene denuncias.');
  expect(html).toContain('0 reportes');
});

it('counts every report in the header, not only the listed ones', () => {
  const html = renderToStaticMarkup(
    <UserReportsList reports={[open]} total={23} />,
  );
  expect(html).toContain('23 reportes');
});

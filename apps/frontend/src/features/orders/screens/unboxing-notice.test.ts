import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prettier may re-wrap the source files read below; compare without layout.
const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]}])/g, '$1')
    .replace(/,([)\]}])/g, '$1')
    .replace(/ \./g, '.');

const FRONTEND = join(import.meta.dir, '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const flat = (path: string) => compact(read(path));
const es = JSON.parse(read('src/shared/i18n/locales/es/orders.json'));
const en = JSON.parse(read('src/shared/i18n/locales/en/orders.json'));

// The hook needs Expo and React Query, absent in this worktree: pin the rule
// and the render wiring in source.
describe('unboxing notice', () => {
  it('shows only to the buyer, for paid/preparing/shipped/delivered shipments without a dispute', () => {
    expect(flat('src/features/orders/hooks/use-shipments.ts')).toContain(
      compact(
        "showUnboxingWarning: isBuyer && ['paid', 'preparing', 'shipped', 'delivered'].includes( shipment.status, ) && !isDispute,",
      ),
    );
  });

  it('renders the notice in the order detail from that permission', () => {
    const detail = flat('src/features/orders/screens/order-detail-screen.tsx');
    expect(detail).toContain(
      compact('{currentShipment?.permissions.showUnboxingWarning && ('),
    );
    const warning = flat('src/features/orders/components/unboxing-warning.tsx');
    expect(warning).toContain(compact("t('orders:detail.videoWarningTitle')"));
    expect(warning).toContain(compact("t('orders:detail.videoWarningMsg')"));
  });

  it('keeps the notice copy in both languages', () => {
    expect(es.detail.videoWarningTitle).toBe('Graba tu Unboxing');
    expect(en.detail.videoWarningTitle).toBe('Record your unboxing.');
    expect(es.detail.videoWarningMsg).toStartWith(
      'Te recomendamos grabar un video continuo',
    );
    expect(en.detail.videoWarningMsg).toStartWith(
      'We recommend recording a continuous video',
    );
  });
});

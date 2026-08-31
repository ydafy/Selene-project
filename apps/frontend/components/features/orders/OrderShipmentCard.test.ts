import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./OrderShipmentCard.tsx', import.meta.url), 'utf8');
const shipmentTypes = readFileSync(
  new URL('../../../../../packages/types/src/index.ts', import.meta.url),
  'utf8',
);
const shipmentHook = readFileSync(
  new URL('../../../core/hooks/useShipments.ts', import.meta.url),
  'utf8',
);

test('renders one purchased product as the shipment identity', () => {
  expect(source).toContain('const item = shipment.items[0];');
  expect(source).toContain('item ? renderItemRow(item)');
  expect(source).not.toContain('VISIBLE_ITEMS_LIMIT');
  expect(source).not.toContain('remainingCount');
});

test('uses the joined seller profile for a clipped avatar and safe fallback', () => {
  expect(shipmentTypes).toContain('seller: Profile | null;');
  expect(shipmentHook).toContain('seller: shipment.seller,');
  expect(source).toContain('const avatarUrl = shipment.seller?.avatar_url?.trim();');
  expect(source).toContain('const hasAvatar = !!avatarUrl && failedAvatarUrl !== avatarUrl;');
  expect(source).toContain('source={{ uri: avatarUrl }}');
  expect(source).toContain('onError={() => setFailedAvatarUrl(avatarUrl ?? null)}');
  expect(source).toContain("shipment.seller?.username || t('card.unknownSeller')");
  expect(source).not.toContain('shipment as EnrichedShipment');
});

test('shows the shipment identity while preserving the complete shipment total', () => {
  expect(source).toContain('const item = shipment.items[0];');
  expect(source).toContain('(sum, shipmentItem) => sum + Number(shipmentItem.price_at_purchase)');
  expect(source).toContain("flexWrap=\"wrap\"");
  expect(source).toContain('style={{ minWidth: 96, flexShrink: 1 }}');
  expect(source).toContain("alignSelf: 'flex-start'");
});

test('keeps product details, price, actions, and total readable on narrow screens', () => {
  expect(source).toContain('style={{ flexShrink: 0 }}');
  expect(source).toContain('numberOfLines={2}');
  expect(source).toContain("style={{ width: '100%' }}");
  expect(source).toContain("style={{ flexShrink: 1, textAlign: 'right' }}");
});

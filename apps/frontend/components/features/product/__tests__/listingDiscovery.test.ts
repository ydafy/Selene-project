import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const frontendRoot = join(import.meta.dir, '..', '..', '..', '..');
const read = (file: string) => readFileSync(join(frontendRoot, file), 'utf8');

// L31: listings in verification show everywhere except components whose
// purpose is verified listings.
describe('where listings in verification are discoverable', () => {
  test.each(['app/(tabs)/search.tsx', 'app/profile/[id].tsx'])(
    '%s lists active listings, including those in verification',
    (file) => {
      const source = read(file);
      expect(source).toContain('statuses: ACTIVE_LISTING_STATUSES');
      expect(source).not.toContain('verifiedOnly: true');
    },
  );

  test.each([
    'components/features/home/sections/ShellRecentDrops.tsx',
    'components/features/shop/sections/ShellEndFeedCard2.tsx',
  ])('%s keeps showing verified listings only', (file) => {
    const source = read(file);
    expect(source).toContain('verifiedOnly: true');
    expect(source).not.toContain('statuses:');
  });

  test('shop results and showroom start unfiltered and keep the verified chip', () => {
    expect(read('app/store/results.tsx')).toContain('verifiedOnly: false');
    expect(read('app/store/showroom/[id].tsx')).toContain('verifiedOnly: false');
  });
});

describe('cards flag listings in verification', () => {
  test.each([
    'components/features/product/ProductCard.tsx',
    'components/features/product/ProductMiniCard.tsx',
    'components/features/shop/sections/ProductSnapCard.tsx',
    'app/profile/[id].tsx',
  ])('%s renders the verification pill for listings in verification', (file) => {
    const source = read(file);
    expect(source).toContain('isInVerification(');
    expect(source).toContain('<VerificationPill');
  });

  test('the pill uses the same label as the product page badge', () => {
    expect(read('components/features/product/VerificationPill.tsx')).toContain(
      "t('product:visibilityBadge.verifying')",
    );
  });
});

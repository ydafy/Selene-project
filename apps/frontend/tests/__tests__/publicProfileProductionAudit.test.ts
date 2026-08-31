import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolvePublicProfileCollectionState,
  resolvePublicProfileSellerId,
  shouldHidePublicProfileModerationActions,
} from '../../app/profile/publicProfile.helpers';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('public profile route hardening', () => {
  const src = read('app/profile/[id].tsx');

  test('validates scalar route params before profile products or review reads', () => {
    expect(resolvePublicProfileSellerId('seller-1')).toBe('seller-1');
    expect(resolvePublicProfileSellerId('  seller-2  ')).toBe('seller-2');
    expect(resolvePublicProfileSellerId(['seller-1'])).toBeNull();
    expect(resolvePublicProfileSellerId('   ')).toBeNull();
    expect(src).toContain('enabled: isSellerIdValid');
  });

  test('hides owner moderation actions on public profiles', () => {
    expect(
      shouldHidePublicProfileModerationActions('seller-1', 'seller-1'),
    ).toBe(true);
    expect(
      shouldHidePublicProfileModerationActions('buyer-1', 'seller-1'),
    ).toBe(false);
    expect(
      shouldHidePublicProfileModerationActions(undefined, 'seller-1'),
    ).toBe(false);
    expect(src).toContain('isOwner={isOwner}');
  });

  test('separates retryable product and review failures from empty states', () => {
    expect(
      resolvePublicProfileCollectionState({
        error: new Error('network'),
        isLoading: false,
        itemCount: 0,
      }),
    ).toBe('error');
    expect(
      resolvePublicProfileCollectionState({
        error: null,
        isLoading: true,
        itemCount: 0,
      }),
    ).toBe('loading');
    expect(
      resolvePublicProfileCollectionState({
        error: null,
        isLoading: false,
        itemCount: 0,
      }),
    ).toBe('empty');
    expect(
      resolvePublicProfileCollectionState({
        error: null,
        isLoading: false,
        itemCount: 2,
      }),
    ).toBe('ready');
    expect(src).toContain('productsError');
    expect(src).toContain('reviewsError');
    expect(src).toContain('refetchProducts');
    expect(src).toContain('refetchReviews');
  });
});

describe('public profile accessibility and i18n wiring', () => {
  test('segmented control exposes tab semantics and selected state', () => {
    const src = read('components/ui/SegmentedControl.tsx');

    expect(src).toContain('accessibilityRole="tab"');
    expect(src).toContain('accessibilityState');
    expect(src).toContain('theme.colors.textPrimary');
  });

  test('profile locale files include public profile error and review date copy', () => {
    const en = JSON.parse(read('core/i18n/locales/en/profile.json'));
    const es = JSON.parse(read('core/i18n/locales/es/profile.json'));

    expect(en.public.errors.products).toBe('Could not load listings.');
    expect(en.public.reviewDatePrefix).toBe('Reviewed on');
    expect(es.public.errors.products).toBe(
      'No se pudieron cargar las publicaciones.',
    );
    expect(es.public.reviewDatePrefix).toBe('Reseña del');
  });
});

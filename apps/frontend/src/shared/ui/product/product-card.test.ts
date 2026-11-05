import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const srcRoot = join(import.meta.dir, '..', '..', '..');
const read = (file: string) => readFileSync(join(srcRoot, file), 'utf8');

describe('ProductCard favourite slot', () => {
  const card = read('shared/ui/product/product-card.tsx');

  test('shared code does not import the favourite button from a feature', () => {
    expect(card).not.toContain('components/features');
    expect(card).not.toContain('ProductFavoriteButton');
  });

  test('renders the slot in the top-right corner, only for unsold listings', () => {
    const active = card.slice(card.indexOf('{!isSold && ('));
    expect(active).toContain('{renderFavoriteButton && (');
    expect(active).toContain('<Box position="absolute" top={4} right={4}>');
    expect(active).toContain('{renderFavoriteButton(product)}');
    expect(card.indexOf('renderFavoriteButton(product)')).toBeGreaterThan(
      card.indexOf('{!isSold && ('),
    );
  });
});

describe('ProductCard callers pass the favourite button', () => {
  test('favorites forwards its removal handlers to the button', () => {
    const source = read('app/profile/favorites.tsx');
    expect(source).toContain('<ProductFavoriteButton');
    expect(source).toContain('productId={product.id}');
    expect(source).toContain('size={16}');
    expect(source).toContain('onFavoriteToggle={handleFavoriteToggle}');
    expect(source).toContain('onBeforeUnfavorite={handleBeforeUnfavorite}');
    expect(source).toContain('renderFavoriteButton={renderFavoriteButton}');
  });

  test.each(['app/store/results.tsx', 'app/store/showroom/[id].tsx'])(
    '%s shows the button with the id of the card product',
    (file) => {
      const source = read(file);
      expect(source).toContain(
        '<ProductFavoriteButton productId={product.id} size={16} />',
      );
      expect(source).toContain('renderFavoriteButton={renderFavoriteButton}');
    },
  );
});

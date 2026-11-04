import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decidePurchaseGate,
  purchaseDialogContent,
} from '../productPurchaseGate';

describe('decidePurchaseGate', () => {
  it('adds a VERIFIED product whose seller is not blocked (ready or unknown)', () => {
    expect(decidePurchaseGate('VERIFIED', false)).toBe('add');
  });

  it('opens the seller-not-ready dialog for a VERIFIED product with a blocked seller', () => {
    expect(decidePurchaseGate('VERIFIED', true)).toBe('SELLER_NOT_READY');
  });

  it('opens the education dialog for PENDING_VERIFICATION and IN_REVIEW', () => {
    expect(decidePurchaseGate('PENDING_VERIFICATION', false)).toBe(
      'PENDING_VERIFICATION',
    );
    expect(decidePurchaseGate('IN_REVIEW', false)).toBe('IN_REVIEW');
  });

  it('ignores seller readiness for non-VERIFIED listings', () => {
    expect(decidePurchaseGate('IN_REVIEW', true)).toBe('IN_REVIEW');
    expect(decidePurchaseGate('SOLD', true)).toBe('unavailable');
  });

  it('reports other statuses as unavailable', () => {
    for (const status of [
      'SOLD',
      'RESERVED',
      'REJECTED',
      'IN_DISPUTE',
      'HIDDEN',
    ]) {
      expect(decidePurchaseGate(status, false)).toBe('unavailable');
    }
  });
});

describe('purchaseDialogContent', () => {
  it('maps each variant to its title, line and current step', () => {
    expect(purchaseDialogContent('PENDING_VERIFICATION', false)).toEqual({
      titleKey: 'dialogs.pendingTitle',
      lineKey: 'dialogs.pendingLine',
      favoriteLineKey: 'dialogs.favoritePrompt',
      currentStep: 1,
    });
    expect(purchaseDialogContent('IN_REVIEW', false)).toEqual({
      titleKey: 'dialogs.inReviewTitle',
      lineKey: 'dialogs.inReviewLine',
      favoriteLineKey: 'dialogs.favoritePrompt',
      currentStep: 1,
    });
    expect(purchaseDialogContent('SELLER_NOT_READY', false)).toEqual({
      titleKey: 'dialogs.sellerNotReadyTitle',
      lineKey: 'dialogs.sellerNotReadyLine',
      favoriteLineKey: 'dialogs.favoritePrompt',
      currentStep: 2,
    });
  });

  it('promises the alert instead of prompting when already a favorite', () => {
    expect(purchaseDialogContent('IN_REVIEW', true).favoriteLineKey).toBe(
      'dialogs.favoriteKnown',
    );
  });
});

describe('purchase dialog copy', () => {
  const read = (p: string) =>
    readFileSync(join(__dirname, '../../..', p), 'utf8');
  const keys = [
    'dialogs.pendingTitle',
    'dialogs.pendingLine',
    'dialogs.inReviewTitle',
    'dialogs.inReviewLine',
    'dialogs.sellerNotReadyTitle',
    'dialogs.sellerNotReadyLine',
    'dialogs.favoritePrompt',
    'dialogs.favoriteKnown',
    'purchaseProgress.published',
    'purchaseProgress.verifying',
    'purchaseProgress.ready',
    'purchaseProgress.a11y',
  ];

  it('has every key in en and es and no leftover paragraph keys', () => {
    for (const lang of ['en', 'es']) {
      const json = JSON.parse(read(`core/i18n/locales/${lang}/product.json`));
      for (const key of keys) {
        const [a, b] = key.split('.');
        expect(json[a][b]).toBeString();
      }
      for (const old of ['pendingMsg', 'inReviewMsg', 'sellerNotReadyMsg']) {
        expect(json.dialogs[old]).toBeUndefined();
      }
    }
  });
});

// L34-L35: the product page shows no verification status on load; the add-to-cart
// dialog explains it (progress steps included) when the buyer tries to buy.
describe('product page', () => {
  const page = readFileSync(
    join(import.meta.dir, '..', '..', '..', 'app', 'product', '[id].tsx'),
    'utf8',
  );

  it('shows no verification label on load', () => {
    expect(page).not.toContain('visibilityBadge');
    expect(page).not.toContain('<VerificationPill');
  });

  it('renders progress steps only inside the dialog', () => {
    expect(page.match(/<PurchaseProgressSteps/g)).toHaveLength(1);
    expect(page).toContain(
      '<PurchaseProgressSteps currentStep={dialog.currentStep} />',
    );
  });
});

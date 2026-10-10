import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8').replace(/\s+/g, ' ');

// Native imports are unavailable in Bun; pin the UI wiring with source guards.
describe('shared seller payment explanation', () => {
  it('uses one shared body only in onboarding success and the completed seller dialog', () => {
    const component = 'components/features/payments/SellerPaymentExplanation.tsx';
    expect(existsSync(join(FRONTEND, component))).toBe(true);
    const shared = read(component);
    for (const key of ['buyerReview', 'release', 'bank', 'delays']) {
      expect(shared).toContain(`t('onboarding.paymentExplanation.${key}')`);
    }
    expect(shared).not.toContain('paymentExplanation.title');
    const onboarding = read('app/sell/onboarding.tsx');
    const success = onboarding.slice(onboarding.indexOf("if (onboardingUi.viewState === 'success')"), onboarding.indexOf('ref={scrollViewRef}'));
    expect(success).toContain('<SellerPaymentExplanation />');
    expect(onboarding.match(/<SellerPaymentExplanation/g)).toHaveLength(1);
    expect(success).toContain('CONNECT_ONBOARDING_SUCCESS_CTA_ROUTE');
  });

  it('gates help and visibility on the selected completed, dispute-free seller shipment', () => {
    const card = read('components/features/orders/OrderActionCard.tsx');
    expect(card).toContain("const showSellerCompletedBanner = isSeller && shipment.status === 'completed' && !dispute;");
    expect(card).toContain('{showSellerCompletedBanner && ( <PrimaryButton');
    expect(card).toContain('onPress={() => setIsPaymentExplanationVisible(true)}');
    expect(card).toContain('visible={showSellerCompletedBanner && isPaymentExplanationVisible}');
    expect(card).toContain('<SellerPaymentExplanation />');
    expect(card).not.toContain("order.status === 'completed'");
  });

  it('dismisses informational content without mutations and bounds scroll height', () => {
    const card = read('components/features/orders/OrderActionCard.tsx');
    const dialog = card.slice(card.indexOf('<ConfirmDialog'), card.indexOf('</ConfirmDialog>'));
    expect(dialog).toContain('onConfirm={() => setIsPaymentExplanationVisible(false)}');
    expect(dialog).toContain('onCancel={() => setIsPaymentExplanationVisible(false)}');
    expect(dialog).toContain('hideCancel');
    expect(dialog).toContain("confirmLabel={t('actionCard.paymentExplanationClose')}");
    expect(dialog).toContain('<ScrollView');
    expect(dialog).toContain('maxHeight: height * 0.45');
    expect(dialog).not.toContain('onRefresh');
    expect(dialog).not.toContain('handleReturnPayment');
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(process.cwd(), 'apps/frontend');
const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('prepare shipment safety & resilience policy', () => {
  const src = read('src/features/orders/screens/prepare-shipment-screen.tsx');
  const component = (name: string) =>
    read(`src/features/orders/components/${name}.tsx`);

  test('enforces native gesture & back button navigation lock', () => {
    // 1. Must use React Navigation prevent remove hook
    // SDK 58 exports it from expo-router itself.
    expect(src).toMatch(
      /import {[^}]*usePreventRemove[^}]*} from 'expo-router';/,
    );
    expect(src).not.toContain('expo-router/react-navigation');
    expect(src).toMatch(/usePreventRemove\(\s*isProcessing/);

    // 2. iOS swipe gesture must be dynamically disabled
    expect(src).toContain('gestureEnabled: !isProcessing');

    // 3. GlobalHeader back action must be disabled during processing
    expect(src).toContain('onBack={isProcessing ? () => {} : undefined}');
  });

  test('freezes screen pointer events during processing', () => {
    // Prevents rogue touches on address selector or shipment switcher
    expect(src).toContain("pointerEvents={isProcessing ? 'none' : 'auto'}");
  });

  test('protects handleConfirm against concurrent executions & network drops', () => {
    // Guard clause (ignora saltos de línea CRLF/LF)
    expect(src).toMatch(
      /if\s*\(\s*!mounted\.current\s*\|\|\s*submissionInFlight\.current\s*\|\|\s*evidenceBusy\.current\s*\|\|\s*isProcessing/,
    );
    expect(src).toMatch(
      /submissionInFlight\.current = true;[\s\S]*?await authenticateAsync/,
    );
    // Finally block cleanup
    expect(src).toMatch(
      /finally\s*\{\s*submissionInFlight\.current = false;\s*if \(mounted\.current\) setIsAuthenticating\(false\);/,
    );
    // Resilience: refetch in catch block
    expect(src).toContain('await refetch();');
  });

  test('implements label recovery view for crashes or offline reconnection', () => {
    // Invariant: detects existing label from database
    expect(src).toContain(
      'const hasExistingLabel = Boolean(selectedShipment?.label_url);',
    );
    // Recovery UI condition
    expect(src).toContain('hasExistingLabel ?');
    expect(src).toContain('<ExistingLabelCard');
    expect(component('existing-label-card')).toContain('alreadyGeneratedTitle');
  });

  test('keeps the interaction guards on the extracted prepare sections', () => {
    // The screen decides when each section shows and what its taps do.
    expect(src).toMatch(
      /sellerShipments\.length > 1 && \(\s*<PrepareShipmentSelector[\s\S]*?canInteract=\{canInteract\}[\s\S]*?isProcessing=\{isProcessing\}/,
    );
    expect(src).toMatch(
      /!onboardingLoading && !onboardingDone && \(\s*<ConnectOnboardingNotice\s+isProcessing=\{isProcessing\}\s+onPress=\{\(\) => \{\s*if \(canInteract\(\)\)\s*router\.push\('\/sell\/onboarding' as RelativePathString\);/,
    );
    expect(src).toMatch(
      /<ExistingLabelCard\s+isProcessing=\{isProcessing\}\s+onViewLabel=\{\(\) => \{\s*if \(selectedShipment\?\.label_url\)/,
    );
    expect(src).toMatch(
      /<LabelSuccessDialog\s+visible=\{showSuccess && !isProcessing\}\s+labelOpenError=\{labelOpenError\}/,
    );
    // The extracted sections lock themselves while processing.
    const selector = component('prepare-shipment-selector');
    expect(selector).toContain('disabled={isProcessing}');
    expect(selector).toContain(
      'accessibilityState={{ disabled: isProcessing }}',
    );
    expect(selector).toMatch(
      /if \(canInteract\(\)\) onSelect\(shipment\.id\);/,
    );
    for (const name of ['connect-onboarding-notice', 'existing-label-card']) {
      const source = component(name);
      expect(source).toContain('disabled={isProcessing}');
    }
    expect(component('connect-onboarding-notice')).toContain(
      'onPress={onPress}',
    );
    expect(component('existing-label-card')).toContain('onPress={onViewLabel}');
    expect(selector).toMatch(
      /selectedShipmentId === shipment\.id\s*\?\s*'check-circle'\s*:\s*'chevron-right'/,
    );
    // The dialog confirms through the screen handler and never offers cancel.
    const dialog = component('label-success-dialog');
    expect(dialog).toContain('onConfirm={onConfirm}');
    expect(dialog).toMatch(/\s+hideCancel\s+>/);
    expect(dialog).toContain('{labelOpenError && (');
    expect(dialog).toContain('entering={truckEntering}');
  });

  test('binds primary button states to isProcessing', () => {
    expect(src).toContain('loading={isProcessing}');
    expect(src).toMatch(/disabled=\{[\s\S]*?isProcessing/);
  });
});

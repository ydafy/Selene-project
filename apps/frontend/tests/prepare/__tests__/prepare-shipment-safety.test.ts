import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(process.cwd(), 'apps/frontend');
const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('prepare shipment safety & resilience policy', () => {
  const src = read('app/profile/orders/prepare/[id].tsx');

  test('enforces native gesture & back button navigation lock', () => {
    // 1. Must use React Navigation prevent remove hook
    expect(src).toContain(
      "import { usePreventRemove } from '@react-navigation/native'",
    );
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
    expect(src).toMatch(/if\s*\(\s*isProcessing/);
    // Finally block cleanup
    expect(src).toMatch(/finally\s*\{[\s\S]*?setIsAuthenticating\(false\);/);
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
    expect(src).toContain('alreadyGeneratedTitle');
  });

  test('binds primary button states to isProcessing', () => {
    expect(src).toContain('loading={isProcessing}');
    expect(src).toMatch(/disabled=\{[\s\S]*?isProcessing/);
  });
});

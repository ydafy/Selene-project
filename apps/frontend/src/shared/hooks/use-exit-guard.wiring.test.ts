import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) =>
  readFileSync(join(import.meta.dir, '..', '..', file), 'utf8');

test('the sell layout guards a dirty draft and resets it on discard', () => {
  const layout = read('app/sell/_layout.tsx');
  expect(layout).toContain(
    'const resetDraft = useSellStore((state) => state.resetDraft);',
  );
  expect(layout).toContain('enabled: isSellDraftDirty(draft)');
  expect(layout).toContain('onDiscard: resetDraft');
});

test('the shared guard knows nothing about the sell store', () => {
  const guard = read('shared/hooks/use-exit-guard.tsx');
  expect(guard).not.toContain('useSellStore');
  expect(guard).not.toContain('core/store');
});

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The push components have no render harness, so their wiring is pinned here.
const root = join(import.meta.dir, '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

test('the network listener registers only on the transition back online', () => {
  const source = read('components/features/notifications/PushRegistration.tsx');
  expect(source).toMatch(
    /const backOnline = createOnlineTransition\(\);\s*const unsubscribeNetwork = NetInfo\.addEventListener\(\(state\) => \{\s*if \(backOnline\(state\)\) void pushRegistrar\.register\(userId\);/,
  );
  expect(source).not.toContain('isNetworkReachable');
});

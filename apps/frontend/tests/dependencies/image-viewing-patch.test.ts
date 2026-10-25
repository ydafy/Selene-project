import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// React Native 0.85 removed StyleSheet.absoluteFillObject at runtime. The unmaintained
// react-native-image-viewing spreads it in its Android modal, so the viewer would lose
// its full-screen layout. patches/react-native-image-viewing@0.2.2.patch swaps it for
// StyleSheet.absoluteFill; drop this test when the library is replaced.
const require = createRequire(join(import.meta.dir, '..', '..', 'package.json'));
const androidModal = join(
  dirname(require.resolve('react-native-image-viewing/package.json')),
  'dist/components/Modal/Modal.android.js',
);

describe('react-native-image-viewing patch', () => {
  test('the Android modal fills the screen without the removed absoluteFillObject', () => {
    const source = readFileSync(androidModal, 'utf8');
    expect(source).not.toContain('absoluteFillObject');
    expect(source).toContain('...StyleSheet.absoluteFill,');
  });
});

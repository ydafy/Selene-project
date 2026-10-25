import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..');
const ROOT = join(FRONTEND, '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

const VIEWER_SCREENS = [
  'components/features/product/ProductImageGallery.tsx',
  'components/features/sell/ImageGridPicker.tsx',
  'components/features/verify/BenchmarkGuideModal.tsx',
  'app/sell/onboarding.tsx',
];

describe('image viewer migration to react-native-zoom-toolkit', () => {
  test('no app file imports the unmaintained react-native-image-viewing', () => {
    const offenders = ['app', 'components', 'core']
      .flatMap((dir) => sourceFiles(join(FRONTEND, dir)))
      .filter((file) => !file.includes(`${sep}__tests__${sep}`))
      .filter((file) => readFileSync(file, 'utf8').includes("from 'react-native-image-viewing'"))
      .map((file) => relative(FRONTEND, file));
    expect(offenders).toEqual([]);
  });

  test('every screen with a full-screen viewer uses the shared AppImageViewer', () => {
    for (const screen of VIEWER_SCREENS) {
      expect(read(screen)).toContain('<AppImageViewer');
    }
  });

  test('the shared viewer is built on the zoom toolkit gallery', () => {
    const viewer = read('components/ui/AppImageViewer.tsx');
    expect(viewer).toContain("from 'react-native-zoom-toolkit'");
    expect(viewer).toContain('<Gallery');
    expect(viewer).toContain('<GestureHandlerRootView');
  });

  test('the benchmark guide step counter is translated', () => {
    const guide = read('components/features/verify/BenchmarkGuideModal.tsx');
    expect(guide).not.toMatch(/Paso \{/);
    expect(guide).toContain("t('guide.stepCounter'");
  });

  test('dependencies drop the library and its patch', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['react-native-image-viewing']).toBeUndefined();
    expect(pkg.dependencies['react-native-zoom-toolkit']).toBeDefined();
    const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(rootPkg.patchedDependencies?.['react-native-image-viewing@0.2.2']).toBeUndefined();
  });
});

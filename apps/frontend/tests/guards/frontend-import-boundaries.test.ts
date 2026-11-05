import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = new URL('../../', import.meta.url);

describe('frontend import boundaries', () => {
  it('does not import Supabase Edge Function sources', async () => {
    const forbiddenImports: string[] = [];

    for await (const relativePath of new Bun.Glob('**/*.{ts,tsx}').scan({
      cwd: fileURLToPath(frontendRoot),
      absolute: false,
    })) {
      const source = await Bun.file(new URL(relativePath, frontendRoot)).text();
      if (/from\s+['"][^'"]*supabase\/functions\//.test(source)) {
        forbiddenImports.push(relativePath);
      }
    }

    expect(forbiddenImports).toEqual([]);
  });

  // moti is stalled and breaks on Reanimated 4 (#99, #131); animate with Reanimated.
  it('does not import moti', async () => {
    const motiImports: string[] = [];

    for await (const relativePath of new Bun.Glob('**/*.{ts,tsx}').scan({
      cwd: fileURLToPath(frontendRoot),
      absolute: false,
    })) {
      if (relativePath.split(/[\\/]/).includes('node_modules')) continue;
      const source = await Bun.file(new URL(relativePath, frontendRoot)).text();
      if (
        /from\s+['"]moti(\/[^'"]*)?['"]|mock\.module\(\s*['"]moti['"]/.test(
          source,
        )
      ) {
        motiImports.push(relativePath);
      }
    }

    expect(motiImports).toEqual([]);
  });

  // Expo SDK 58 no longer pins it. The app uses Crypto.randomUUID() from
  // expo-crypto, and Supabase auth runs the implicit flow, which draws no
  // random bytes (#132).
  it('does not import react-native-get-random-values', async () => {
    const polyfillImports: string[] = [];

    for await (const relativePath of new Bun.Glob('**/*.{ts,tsx}').scan({
      cwd: fileURLToPath(frontendRoot),
      absolute: false,
    })) {
      if (relativePath.split(/[\\/]/).includes('node_modules')) continue;
      const source = await Bun.file(new URL(relativePath, frontendRoot)).text();
      if (
        /(?:import|from)\s+['"]react-native-get-random-values['"]/.test(source)
      ) {
        polyfillImports.push(relativePath);
      }
    }

    expect(polyfillImports).toEqual([]);
  });

  // React deprecates react-test-renderer (#150); mount tests use
  // @testing-library/react-native with test-renderer.
  it('does not use react-test-renderer', async () => {
    const rendererImports: string[] = [];

    for await (const relativePath of new Bun.Glob('**/*.{ts,tsx}').scan({
      cwd: fileURLToPath(frontendRoot),
      absolute: false,
    })) {
      if (relativePath.split(/[\\/]/).includes('node_modules')) continue;
      const source = await Bun.file(new URL(relativePath, frontendRoot)).text();
      if (
        /(?:from|import|require\(|mock\.module\()\s*['"]react-test-renderer['"]/.test(
          source,
        )
      ) {
        rendererImports.push(relativePath);
      }
    }
    const manifest = (await Bun.file(
      new URL('package.json', frontendRoot),
    ).json()) as { dependencies?: object; devDependencies?: object };

    expect({
      rendererImports,
      declared:
        'react-test-renderer' in
        {
          ...manifest.dependencies,
          ...manifest.devDependencies,
        },
    }).toEqual({ rendererImports: [], declared: false });
  });

  // Expo will deprecate @expo/vector-icons (#149). Icons come from
  // @react-native-vector-icons/material-design-icons, which react-native-paper
  // also prefers; mixing both packages can render one font as empty squares.
  it('does not use @expo/vector-icons', async () => {
    const expoIconImports: string[] = [];

    for await (const relativePath of new Bun.Glob('**/*.{ts,tsx}').scan({
      cwd: fileURLToPath(frontendRoot),
      absolute: false,
    })) {
      if (relativePath.split(/[\\/]/).includes('node_modules')) continue;
      const source = await Bun.file(new URL(relativePath, frontendRoot)).text();
      if (
        /(?:from|import\(?|require\(|mock\.module\()\s*['"]@expo\/vector-icons(\/[^'"]*)?['"]/.test(
          source,
        )
      ) {
        expoIconImports.push(relativePath);
      }
    }
    const manifest = (await Bun.file(
      new URL('package.json', frontendRoot),
    ).json()) as { dependencies?: object; devDependencies?: object };

    expect({
      expoIconImports,
      declared:
        '@expo/vector-icons' in
        {
          ...manifest.dependencies,
          ...manifest.devDependencies,
        },
    }).toEqual({ expoIconImports: [], declared: false });
  });
});

const srcRoot = join(fileURLToPath(frontendRoot), 'src');
const SPECIFIER_PATTERN =
  /(?:from\s+|import\(\s*|require\(\s*|mock\.module\(\s*)['"]([^'"]+)['"]/g;

// Paths are relative to src/ with forward slashes. Bare package names and
// `@/assets/*` (which tsconfig maps outside src/) resolve to null.
function resolveSpecifier(importerDir: string, specifier: string) {
  let absolute: string;
  if (specifier.startsWith('.')) {
    absolute = resolve(importerDir, specifier);
  } else if (specifier.startsWith('@/') && !specifier.startsWith('@/assets/')) {
    absolute = join(srcRoot, specifier.slice(2));
  } else {
    return null;
  }
  return relative(srcRoot, absolute).split(sep).join('/');
}

// A source-text assertion can quote an import line from another file's
// directory; only a specifier that points at a real module counts.
function moduleExists(target: string) {
  const base = join(srcRoot, target);
  return ['', '.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx'].some(
    (suffix) => existsSync(base + suffix),
  );
}

function violationReason(importer: string, target: string) {
  const importerParts = importer.split('/');
  const targetParts = target.split('/');
  if (targetParts[0] === 'app' || targetParts[0] === 'features') {
    if (importerParts[0] === 'shared') return 'shared';
    if (importerParts[0] === 'features' && targetParts[0] === 'app')
      return 'app';
  }
  if (
    importerParts[0] === 'features' &&
    targetParts[0] === 'features' &&
    importerParts[1] !== targetParts[1]
  ) {
    return 'feature';
  }
  return null;
}

const scannedFiles: string[] = [];
const foundViolations = new Set<string>();

for await (const importer of new Bun.Glob('**/*.{ts,tsx}').scan({
  cwd: srcRoot,
  absolute: false,
})) {
  const importerPath = importer.split(sep).join('/');
  scannedFiles.push(importerPath);
  const source = await Bun.file(join(srcRoot, importerPath)).text();
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const target = resolveSpecifier(
      dirname(join(srcRoot, importerPath)),
      match[1],
    );
    if (
      target !== null &&
      violationReason(importerPath, target) !== null &&
      moduleExists(target)
    ) {
      foundViolations.add(`${importerPath} -> ${target}`);
    }
  }
}

// The B2 migration list (odd/tasks/frontend-layout.md L43). It must only
// shrink: fix a violation, then delete its entry. Remove the array and the
// equality check when it is empty.
const KNOWN_VIOLATIONS: string[] = [
  'features/cart/hooks/use-cart-validation.ts -> features/orders/logic/order-service',
  'features/orders/screens/prepare-shipment-submit.mount.test.tsx -> app/profile/orders/prepare/[id]',
];

describe('dependency rule', () => {
  // A wrong root or a broken resolver would find nothing and pass silently.
  it('scans src/ and resolves relative and @/ specifiers', () => {
    expect(scannedFiles).toContain('features/auth/hooks/use-auth.ts');
    expect(
      resolveSpecifier(
        join(srcRoot, 'features/profile/components'),
        '@/features/auth/hooks/use-auth',
      ),
    ).toBe('features/auth/hooks/use-auth');
    expect(
      resolveSpecifier(
        join(srcRoot, 'features/profile/components'),
        '../../auth/hooks/use-auth',
      ),
    ).toBe('features/auth/hooks/use-auth');
    expect(resolveSpecifier(srcRoot, 'react')).toBeNull();
    const profileActionsBar = readFileSync(
      join(srcRoot, 'features/profile/components/profile-actions-bar.tsx'),
      'utf8',
    );
    expect(
      [...profileActionsBar.matchAll(SPECIFIER_PATTERN)].some((match) =>
        match[1].startsWith('@/'),
      ),
    ).toBe(true);
  });

  // shared/ never imports features/ or app/; a feature never imports another
  // feature or app/.
  it('has no violations beyond the known migration list', () => {
    expect([...foundViolations].sort()).toEqual(KNOWN_VIOLATIONS);
  });
});

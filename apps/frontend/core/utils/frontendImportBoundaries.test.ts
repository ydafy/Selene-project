import { describe, expect, it } from 'bun:test';
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
        /(?:from|import|require\(|mock\.module\()\s*['"]@expo\/vector-icons(\/[^'"]*)?['"]/.test(
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

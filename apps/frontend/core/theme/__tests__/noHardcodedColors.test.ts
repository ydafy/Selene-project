import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FRONTEND_ROOT = join(import.meta.dir, '..', '..', '..');
const SCANNED_DIRS = ['app', 'components', 'core'];

// Theme files define the tokens; brand logos must keep their brand colors.
const EXCLUDED_PREFIXES = ['core/theme/', 'components/icons/'];

// Third-party brand colors outside the icons folder, by file.
const ALLOWED_BRAND_COLORS: Record<string, string[]> = {
  'components/features/home/sections/ShellBenchmarksFeature.tsx': ['#FF5722'], // 3DMark
  'components/features/home/sections/ShellPaymentsFeature.tsx': ['#635BFF'], // Stripe
};

const HEX_LITERAL = /['"`](#[0-9a-fA-F]{3,8})['"`]/g;
const FUNCTIONAL_LITERAL = /['"`]((?:rgb|hsl)a?\([^)]*\))['"`]/gi;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules'
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });

describe('app components use theme color tokens', () => {
  test('no hex or rgb/hsl color literals outside the theme and brand assets', () => {
    const offenders: string[] = [];

    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(join(FRONTEND_ROOT, dir))) {
        const rel = relative(FRONTEND_ROOT, file).split(sep).join('/');
        if (EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;

        const allowed = ALLOWED_BRAND_COLORS[rel] ?? [];
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            for (const [, hex] of line.matchAll(HEX_LITERAL)) {
              if (!allowed.includes(hex)) offenders.push(`${rel}:${index + 1} ${hex}`);
            }
            for (const [, color] of line.matchAll(FUNCTIONAL_LITERAL)) {
              offenders.push(`${rel}:${index + 1} ${color}`);
            }
          });
      }
    }

    expect(offenders).toEqual([]);
  });
});

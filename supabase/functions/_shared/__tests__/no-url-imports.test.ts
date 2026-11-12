// source-text: import specifiers are the contract; a URL import bypasses the exact dependency pins.
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// A module imported from a URL (esm.sh, deno.land) bypasses the exact root
// devDependency pins (`scripts/guards/edge-function-npm-pins.test.ts`), so the
// weekly dependency report and `bun audit` never see it. GHSA-mrhx-c7xc-m3w5
// reached the functions this way, through https://esm.sh/zod@3.23.8.
const functionsRoot = fileURLToPath(new URL('../../', import.meta.url));
// This file's own fixtures are import lines inside string literals.
const thisFile = fileURLToPath(import.meta.url);
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const urlImport =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](https?:\/\/[^"']*)["']/g;

const findUrlImports = (source: string) =>
  [...source.matchAll(urlImport)].map((match) => match[1]);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceFile.test(entry.name) && path !== thisFile ? [path] : [];
  });

describe('Edge Function URL imports', () => {
  it('recognizes static, re-export, side-effect, type and dynamic URL imports', () => {
    expect(
      findUrlImports(
        [
          "import { z } from 'https://esm.sh/zod@3.23.8';",
          'export { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";',
          "import 'https://cdn.skypack.dev/zod';",
          'const { z } = await import("https://esm.sh/zod@3.23.8");',
          "import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';",
          "import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';",
          'import Stripe from "https://esm.sh/stripe@17.0.0?target=deno";',
          "import {\n  createClient,\n} from 'https://esm.sh/@supabase/supabase-js@2.39.3';",
          "import('https://deno.land/std@0.168.0/http/server.ts'),",
        ].join('\n'),
      ),
    ).toEqual([
      'https://esm.sh/zod@3.23.8',
      'https://deno.land/x/zod@v3.22.4/mod.ts',
      'https://cdn.skypack.dev/zod',
      'https://esm.sh/zod@3.23.8',
      'https://deno.land/std@0.168.0/http/server.ts',
      'https://esm.sh/@supabase/supabase-js@2.39.3',
      'https://esm.sh/stripe@17.0.0?target=deno',
      'https://esm.sh/@supabase/supabase-js@2.39.3',
      'https://deno.land/std@0.168.0/http/server.ts',
    ]);
    expect(
      findUrlImports(
        [
          'export { z } from "npm:zod@4.6.7";',
          "import { z } from '../_shared/zod-runtime.ts';",
          "expect(source).not.toContain('https://esm.sh/zod@3.23.8');",
          "const url = new URL('https://api.stripe.com/v1/charges');",
          "await fetch('https://api.envia.com/ship/rate/');",
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('no Edge Function imports a module from a URL', () => {
    const offenders = sourceFiles(functionsRoot).flatMap((path) =>
      findUrlImports(readFileSync(path, 'utf8')).map(
        (specifier) =>
          `${relative(functionsRoot, path).replaceAll('\\', '/')}: ${specifier}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});

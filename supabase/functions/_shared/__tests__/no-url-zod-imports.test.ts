import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// GHSA-mrhx-c7xc-m3w5: a zod imported from a URL (e.g. https://esm.sh/zod@3.23.8)
// bypasses the pinned `_shared/zod-runtime.ts` and is invisible to `bun audit`.
const functionsRoot = fileURLToPath(new URL("../../", import.meta.url));
// This file's own fixtures are import lines inside string literals.
const thisFile = fileURLToPath(import.meta.url);
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const urlZodImport =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](https?:\/\/[^"']*\bzod\b[^"']*)["']/g;

const findUrlZodImports = (source: string) =>
  [...source.matchAll(urlZodImport)].map((match) => match[1]);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceFile.test(entry.name) && path !== thisFile ? [path] : [];
  });

describe("Edge Function zod imports", () => {
  it("recognizes static, re-export, side-effect and dynamic URL imports of zod", () => {
    expect(
      findUrlZodImports(
        [
          "import { z } from 'https://esm.sh/zod@3.23.8';",
          'export { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";',
          "import 'https://cdn.skypack.dev/zod';",
          'const { z } = await import("https://esm.sh/zod@3.23.8");',
        ].join("\n"),
      ),
    ).toEqual([
      "https://esm.sh/zod@3.23.8",
      "https://deno.land/x/zod@v3.22.4/mod.ts",
      "https://cdn.skypack.dev/zod",
      "https://esm.sh/zod@3.23.8",
    ]);
    expect(
      findUrlZodImports(
        [
          'export { z } from "npm:zod@4.6.7";',
          "import { z } from '../_shared/zod-runtime.ts';",
          "expect(source).not.toContain('https://esm.sh/zod@3.23.8');",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("no Edge Function imports zod from a URL", () => {
    const offenders = sourceFiles(functionsRoot).flatMap((path) =>
      findUrlZodImports(readFileSync(path, "utf8")).map(
        (specifier) =>
          `${relative(functionsRoot, path).replaceAll("\\", "/")}: ${specifier}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});

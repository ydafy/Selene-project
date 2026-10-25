import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const workflow = readFileSync(join(root, ".github/workflows/dependency-audit.yml"), "utf8");
const lockfile = readFileSync(join(root, "bun.lock"), "utf8");

// bun audit --ignore applies to every copy of a package, so an exception granted
// for build tooling would also hide a vulnerable copy that ships at runtime.
describe("GHSA-mrhx-c7xc-m3w5 exception (zod < 4.6.6)", () => {
  const zodEntries = [...lockfile.matchAll(/^\s*"((?:[^"]+\/)?zod)": \["zod@([\d.]+)"/gm)].map(
    ([, key, version]) => ({ key, version }),
  );

  it("is ignored by the weekly audit with its reason", () => {
    expect(workflow).toContain("--ignore=GHSA-mrhx-c7xc-m3w5");
    expect(workflow).toMatch(/#\s+GHSA-mrhx-c7xc-m3w5 zod 3\.25\.\d+ \(@expo\/cli/);
  });

  it("only covers the copy that @expo/cli brings", () => {
    const unpatched = zodEntries.filter(({ version }) => Bun.semver.order(version, "4.6.6") < 0);

    expect(zodEntries.length).toBeGreaterThan(0);
    expect(unpatched.map(({ key }) => key)).toEqual(["@expo/cli/zod"]);
  });
});

// Tests run the code they test (docs/conventions.md, "Source-text tests").
// These are the test files per area that still read files without a
// `// source-text: <reason>` marker. Roadmap #272 converts them; a number may
// only go down. Areas never change when files move inside them.
export const SOURCE_TEXT_TEST_COUNTS: Record<string, number> = {
  'apps/admin-web': 3,
  'apps/frontend': 75,
  'packages/types': 1,
  scripts: 15,
  'supabase/functions': 55,
  'supabase/migrations': 93,
  'supabase/queries': 15,
  'supabase/templates': 1,
};

const RULE = 'docs/conventions.md, "Source-text tests"';
const TEST_FILE = /\.test\.tsx?$/;
const READS_FILES = /readFileSync|Bun\.file\(|readFile\(/;
const MARKER = /^\s*\/\/\s*source-text:(.*)$/m;
const TWO_SEGMENT_ROOTS = new Set(['apps', 'packages', 'supabase']);

// `apps/frontend`, `supabase/functions`, `scripts`; `.` for root files.
export function sourceTextArea(path: string): string {
  const parts = path.split('/');
  if (parts.length === 1) return '.';
  if (TWO_SEGMENT_ROOTS.has(parts[0]) && parts.length > 2) {
    return parts.slice(0, 2).join('/');
  }
  return parts[0];
}

export function findSourceTextProblems(
  files: { path: string; text: string }[],
  recorded: Record<string, number>,
): string[] {
  const counts = new Map<string, number>();
  const problems: string[] = [];
  for (const { path, text } of files) {
    if (!TEST_FILE.test(path) || !READS_FILES.test(text)) continue;
    const marker = MARKER.exec(text);
    if (marker && marker[1].trim() !== '') continue;
    if (marker)
      problems.push(`${path}: "// source-text:" needs a reason (${RULE})`);
    const area = sourceTextArea(path);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const areas = new Set([...counts.keys(), ...Object.keys(recorded)]);
  for (const area of [...areas].sort()) {
    const actual = counts.get(area) ?? 0;
    const expected = recorded[area] ?? 0;
    const change = `${area}: test files that read files without a marker went from ${expected} to ${actual}`;
    if (actual > expected) {
      problems.push(
        `${change}. Test the behavior instead, or add a "// source-text: <reason>" line where the text is the contract (${RULE})`,
      );
    } else if (actual < expected) {
      problems.push(
        `${change}; lower SOURCE_TEXT_TEST_COUNTS['${area}'] to ${actual}`,
      );
    }
  }
  return problems;
}

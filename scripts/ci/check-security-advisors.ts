// Runs the Supabase security advisors against the local stack and fails on any
// WARN or ERROR finding that is not accepted in security-advisor-exceptions.ts,
// and on an accepted entry that no finding matches any more. `--input` reads a
// saved JSON output instead of calling the CLI (tests use it).
import { readFileSync } from 'node:fs';

import { ACCEPTED_SECURITY_FINDINGS } from './security-advisor-exceptions';

// One entry of `results` in `supabase db advisors --output-format json`.
export type AdvisorFinding = {
  name: string;
  level: 'ERROR' | 'WARN' | 'INFO';
  cacheKey: string;
  detail: string;
};

const USAGE =
  'Usage: bun scripts/ci/check-security-advisors.ts [--input <advisors.json>]';
const EXCEPTIONS_FILE = 'scripts/ci/security-advisor-exceptions.ts';

export function compareFindings(
  findings: AdvisorFinding[],
  accepted: Record<string, string>,
): { unexpected: AdvisorFinding[]; stale: string[] } {
  const reported = new Set(findings.map((finding) => finding.cacheKey));
  return {
    unexpected: findings.filter(
      (finding) =>
        finding.level !== 'INFO' && !Object.hasOwn(accepted, finding.cacheKey),
    ),
    stale: Object.keys(accepted).filter((key) => !reported.has(key)),
  };
}

function isFinding(value: unknown): value is AdvisorFinding {
  if (typeof value !== 'object' || value === null) return false;
  const finding = value as Record<string, unknown>;
  return (
    typeof finding.name === 'string' &&
    typeof finding.cacheKey === 'string' &&
    ['ERROR', 'WARN', 'INFO'].includes(finding.level as string)
  );
}

function runAdvisors(): string {
  const run = Bun.spawnSync(
    [
      'supabase',
      'db',
      'advisors',
      '--type',
      'security',
      '--level',
      'info',
      '--fail-on',
      'none',
      '--output-format',
      'json',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  // With JSON output the CLI writes its own errors to stdout.
  if (run.exitCode !== 0)
    throw new Error(
      `exit ${run.exitCode}: ${run.stderr.toString().trim()} ${run.stdout.toString().trim()}`.trim(),
    );
  return run.stdout.toString();
}

function main(): number {
  const args = process.argv.slice(2);
  const input =
    args.length === 2 && args[0] === '--input' ? args[1] : undefined;
  if (args.length > 0 && !input) {
    console.error(USAGE);
    return 2;
  }

  let text: string;
  try {
    text = input ? readFileSync(input, 'utf8') : runAdvisors();
  } catch (error) {
    const source = input
      ? `could not read ${input}`
      : 'could not run supabase db advisors';
    console.error(
      `check-security-advisors: ${source}: ${(error as Error).message}`,
    );
    return 2;
  }
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    console.error(
      `check-security-advisors: the advisor output is not JSON: ${text.slice(0, 500)}`,
    );
    return 2;
  }
  const findings: unknown =
    typeof output === 'object' && output !== null
      ? (output as { results?: unknown }).results
      : undefined;
  if (!Array.isArray(findings) || !findings.every(isFinding)) {
    console.error(
      'check-security-advisors: the advisor output is not a list of findings.',
    );
    return 2;
  }

  const { unexpected, stale } = compareFindings(
    findings,
    ACCEPTED_SECURITY_FINDINGS,
  );
  for (const finding of unexpected)
    console.error(`${finding.level} ${finding.cacheKey}: ${finding.detail}`);
  for (const key of stale)
    console.error(
      `${key}: accepted in ${EXCEPTIONS_FILE} but no longer reported; remove the entry.`,
    );
  if (unexpected.length > 0 || stale.length > 0) {
    if (unexpected.length > 0)
      console.error(
        `check-security-advisors: fix each new finding, or accept it with the maintainer's decision and a reason in ${EXCEPTIONS_FILE}.`,
      );
    return 1;
  }
  const count = Object.keys(ACCEPTED_SECURITY_FINDINGS).length;
  console.log(
    `check-security-advisors: ${count} accepted findings, nothing new.`,
  );
  return 0;
}

if (import.meta.main) process.exit(main());

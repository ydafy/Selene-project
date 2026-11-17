// Runs one group of verification harnesses in sequence, one `bun` process at a
// time: the harnesses share fixed ids (admin …0001, seller …0002, buyer …0003),
// so they must never run in parallel. Every file in scripts/verify/ is listed
// exactly once below; scripts/guards/verify-harness-lists.test.ts checks it.
// Usage: bun scripts/verify/run-harnesses.ts --group pr|weekly
import { join } from 'node:path';

// `pr`: needs only the `supabase start` Postgres. The *.probes.ts files are
// standalone scripts (not imported by their harness), so they run here too.
// `weekly`: also needs `supabase functions serve` or the docker-compose
// Postgres of `db:test:up`.
export const HARNESS_GROUPS = {
  pr: [
    'test-shipment-cancellation-refund-events.ts',
    'test-shipment-cancellation-refund-status.ts',
    'test-shipment-cancellation-refund-resolution.ts',
    'test-shipment-cancellation-refund-resolution.probes.ts',
    'test-shipment-refund-problems.ts',
    'test-shipment-refund-problems.probes.ts',
    'test-shipment-cancellation-summary.ts',
    'test-shipment-carrier-cancellation.ts',
    'test-shipment-carrier-review.ts',
    'test-tracking-cancelled-shipment.ts',
    'test-shipment-tracking-during-cancellation.ts',
    'test-shipment-label-reconciliation.ts',
    'test-cron-health.ts',
    'test-auto-cancel-lease.ts',
    'test-checkout-recovery-lease.ts',
    'test-shipment-lifecycle-model.ts',
  ],
  weekly: [
    'test-auto-cancel-paid-timeout.ts',
    'test-account-closure-cleanup.ts',
    'verify-stripe-fee-lease-recovery.ts',
    'postgres-smoke.ts',
    'test-shipment-cancellation-coordination.ts',
    'test-shipment-transfer-coordination.ts',
  ],
} as const satisfies Record<string, readonly string[]>;

export type HarnessGroup = keyof typeof HARNESS_GROUPS;

// Files no runner group runs, each with the reason.
export const MANUAL_HARNESSES: Readonly<Record<string, string>> = {
  'confirm-shipment-delivery-harness.ts':
    'needs deployed fixtures and a bearer token',
  'schema-fingerprint.sql': 'compares against the remote project',
  'declarative-schema-check.ts': 'already runs in the db-test CI job',
  'verify-payout-recovery-adapters.ts': 'offline; bun test covers it',
};

// The runner itself.
export const HARNESS_TOOLING: readonly string[] = ['run-harnesses.ts'];

// Unit tests of a harness, run by `bun test`.
export function isHarnessHelper(file: string): boolean {
  return file.endsWith('.test.ts');
}

export interface HarnessLists {
  groups: Readonly<Record<string, readonly string[]>>;
  manual: Readonly<Record<string, string>>;
  tooling: readonly string[];
}

const DEFAULT_LISTS: HarnessLists = {
  groups: HARNESS_GROUPS,
  manual: MANUAL_HARNESSES,
  tooling: HARNESS_TOOLING,
};

// `files` are names relative to scripts/verify/. Returns one message per problem.
export function checkHarnessLists(
  files: readonly string[],
  lists: HarnessLists = DEFAULT_LISTS,
): string[] {
  const where = new Map<string, string[]>();
  const add = (file: string, list: string) =>
    where.set(file, [...(where.get(file) ?? []), list]);

  for (const [group, entries] of Object.entries(lists.groups))
    for (const file of entries) add(file, group);
  for (const file of Object.keys(lists.manual)) add(file, 'manual');
  for (const file of lists.tooling) add(file, 'tooling');
  for (const file of files) if (isHarnessHelper(file)) add(file, 'helper');

  const present = new Set(files);
  const problems: string[] = [];
  for (const file of [...new Set([...files, ...where.keys()])].sort()) {
    const listed = where.get(file) ?? [];
    const path = `scripts/verify/${file}`;
    if (!present.has(file)) {
      problems.push(
        `${path} is listed in ${listed.join(', ')} but does not exist`,
      );
    } else if (listed.length === 0) {
      problems.push(
        `${path} is in no list (add it to a group, the manual list, or make it a *.test.ts helper)`,
      );
    } else if (listed.length > 1) {
      problems.push(`${path} is listed more than once (${listed.join(', ')})`);
    }
  }
  return problems;
}

const USAGE = [
  'Usage: bun scripts/verify/run-harnesses.ts --group pr|weekly',
  '  Runs the group of harnesses in scripts/verify/ one at a time and exits 1 if any fails.',
  '  pr:     needs `supabase start`.',
  '  weekly: also needs `supabase functions serve` and `bun run db:test:up`.',
].join('\n');

export interface RunnerIo {
  // Runs scripts/verify/<file> and resolves to its exit code.
  spawn: (file: string) => Promise<number>;
  now: () => number;
  out: (line: string) => void;
  err: (line: string) => void;
}

type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'run'; group: HarnessGroup }
  | { kind: 'usage-error'; message: string };

function isGroup(value: string): value is HarnessGroup {
  return Object.hasOwn(HARNESS_GROUPS, value);
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let group: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--group') {
      group = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--group=')) {
      group = arg.slice('--group='.length);
    } else {
      return { kind: 'usage-error', message: `Unknown argument: ${arg}` };
    }
  }
  if (!group) return { kind: 'usage-error', message: 'Missing --group' };
  if (!isGroup(group))
    return { kind: 'usage-error', message: `Unknown group: ${group}` };
  return { kind: 'run', group };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export async function runHarnessCli(
  argv: readonly string[],
  io: RunnerIo,
): Promise<number> {
  const args = parseArgs(argv);
  switch (args.kind) {
    case 'help':
      io.out(USAGE);
      return 0;
    case 'usage-error':
      io.err(args.message);
      io.err(USAGE);
      return 2;
    case 'run':
      break;
  }

  const files = HARNESS_GROUPS[args.group];
  const failed: string[] = [];
  const started = io.now();
  for (const file of files) {
    io.out(`RUN  ${file}`);
    const fileStarted = io.now();
    let failure: string | null;
    try {
      const code = await io.spawn(file);
      failure = code === 0 ? null : `exit ${code}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const took = seconds(io.now() - fileStarted);
    if (failure === null) {
      io.out(`PASS ${file} ${took}`);
    } else {
      failed.push(file);
      io.out(`FAIL ${file} ${took} (${failure})`);
    }
  }

  io.out(
    `${args.group}: ${files.length - failed.length} passed, ${failed.length} failed in ${seconds(io.now() - started)}`,
  );
  if (failed.length > 0) io.out(`failed: ${failed.join(', ')}`);
  return failed.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..');
  const code = await runHarnessCli(Bun.argv.slice(2), {
    spawn: async (file) => {
      const proc = Bun.spawn(
        [process.execPath, join(root, 'scripts', 'verify', file)],
        { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] },
      );
      return proc.exited;
    },
    now: () => performance.now(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exit(code);
}

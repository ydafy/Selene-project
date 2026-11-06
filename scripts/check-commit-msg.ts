// Rejects commit messages whose header is not a Conventional Commit or that carry
// a Co-authored-by or AI attribution line. Runs from the commit-msg hook with the
// path of the message file as the first argument, and from CI with
// `--range <base>..<head>` to check every commit of a pull request.
import { readFileSync } from 'node:fs';

export type CommitMessageCheck = { ok: true } | { ok: false; error: string };

const EXEMPT_PREFIXES = [
  'Merge ',
  'Revert "',
  'fixup! ',
  'squash! ',
  'amend! ',
];
const HEADER_FORMAT =
  /^(feat|fix|docs|chore|refactor|test|perf|build|ci|style|revert)(\([a-z0-9._/-]+\))?!?: \S/;
const MAX_HEADER_LENGTH = 100;
// `git commit -v` appends the diff below this line; the hook sees it uncleaned.
const SCISSORS = /^# -+ >8 -+$/;
const AI_TOOLS =
  '(claude|anthropic|chatgpt|openai|copilot|codex|gemini|cursor|aider)';
const ATTRIBUTION = [
  /^co-authored-by\s*:/i,
  /🤖/u,
  new RegExp(`^generated[ -](with|by|using)\\b.*\\b${AI_TOOLS}\\b`, 'i'),
  // Any `*-by:` trailer naming an AI tool: Signed-off-by, Assisted-by, ...
  new RegExp(`^[a-z]+(-[a-z]+)*-by\\s*:.*\\b${AI_TOOLS}\\b`, 'i'),
];
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

const FORMAT_ERROR =
  'commit-msg: the header must follow Conventional Commits, for example "fix(orders): keep the shipment status after a refund". Allowed types: feat, fix, docs, chore, refactor, test, perf, build, ci, style, revert.';

export function checkCommitMessage(message: string): CommitMessageCheck {
  const lines = message.split(/\r?\n/);
  const scissors = lines.findIndex((line) => SCISSORS.test(line));
  const content = (scissors === -1 ? lines : lines.slice(0, scissors)).filter(
    (line) => !line.startsWith('#'),
  );

  const attribution = content.find((line) =>
    ATTRIBUTION.some((pattern) =>
      pattern.test(line.replace(ZERO_WIDTH, '').trim()),
    ),
  );
  if (attribution !== undefined)
    return {
      ok: false,
      error: `commit-msg: remove "${attribution.trim()}"; commits carry no Co-authored-by or AI attribution lines.`,
    };

  const header = content.find((line) => line.trim() !== '') ?? '';
  if (EXEMPT_PREFIXES.some((prefix) => header.startsWith(prefix)))
    return { ok: true };
  if (!HEADER_FORMAT.test(header)) return { ok: false, error: FORMAT_ERROR };
  if (header.length > MAX_HEADER_LENGTH)
    return {
      ok: false,
      error: `commit-msg: the header is ${header.length} characters; keep it at ${MAX_HEADER_LENGTH} or fewer.`,
    };
  return { ok: true };
}

// One `<sha>: <error>` line per failing commit in the range, oldest first.
function checkCommitRange(range: string): string[] {
  // Hooks export GIT_DIR and friends; git must use the working directory.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  const git = (args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { env });
    if (result.exitCode !== 0)
      throw new Error(
        `commit-msg: git ${args[0]} ${args.at(-1)} failed: ${result.stderr.toString().trim()}`,
      );
    return result.stdout.toString();
  };
  return git(['rev-list', '--reverse', range])
    .split('\n')
    .filter(Boolean)
    .flatMap((sha) => {
      const result = checkCommitMessage(git(['log', '-1', '--format=%B', sha]));
      return result.ok ? [] : [`${sha}: ${result.error}`];
    });
}

if (import.meta.main) {
  const [first, second] = process.argv.slice(2);
  if (first === '--range') {
    const sides = second?.split('..') ?? [];
    if (sides.length !== 2 || sides.some((side) => side === '')) {
      console.error('commit-msg: --range expects <base>..<head>.');
      process.exit(1);
    }
    try {
      const errors = checkCommitRange(second);
      if (errors.length > 0) {
        console.error(errors.join('\n'));
        process.exit(1);
      }
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  } else {
    if (!first) {
      console.error('commit-msg: expected the path of the message file.');
      process.exit(1);
    }
    const result = checkCommitMessage(readFileSync(first, 'utf8'));
    if (!result.ok) {
      console.error(result.error);
      process.exit(1);
    }
  }
}

// Rejects commit messages whose header is not a Conventional Commit. Runs from the
// commit-msg hook with the path of the message file as the first argument.
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

const FORMAT_ERROR =
  'commit-msg: the header must follow Conventional Commits, for example "fix(orders): keep the shipment status after a refund". Allowed types: feat, fix, docs, chore, refactor, test, perf, build, ci, style, revert.';

export function checkCommitMessage(message: string): CommitMessageCheck {
  const header =
    message
      .split(/\r?\n/)
      .find((line) => line.trim() !== '' && !line.startsWith('#')) ?? '';

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

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error('commit-msg: expected the path of the message file.');
    process.exit(1);
  }
  const result = checkCommitMessage(readFileSync(file, 'utf8'));
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
}

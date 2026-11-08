// Reads the `uses:` lines of a GitHub Actions workflow. Shared by the pin guard
// (workflow-actions.test.ts) and the weekly dependency report.

export type ActionUse = {
  line: number;
  // `owner/repo`; a path inside the repository is dropped.
  action: string;
  // Empty when the line has no `@`, so the pin guard fails on it.
  ref: string;
  // The release tag in the trailing comment, as in `@<sha> # v4.4.0`.
  tag: string | undefined;
};

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)["']?\s*(?:#\s*(\S+))?/;

export function parseActionUses(text: string): ActionUse[] {
  const uses: ActionUse[] = [];
  text.split(/\r?\n/).forEach((content, index) => {
    const match = content.match(USES);
    if (!match) return;
    const [target, ref = ''] = match[1].split('@');
    // Local and Docker actions have nothing to pin.
    if (target.startsWith('.') || target.startsWith('docker://')) return;
    uses.push({
      line: index + 1,
      action: target.split('/').slice(0, 2).join('/'),
      ref,
      tag: match[2],
    });
  });
  return uses;
}

// Reads the `uses:` lines of a GitHub Actions workflow. Shared by the pin guard
// (workflow-actions.test.ts) and the weekly dependency report.

export type ActionUse = {
  line: number;
  // `owner/repo`; a path inside the repository is dropped.
  action: string;
  ref: string;
  // The release tag in the trailing comment, as in `@<sha> # v4.4.0`.
  tag: string | undefined;
};

const USES =
  /^\s*(?:-\s+)?uses:\s*["']?([^\s"'@]+)@([^\s"'#]+)["']?\s*(?:#\s*(\S+))?/;

export function parseActionUses(text: string): ActionUse[] {
  const uses: ActionUse[] = [];
  text.split(/\r?\n/).forEach((content, index) => {
    const match = content.match(USES);
    if (!match) return;
    uses.push({
      line: index + 1,
      action: match[1].split('/').slice(0, 2).join('/'),
      ref: match[2],
      tag: match[3],
    });
  });
  return uses;
}

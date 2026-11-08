// Markdown lives in a few known homes (docs/conventions.md, "Operational docs"),
// so runbooks and deployment notes do not scatter next to code again.

const ALLOWED_FOLDERS = ['docs/', 'odd/', 'design/', '.agents/', '.github/'];
const ALLOWED_ANYWHERE = ['AGENTS.md', 'README.md'];
const ALLOWED_AT_ROOT = ['DESIGN.md', 'SECURITY.md'];

export function findMisplacedMarkdown(repoFiles: string[]): string[] {
  return repoFiles.filter((file) => {
    if (!file.toLowerCase().endsWith('.md')) return false;
    if (ALLOWED_FOLDERS.some((folder) => file.startsWith(folder))) return false;
    if (ALLOWED_AT_ROOT.includes(file)) return false;
    const name = file.slice(file.lastIndexOf('/') + 1);
    return !ALLOWED_ANYWHERE.includes(name);
  });
}

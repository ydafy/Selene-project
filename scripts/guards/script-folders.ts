// Every script sits in the folder for its purpose (docs/conventions.md,
// "Repository scripts"), so scripts/ does not grow flat again.

const PURPOSE_FOLDERS = ['dev', 'ci', 'guards', 'verify'];

export function findMisplacedScripts(repoFiles: string[]): string[] {
  return repoFiles.filter((file) => {
    if (!file.startsWith('scripts/')) return false;
    const parts = file.split('/');
    return parts.length < 3 || !PURPOSE_FOLDERS.includes(parts[1]);
  });
}

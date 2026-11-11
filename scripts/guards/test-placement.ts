// Tests sit next to the file they test (docs/conventions.md, "Test placement").
// These `__tests__/` folders predate the rule; nothing new goes in this list.
export const LEGACY_TEST_FOLDERS = [
  'supabase/functions/__tests__',
  'supabase/functions/_shared/__tests__',
] as const;

// Every `__tests__/` folder and a top-level `tests/` folder, from file paths.
function listTestFolders(repoFiles: string[]): Set<string> {
  const folders = new Set<string>();
  for (const file of repoFiles) {
    const parts = file.split('/');
    if (parts[0] === 'tests' && parts.length > 1) folders.add('tests');
    parts.slice(0, -1).forEach((part, index) => {
      if (part === '__tests__') {
        folders.add(parts.slice(0, index + 1).join('/'));
      }
    });
  }
  return folders;
}

export function findTestFolderProblems(
  repoFiles: string[],
  legacy: readonly string[],
): string[] {
  const folders = listTestFolders(repoFiles);
  const allowed = new Set(legacy);
  const added = [...folders]
    .filter((folder) => !allowed.has(folder))
    .sort()
    .map(
      (folder) =>
        `${folder}/: new test folder; put the test next to the file it tests (docs/conventions.md, "Test placement")`,
    );
  const gone = legacy
    .filter((folder) => !folders.has(folder))
    .map(
      (folder) =>
        `${folder}/: listed in LEGACY_TEST_FOLDERS but it no longer exists; remove the entry`,
    );
  return [...added, ...gone];
}

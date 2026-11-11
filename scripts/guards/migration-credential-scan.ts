// Guard: no migration file (active or archived) and no supabase/seed.sql line
// carries a secret. Checked by migration-secrets.test.ts;
// supabase/tests/database/schema_invariants.test.sql checks the same patterns
// in the migrated database (function bodies, trigger arguments, foreign
// servers).

export type ScannedFile = { path: string; text: string };

// A JWT (such as a service_role key), Stripe secret and restricted keys, a
// Stripe webhook signing secret, and a Supabase secret key. A bare prefix with
// no key characters after it is not a secret.
const SECRET =
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk_(live|test)_[A-Za-z0-9]|rk_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9]/;

export const looksSecret = (text: string): boolean => SECRET.test(text);

// Every SQL file under supabase/migrations/ (archive/ included) and the seed,
// sorted so failures list in a stable order.
export function collectScannedFiles(repoFiles: string[]): string[] {
  return repoFiles
    .filter(
      (file) =>
        file === 'supabase/seed.sql' ||
        (file.startsWith('supabase/migrations/') && file.endsWith('.sql')),
    )
    .sort();
}

export function findSecretFiles(files: ScannedFile[]): string[] {
  return files.filter(({ text }) => looksSecret(text)).map(({ path }) => path);
}

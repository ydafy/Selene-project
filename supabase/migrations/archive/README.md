# Archived migrations

These files are the migration history from before the schema baseline. They were applied to the remote project manually through the Dashboard and are kept for reference and for the structural tests that read them.

Do not apply or replay them. The baseline migration at the top of `supabase/migrations/` already contains the resulting schema, and the Supabase CLI only reads top-level files in that directory.

Older docs and runbooks may still cite these files at their previous path, `supabase/migrations/<file>.sql`. Those docs record past deployments; the file now lives in this directory.

-- Issue #301: remove the unused `public-assets` bucket that
-- 20261020100001_storage_buckets_and_policies.sql creates. It was deleted from
-- project acoiclkeymgtlwcxilun in the Dashboard (#300), so this is a no-op
-- there; a database rebuilt from migrations still had it. No code reads it and
-- it holds no objects.
--
-- Storage's guard trigger storage.protect_delete() rejects a direct DELETE on
-- storage.buckets unless storage.allow_delete_query is 'true'. SET LOCAL keeps
-- the setting to this transaction.
--
-- Grant review: no privilege changes.
BEGIN;

SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.buckets WHERE id = 'public-assets';

COMMIT;

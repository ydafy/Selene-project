-- Maintainer-operated pre-launch reset; execute manually only.
-- Preserves Auth, Storage, system_settings, schema/migration history, profiles, products, and infrastructure.
-- SOLD/RESERVED product statuses are intentionally not restored because E2E will publish fresh products.
BEGIN;

TRUNCATE public.orders RESTART IDENTITY CASCADE;

COMMIT;

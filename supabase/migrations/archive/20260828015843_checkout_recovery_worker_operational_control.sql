BEGIN;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS checkout_recovery_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkout_recovery_running BOOLEAN NOT NULL DEFAULT false;

COMMIT;

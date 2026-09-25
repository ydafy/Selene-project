-- N4a additive expansion only. Apply after N4b client authority cutover
-- (20260923000000_notification_client_authority.sql) and its compatibility gate.
-- Metadata is NOT trustworthy for privileged presentation until producer cutover
-- and deployed writer compatibility verification (RLS/grants lockdown).
-- Without N4b, existing client write privileges may forge these fields;
-- neither this migration nor the unique index proves secure event provenance.
-- Payload is a non-sensitive presentation object; producers must whitelist fields.
-- Before deployment inventory table size and write rate (ALTER and non-concurrent
-- index creation take locks), RLS/grants, effective client INSERT privilege and
-- deployed function ACL. Clients could forge typed metadata before later lockdown:
-- do not enable privileged UI based solely on this migration.
-- Dashboard handoff: submit the whole file as one transaction, not individual
-- statements or selected lines. If Dashboard transaction semantics are unverified,
-- block deployment until confirmed. If execution is uncertain, ROLLBACK and inspect
-- the deployed schema and transaction state; never automatically retry.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND table_type = 'BASE TABLE'
  ) THEN
    RAISE EXCEPTION 'Expected public.notifications base table is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'user_id' AND data_type = 'uuid' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Unexpected notifications recipient column';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'event_kind'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'source_event_key'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'event_payload'
  ) THEN
    RAISE EXCEPTION 'Notification metadata already exists; inspect schema before applying N4a';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND conname IN (
        'notifications_event_payload_object_chk',
        'notifications_event_identity_pair_chk',
        'notifications_source_event_key_nonempty_chk',
        'notifications_event_kind_catalogue_chk'
      )
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'notifications_source_event_key_user_id_uidx'
  ) THEN
    RAISE EXCEPTION 'Notification metadata names already exist; inspect schema before applying N4a';
  END IF;
END;
$$;

ALTER TABLE public.notifications
  ADD COLUMN event_kind text,
  ADD COLUMN source_event_key text,
  ADD COLUMN event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT notifications_event_payload_object_chk
    CHECK (jsonb_typeof(event_payload) = 'object'),
  ADD CONSTRAINT notifications_event_identity_pair_chk
    CHECK ((event_kind IS NULL AND source_event_key IS NULL) OR
           (event_kind IS NOT NULL AND source_event_key IS NOT NULL)),
  ADD CONSTRAINT notifications_source_event_key_nonempty_chk
    CHECK (source_event_key IS NULL OR length(btrim(source_event_key)) > 0),
  ADD CONSTRAINT notifications_event_kind_catalogue_chk
    CHECK (event_kind IS NULL OR event_kind IN (
      'order.payment_confirmed',
      'shipment.cancelled',
      'dispute.opened',
      'dispute.verdict',
      'product.approved',
      'product.approved_with_note',
      'product.rejected',
      'return.seller_evidence_submitted',
      'return.delivered'
    ));

CREATE UNIQUE INDEX notifications_source_event_key_user_id_uidx
  ON public.notifications (source_event_key, user_id)
  WHERE source_event_key IS NOT NULL;

COMMIT;

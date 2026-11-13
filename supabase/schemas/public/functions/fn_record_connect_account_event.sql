CREATE OR REPLACE FUNCTION public.fn_record_connect_account_event (
  p_stripe_event_id         text,
  p_stripe_account_id       text,
  p_event_type              text,
  p_stripe_created          timestamp with time zone,
  p_payouts_enabled         boolean                  DEFAULT NULL::boolean,
  p_external_account_status text                     DEFAULT NULL::text,
  p_external_account_id     text                     DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_inserted BOOLEAN;
  v_account_id TEXT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_stripe_event_id IS NULL OR p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  IF p_event_type IS NULL OR p_event_type NOT IN (
    'account.updated', 'account.external_account.created',
    'account.external_account.updated', 'account.external_account.deleted'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_ACCOUNT_EVENT_TYPE';
  END IF;
  IF p_stripe_created IS NULL OR NOT isfinite(p_stripe_created) THEN
    RAISE EXCEPTION 'MISSING_STRIPE_CREATED';
  END IF;

  INSERT INTO internal.connect_account_events (
    stripe_event_id, stripe_account_id, event_type, stripe_created,
    payouts_enabled, external_account_status, external_account_id
  ) VALUES (
    p_stripe_event_id, p_stripe_account_id, p_event_type, p_stripe_created,
    p_payouts_enabled, p_external_account_status, p_external_account_id
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  IF v_inserted IS TRUE THEN
    RETURN TRUE;
  END IF;
  -- A second statement sees the winning concurrent insert at READ COMMITTED.
  -- If unavailable under another isolation level, reject rather than misbind.
  SELECT cae.stripe_account_id INTO v_account_id
  FROM internal.connect_account_events cae
  WHERE cae.stripe_event_id = p_stripe_event_id;
  IF v_account_id IS DISTINCT FROM p_stripe_account_id THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;
  RETURN FALSE;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) FROM PUBLIC, "anon", "authenticated";

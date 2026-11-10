CREATE OR REPLACE FUNCTION public.fn_acquire_connect_account_refresh (
  p_stripe_account_id text,
  p_source_event_id   text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_trigger_created TIMESTAMPTZ;
  v_generation BIGINT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  SELECT cae.stripe_created INTO v_trigger_created
  FROM public.connect_account_events cae
  WHERE cae.stripe_event_id = p_source_event_id
    AND cae.stripe_account_id = p_stripe_account_id;
  IF v_trigger_created IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;

  -- The PK upsert serializes even two first-ever acquisitions. Overflow raises
  -- rather than wrapping. No run lock and no network operation in acquisition.
  INSERT INTO public.connect_account_actionability (
    stripe_account_id, is_actionable, blocked_reason, stripe_created,
    source_event_id, refresh_generation, refresh_pending
  ) VALUES (
    p_stripe_account_id, FALSE, 'account_refresh_pending', v_trigger_created,
    p_source_event_id, 1, TRUE
  )
  ON CONFLICT (stripe_account_id) DO UPDATE
  SET refresh_generation = public.connect_account_actionability.refresh_generation + 1,
      refresh_pending = TRUE,
      is_actionable = FALSE,
      blocked_reason = 'account_refresh_pending',
      source_event_id = EXCLUDED.source_event_id,
      stripe_created = EXCLUDED.stripe_created,
      updated_at = clock_timestamp()
  RETURNING refresh_generation INTO v_generation;

  -- Setting the bit FALSE also fences the existing SQL claim eligibility join,
  -- which reads is_actionable directly. Existing runs are not changed here.
  RETURN v_generation;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_transition_stripe_fee_reconciliation_job_leased (
  p_job_id        uuid,
  p_claim_token   uuid,
  p_outcome       text,
  p_next_retry_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_last_error    text                     DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_job internal.stripe_fee_reconciliation_jobs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_job_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('retry', 'failed')
     OR (p_outcome = 'retry' AND p_next_retry_at IS NULL)
     OR (p_outcome = 'failed' AND p_next_retry_at IS NOT NULL)
     OR p_last_error IS NULL OR btrim(p_last_error) = ''
     OR char_length(p_last_error) > 4000 THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM internal.stripe_fee_reconciliation_jobs
  WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- clock_timestamp is evaluated AFTER acquiring the lock, not at transaction start.
  IF v_job.status <> 'processing'
     OR v_job.claim_token IS DISTINCT FROM p_claim_token
     OR v_job.claim_expires_at IS NULL
     OR v_job.claim_expires_at <= clock_timestamp() THEN
    RETURN FALSE;
  END IF;

  UPDATE internal.stripe_fee_reconciliation_jobs
  SET status = CASE p_outcome WHEN 'retry' THEN 'pending' ELSE 'failed' END,
      next_retry_at = p_next_retry_at, last_error = p_last_error,
      claim_token = NULL, claim_expires_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"(uuid, uuid, text, timestamp WITH time zone, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"(uuid, uuid, text, timestamp WITH time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"(uuid, uuid, text, timestamp WITH time zone, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"(uuid, uuid, text, timestamp WITH time zone, text) FROM PUBLIC, "anon", "authenticated";

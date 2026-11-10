CREATE OR REPLACE FUNCTION public.fn_transition_stripe_fee_reconciliation_job (
  p_job_id        uuid,
  p_outcome       text,
  p_next_retry_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_last_error    text                     DEFAULT NULL::text
)
  RETURNS public.stripe_fee_reconciliation_jobs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"(uuid, text, timestamp WITH time zone, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"(uuid, text, timestamp WITH time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"(uuid, text, timestamp WITH time zone, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"(uuid, text, timestamp WITH time zone, text) FROM PUBLIC, "anon", "authenticated";

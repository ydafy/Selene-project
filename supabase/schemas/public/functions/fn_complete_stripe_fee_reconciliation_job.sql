CREATE OR REPLACE FUNCTION public.fn_complete_stripe_fee_reconciliation_job (
  p_job_id                  uuid,
  p_actual_stripe_fee_cents bigint,
  p_reconciled_at           timestamp with time zone
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

GRANT EXECUTE ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"(uuid, bigint, timestamp WITH time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"(uuid, bigint, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"(uuid, bigint, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"(uuid, bigint, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

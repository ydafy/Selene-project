CREATE OR REPLACE FUNCTION public.fn_release_payout_claim (
  p_run_id      uuid,
  p_claim_token text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_released BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_run_id
    AND payout_claim_token = p_claim_token
  RETURNING TRUE INTO v_released;

  RETURN COALESCE(v_released, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_release_payout_claim"(uuid, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_release_payout_claim"(uuid, text) IS 'Releases the executor claim on a claimed run only when the claim token matches, so a stale worker cannot clear a lease a newer worker already holds. Server-only; execution restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_release_payout_claim"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_payout_claim"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_release_payout_claim"(uuid, text) FROM PUBLIC, "anon", "authenticated";

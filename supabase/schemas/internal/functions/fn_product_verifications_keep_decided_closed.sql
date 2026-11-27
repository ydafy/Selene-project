CREATE OR REPLACE FUNCTION internal.fn_product_verifications_keep_decided_closed()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  -- A decision is written once (odd/tasks/verification-history.md S1): a
  -- decided attempt is verification evidence and is never reopened or edited,
  -- whoever runs the update. A new submission is a new attempt.
  IF OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'a decided verification attempt cannot change'
      USING ERRCODE = '23514', DETAIL = format('product verification %s', OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "internal"."fn_product_verifications_keep_decided_closed"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "internal"."fn_product_verifications_keep_decided_closed"() TO "postgres";

REVOKE ALL ON FUNCTION "internal"."fn_product_verifications_keep_decided_closed"() FROM PUBLIC, "anon", "authenticated";

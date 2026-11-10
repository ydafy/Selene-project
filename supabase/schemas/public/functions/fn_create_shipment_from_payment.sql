CREATE OR REPLACE FUNCTION public.fn_create_shipment_from_payment (
  p_stripe_payment_intent_id text,
  p_amount_received          bigint,
  p_metadata                 jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  RAISE EXCEPTION 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED'
    USING HINT = 'Use the single-modal per-product settlement flow.';
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_create_shipment_from_payment"(text, bigint, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_create_shipment_from_payment"(text, bigint, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_create_shipment_from_payment"(text, bigint, jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_create_shipment_from_payment"(text, bigint, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_shipment_label_is_stuck (
  p_status           public.order_status_enum,
  p_state            text,
  p_claim_expires_at timestamp with time zone
)
  RETURNS boolean
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  SELECT COALESCE(
    p_status = 'paid' AND (
      p_state = 'orphan_pending'
      OR (p_state IN ('claimed', 'generation_sent') AND p_claim_expires_at <= clock_timestamp())
    ),
    false)
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp WITH time zone) TO "service_role";

COMMENT ON FUNCTION "public"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp with time zone) IS 'Service-only helper: true for a paid shipment whose label outcome is unproven (orphan_pending, or claimed/generation_sent with an expired claim). Shared by the list, the resolve and the reconcile functions.';

REVOKE ALL ON FUNCTION "public"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp WITH time zone) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_shipment_label_is_stuck"(public.order_status_enum, text, timestamp WITH time zone) FROM PUBLIC, "anon", "authenticated";

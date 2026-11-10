CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_orphan (
  p_shipment_id uuid,
  p_claim_token uuid,
  p_error_class text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments
    SET label_generation_state = 'orphan_pending', claim_expires_at = NULL, updated_at = now()
    WHERE id = p_shipment_id
      AND label_generation_state IN ('claimed', 'generation_sent')
      AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata)
    VALUES (p_shipment_id, 'orphaned', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END; $function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_shipment_label_orphan"(uuid, uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_label_orphan"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_shipment_label_orphan"(uuid, uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_label_orphan"(uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";

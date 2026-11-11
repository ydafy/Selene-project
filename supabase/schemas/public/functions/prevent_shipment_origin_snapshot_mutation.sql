CREATE OR REPLACE FUNCTION public.prevent_shipment_origin_snapshot_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF OLD.origin_address IS NOT NULL AND (
    NEW.origin_address IS DISTINCT FROM OLD.origin_address
    OR NEW.origin_address_id IS DISTINCT FROM OLD.origin_address_id
  ) THEN RAISE EXCEPTION 'ORIGIN_SNAPSHOT_IMMUTABLE'; END IF;
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() FROM "anon", "authenticated";

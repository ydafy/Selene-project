CREATE OR REPLACE FUNCTION public.fn_set_product_in_dispute()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_product_id UUID;
BEGIN
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT oi.product_id INTO v_product_id
  FROM public.shipments s
  JOIN public.order_items oi ON oi.shipment_id = s.id
  WHERE s.id = NEW.shipment_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.products
  SET status = 'IN_DISPUTE'::public.product_status_enum,
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD'::public.product_status_enum, 'RESERVED'::public.product_status_enum);

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_set_product_in_dispute"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_set_product_in_dispute"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_set_product_in_dispute"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_set_product_in_dispute"() FROM PUBLIC, "anon", "authenticated";

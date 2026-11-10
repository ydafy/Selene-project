CREATE OR REPLACE FUNCTION public.fn_notify_product_available (
  p_product_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  )
  SELECT
    f.user_id,
    'product.available',
    'product.available:' || p.id::text,
    jsonb_build_object('product_id', p.id, 'recipient_role', 'buyer'),
    '¡Ya puedes comprarlo!',
    p.name || ' ya está disponible en Selene.',
    'success',
    false,
    '/product/' || p.id::text
  FROM public.products p
  JOIN public.profiles_private pp ON pp.id = p.seller_id
  JOIN public.favorites f ON f.product_id = p.id
  WHERE p.id = ANY(p_product_ids)
    AND p.status = 'VERIFIED'
    AND p.deleted_at IS NULL
    AND pp.stripe_account_id IS NOT NULL
    AND pp.stripe_onboarding_status = 'complete'
    AND pp.status IS DISTINCT FROM 'suspended'
    AND pp.status IS DISTINCT FROM 'banned'
    AND f.user_id <> p.seller_id
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_notify_product_available"(uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_notify_product_available"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_notify_product_available"(uuid[]) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_notify_product_available"(uuid[]) FROM PUBLIC, "anon", "authenticated";

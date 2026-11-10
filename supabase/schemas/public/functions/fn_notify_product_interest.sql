CREATE OR REPLACE FUNCTION public.fn_notify_product_interest (
  p_product_id   uuid,
  p_favoriter_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_ready boolean;
  v_count integer;
  v_milestone integer;
  v_title text;
  v_lead text;
  v_follow_up text;
  v_action_path text;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  IF NOT FOUND OR v_product.seller_id = p_favoriter_id THEN
    RETURN;
  END IF;

  SELECT COALESCE(
    pp.stripe_account_id IS NOT NULL
      AND pp.stripe_onboarding_status = 'complete'
      AND pp.status IS DISTINCT FROM 'suspended'
      AND pp.status IS DISTINCT FROM 'banned',
    false
  )
  INTO v_ready
  FROM public.profiles_private pp
  WHERE pp.id = v_product.seller_id;

  IF v_product.status = 'PENDING_VERIFICATION' THEN
    v_follow_up := ' Envía tus pruebas para empezar a venderlo.';
    v_action_path := '/verify/' || v_product.id::text;
  ELSIF v_product.status = 'IN_REVIEW' THEN
    v_follow_up := ' Lo estamos revisando; te avisaremos al terminar.';
    v_action_path := '/profile/listings';
  ELSIF v_product.status = 'VERIFIED' AND NOT COALESCE(v_ready, false) THEN
    v_follow_up := ' Activa tus pagos para poder venderlo.';
    v_action_path := '/sell/onboarding';
  ELSE
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.favorites
  WHERE product_id = v_product.id
    AND user_id <> v_product.seller_id;

  v_milestone := CASE
    WHEN v_count >= 25 THEN 25
    WHEN v_count >= 10 THEN 10
    WHEN v_count >= 5 THEN 5
    WHEN v_count >= 1 THEN 1
  END;

  IF v_milestone IS NULL THEN
    RETURN;
  END IF;

  IF v_milestone = 1 THEN
    v_title := 'Tu producto genera interés';
    v_lead := 'Alguien guardó tu ' || v_product.name || ' en favoritos.';
  ELSE
    v_title := '¡Ya son ' || v_milestone::text || ' personas interesadas!';
    v_lead := v_milestone::text || ' personas guardaron tu ' || v_product.name || ' en favoritos.';
  END IF;

  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  )
  VALUES (
    v_product.seller_id,
    'product.interest',
    'product.interest:' || v_product.id::text || ':' || v_milestone::text,
    jsonb_build_object('product_id', v_product.id, 'recipient_role', 'seller', 'milestone', v_milestone),
    v_title,
    v_lead || v_follow_up,
    'info',
    false,
    v_action_path
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_notify_product_interest"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_notify_product_interest"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_notify_product_interest"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_notify_product_interest"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";

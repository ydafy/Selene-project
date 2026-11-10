CREATE OR REPLACE FUNCTION public.fn_enqueue_push_deliveries()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  INSERT INTO public.push_deliveries (notification_id, push_token_id, user_id, channel)
  SELECT NEW.id, t.id, NEW.user_id, pol.channel
  FROM public.push_event_policy pol
  JOIN public.push_tokens t ON t.user_id = NEW.user_id AND t.disabled_at IS NULL
  JOIN public.profiles p ON p.id = NEW.user_id AND p.deleted_at IS NULL
  WHERE pol.event_kind = NEW.event_kind
    AND pol.recipient_role = NEW.event_payload->>'recipient_role'
  FOR KEY SHARE OF t
  ON CONFLICT (notification_id, push_token_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_enqueue_push_deliveries"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_enqueue_push_deliveries"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_enqueue_push_deliveries"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_enqueue_push_deliveries"() FROM PUBLIC, "anon", "authenticated";

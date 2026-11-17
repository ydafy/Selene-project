CREATE OR REPLACE FUNCTION public.fn_broadcast_notification_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN SELECT DISTINCT changed.user_id FROM changed_rows changed LOOP
    PERFORM realtime.send(
      jsonb_build_object('op', lower(TG_OP)),
      'changed',
      'user:' || v_user_id::text || ':notifications',
      true
    );
  END LOOP;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_broadcast_notification_changes() IS 'Statement-level trigger on public.notifications: one private Realtime Broadcast message (event changed, no notification text) per distinct user to user:<user_id>:notifications. realtime.send catches its own errors and raises a warning, so a failed send never fails the notification write.';

GRANT EXECUTE ON FUNCTION "public"."fn_broadcast_notification_changes"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_broadcast_notification_changes"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_broadcast_notification_changes"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_broadcast_notification_changes"() FROM PUBLIC, "anon", "authenticated";

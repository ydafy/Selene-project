SET local check_function_bodies = off;

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

REVOKE ALL ON FUNCTION "public"."fn_broadcast_notification_changes"() FROM PUBLIC, "anon", "authenticated";

CREATE TRIGGER trg_notifications_broadcast_insert
  AFTER INSERT ON public.notifications REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_broadcast_notification_changes();

CREATE TRIGGER trg_notifications_broadcast_update
  AFTER UPDATE ON public.notifications REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_broadcast_notification_changes();

CREATE POLICY "notifications_owner_read_broadcast" ON "realtime"."messages"
  FOR SELECT
  TO "authenticated"
  USING (((EXTENSION = 'broadcast'::text) AND (topic = ( SELECT realtime.topic() AS topic)) AND (( SELECT realtime.topic() AS topic) = (('user:'::text || (( SELECT auth.uid() AS uid))::text) || ':notifications'::text))));

COMMENT ON FUNCTION "public"."fn_broadcast_notification_changes"() IS 'Statement-level trigger on public.notifications: one private Realtime Broadcast message (event changed, no notification text) per distinct user to user:<user_id>:notifications. realtime.send catches its own errors and raises a warning, so a failed send never fails the notification write.';

REVOKE ALL ON FUNCTION "public"."fn_broadcast_notification_changes"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_broadcast_notification_changes"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_broadcast_notification_changes"() TO "service_role";

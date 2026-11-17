CREATE POLICY "notifications_owner_read_broadcast" ON "realtime"."messages"
  FOR SELECT
  TO "authenticated"
  USING (((extension = 'broadcast'::text) AND (( SELECT realtime.topic() AS topic) = (('user:'::text || (( SELECT auth.uid() AS uid))::text) || ':notifications'::text))));

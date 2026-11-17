# Notifications realtime broadcast

Closes #425: the mobile app gets new and changed notifications live through a private Realtime Broadcast channel per user instead of `postgres_changes` on a table that is not published.
Branch `fix/notifications-realtime-broadcast` from `main` (`049c36e1`), main checkout. Engram mirror: `odd/notifications-realtime-broadcast/tasks`.

## Specs

- **S1 — Live notifications.** "lo que ocmentaste del NotificationWatcher, lo podemos arregalr?" The maintainer chose "Broadcast privado por usuario (Recomendado)": "Un trigger en la base avisa en el canal privado del usuario (user:<id>:notifications). Es lo que Supabase recomienda para notificaciones y escala mejor." An insert or update of a user's notifications reaches that user's running app, which refetches its list and unread count.
- **S2 — Only the owner listens.** From the chosen option: "una migración con una política RLS sobre realtime.messages y una verificación independiente por ser seguridad." A user can join and receive only `user:<own id>:notifications`; another user's topic, anon, and a public (non-private) channel get nothing.
- **S3 — No error for a transient drop.** "aveces en la ap si me muetrsa ese dev log error, pero nucna le puse atencion." A Realtime channel error or timeout does not show the user an error toast or a dev `console.error`; supabase-js rejoins by itself.
- **S4 — Related issues.** "checate si ae issues o sub-issues que omenten algo sobre esto para que puedas comentarlos o cerrarlos si es que cubres su issue aqui. Igual en engram, checate si se comeenta algo importate."

## Tasks

- [x] T1 — S1, S2. SQL: statement-level `AFTER INSERT` and `AFTER UPDATE` triggers on `public.notifications` (transition tables, no `WHEN`) call one `SECURITY DEFINER` function that sends one private `realtime.send` message per distinct `user_id` to `user:<user_id>:notifications`, event `changed`, payload with no notification text (L3). An RLS `SELECT` policy on `realtime.messages` for `authenticated` allows only `extension = 'broadcast'` and `realtime.topic() = 'user:' || auth.uid() || ':notifications'`. A failed send never fails the notification write. pgTAP `notification_broadcast.test.sql`. Worker (context backstop). Commit: fix(notifications): broadcast changes on a private per-user channel.
- [ ] T2 — S1, S3. Frontend `NotificationWatcher`: private channel `user:<id>:notifications`, `broadcast` event `changed` invalidates the notification keys, `supabase.realtime.setAuth()` before subscribing, `CHANNEL_ERROR`/`TIMED_OUT` log a `console.warn` and show no toast. Tests. Commit: pending.
- [ ] T3 — S1, S2, S3. Local end-to-end proof on the stack: the owner's private channel receives an insert and an update, another user and anon do not; the old `postgres_changes` subscription reproduces the error. Verifier (Risk: item 2). Commit: none (evidence in Log).
- [ ] T4 — S4. PR body `Closes #425`; comment on #425 (Broadcast instead of the publication, why) and #654 (load test includes the per-user channels). Commit: none.

## Log

- **L1** — User request, 2026-11-16:

  > okey, si lo de pagarf el plan de supabse ya esta conteplado. Ahora lo que ocmentaste del NotificationWatcher, lo podemos arregalr? y ahora que lo comentas, aveces en la ap si me muetrsa ese dev log error, pero nucna le puse atencion.

  Choice for "¿Cómo querés que la app reciba las notificaciones en tiempo real?": "Broadcast privado por usuario (Recomendado)".

- **L2** — User request, 2026-11-16:

  > master, antes de empezar si es un cambio medio/grande, tu dime si quieres hacer el roadmap. Y segundo, antes de empezar checate si ae issues o sub-issues que omenten algo sobre esto para que puedas comentarlos o cerrarlos si es que cubres su issue aqui. Igual en engram, checate si se comeenta algo importate.

  Decision: no roadmap (one feature, one PR). Related: #425 (closed by this PR), #652 (event-only notifications; untouched), #654 (load test; comment), #450 (retention; untouched). Engram: the 2026-08 notification-mvp-plus session left "Verificar Supabase Realtime habilitado para tabla notifications" pending; the 2026-06 fix kept a single subscription owner (`NotificationWatcher`), because `supabase.channel()` returns the same instance for the same topic.

- **L3** — Design, 2026-11-16: the broadcast payload carries no notification text, so roadmap #652 (render text in the app) does not change it. Statement-level triggers send one message per user per statement, so "mark all as read" costs one Realtime message, not one per row (Free plan: 2 million messages a month). Remote state (MCP, read-only): `supabase_realtime` publishes only `products`; no client subscribes to `products`. Local realtime `v2.154.0` (`supabase/supabase.lock`).

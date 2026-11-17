# Notifications realtime broadcast

Closes #425: the mobile app gets new and changed notifications live through a private Realtime Broadcast channel per user instead of `postgres_changes` on a table that is not published.
Branch `fix/notifications-realtime-broadcast` from `main` (`049c36e1`), main checkout. Engram mirror: `odd/notifications-realtime-broadcast/tasks`.

## Specs

- **S1 — Live notifications.** "lo que ocmentaste del NotificationWatcher, lo podemos arregalr?" The maintainer chose "Broadcast privado por usuario (Recomendado)": "Un trigger en la base avisa en el canal privado del usuario (user:<id>:notifications). Es lo que Supabase recomienda para notificaciones y escala mejor." An insert or update of a user's notifications reaches that user's running app, which refetches its list and unread count.
- **S2 — Only the owner listens.** From the chosen option: "una migración con una política RLS sobre realtime.messages y una verificación independiente por ser seguridad." A user can join and receive only `user:<own id>:notifications`; another user's topic, anon, and a public (non-private) channel get nothing.
- **S3 — No error for a transient drop.** "aveces en la ap si me muetrsa ese dev log error, pero nucna le puse atencion." A Realtime channel error or timeout does not show the user an error toast or a dev `console.error`; supabase-js rejoins by itself.
- **S4 — Related issues.** "checate si ae issues o sub-issues que omenten algo sobre esto para que puedas comentarlos o cerrarlos si es que cubres su issue aqui. Igual en engram, checate si se comeenta algo importate."

## Tasks

- [x] T1 — S1, S2. SQL: statement-level `AFTER INSERT` and `AFTER UPDATE` triggers on `public.notifications` (transition tables, no `WHEN`) call one `SECURITY DEFINER` function that sends one private `realtime.send` message per distinct `user_id` to `user:<user_id>:notifications`, event `changed`, payload with no notification text (L3). An RLS `SELECT` policy on `realtime.messages` for `authenticated` allows only `extension = 'broadcast'` and `realtime.topic() = 'user:' || auth.uid() || ':notifications'`. A failed send never fails the notification write. The policy also requires the row's `topic` to equal the session topic (defense in depth, L4). pgTAP `notification_broadcast.test.sql`. Worker (context backstop). Commits: `fix(notifications): broadcast changes on a private per-user channel`, `fix(notifications): match the row topic in the broadcast policy`.
- [x] T2 — S1, S3. Frontend `NotificationWatcher`: private channel `user:<id>:notifications`, `broadcast` event `changed` invalidates the notification keys, `supabase.realtime.setAuth()` before subscribing, `CHANNEL_ERROR`/`TIMED_OUT` log a `console.warn` and show no toast. Tests. Worker. Commit: `fix(notifications): listen on the private broadcast channel`.
- [x] T3 — S1, S2, S3. Local end-to-end proof on the stack: the owner's private channel receives an insert and an update, another user and anon do not; the old `postgres_changes` subscription reproduces the error. Verifier (Risk: item 2). Evidence in L5; its regression probes (prefixed topic, sending on another user's topic) are in `notification_broadcast.test.sql`. Commit: `test(notifications): pin broadcast topic prefix and send denial`.
- [ ] T4 — S4. PR body `Closes #425`; comment on #425 (Broadcast instead of the publication, why) and #654 (load test includes the per-user channels). Commit: none.

## Log

- **L1** — User request, 2026-11-16:

  > okey, si lo de pagarf el plan de supabse ya esta conteplado. Ahora lo que ocmentaste del NotificationWatcher, lo podemos arregalr? y ahora que lo comentas, aveces en la ap si me muetrsa ese dev log error, pero nucna le puse atencion.

  Choice for "¿Cómo querés que la app reciba las notificaciones en tiempo real?": "Broadcast privado por usuario (Recomendado)".

- **L2** — User request, 2026-11-16:

  > master, antes de empezar si es un cambio medio/grande, tu dime si quieres hacer el roadmap. Y segundo, antes de empezar checate si ae issues o sub-issues que omenten algo sobre esto para que puedas comentarlos o cerrarlos si es que cubres su issue aqui. Igual en engram, checate si se comeenta algo importate.

  Decision: no roadmap (one feature, one PR). Related: #425 (closed by this PR), #652 (event-only notifications; untouched), #654 (load test; comment), #450 (retention; untouched). Engram: the 2026-08 notification-mvp-plus session left "Verificar Supabase Realtime habilitado para tabla notifications" pending; the 2026-06 fix kept a single subscription owner (`NotificationWatcher`), because `supabase.channel()` returns the same instance for the same topic.

- **L3** — Design, 2026-11-16: the broadcast payload carries no notification text, so roadmap #652 (render text in the app) does not change it. Statement-level triggers send one message per user per statement, so "mark all as read" costs one Realtime message, not one per row (Free plan: 2 million messages a month). Remote state (MCP, read-only): `supabase_realtime` publishes only `products`; no client subscribes to `products`. Local realtime `v2.154.0` (`supabase/supabase.lock`).

- **L4** — Decision, 2026-11-16: the T1 worker noted the policy checked only the session topic (`realtime.topic()`), not the row's `topic` column. `realtime` is not exposed through the API, so no client can query `realtime.messages` directly; the row-topic match was added anyway as cheap defense in depth, test first (two pgTAP cases failed on the old policy: 1 foreign row and 7 rows where 4 were expected).

- **L5** — T3 verifier evidence, 2026-11-17, local stack, installed supabase-js 2.118.0:
  - S1 met: user A's private channel got exactly one `changed` event per statement (insert, update, two-row insert, multi-row update, owner update through RLS, one statement for A and B); zero for B-only inserts and zero-row updates. Payload `{"op","id"}` only, no title, message or user_id.
  - S2 met: B and anon private joins on A's topic got `CHANNEL_ERROR: Unauthorized` and no events; public channels with A's topic name got no events; SQL as B with A's topic read 0 rows; inserts into `realtime.messages` are denied by RLS; the trigger function is not executable by anon or authenticated.
  - S3 met: the watcher only warns on `CHANNEL_ERROR`/`TIMED_OUT`. The old `postgres_changes` subscription got SUBSCRIBED plus a server system error "Unable to subscribe to changes with given parameters…" and never an event; realtime-js 2.118 does not pass that error to the subscribe callback, so the old toast most likely came from transport drops. Not reproduced: a real network drop could not be simulated (a client-side socket close rejoined with no `CHANNEL_ERROR` and kept receiving).
  - `bun run test:db` 89 files, 3190 tests PASS; notifications frontend tests 204 pass; `db:schema:check` OK; no defects in the three commits.
  - Coordination: rebased onto `main` `bc7b24d0` after #675 and #676; the main checkout was lent to the supabase-health session for its remote push of `20261117045551` and returned.

# Expo push notifications

Adds push as a second delivery channel for the persisted `notifications` inbox, and adds the missing shipment milestone events (in-app and push).
Branch `feat/expo-push-notifications`, worktree `C:/dev/School-portal-worktrees/expo-notifications`. Engram mirror: `odd/expo-push-notifications/tasks`.

## Specs

- **S1 — Push extends the in-app inbox.** "ya esta como un templete, que tenmos solo in app notfacition, tenemos que llevar esas in app a push, o decidir cuales se ocupan expandir a push". Every push is a `notifications` row also delivered by push; there is no second source of truth. The event kinds and roles that go to push are the matrix in L4.
- **S2 — Core events only.** "la idea es un push notidicairon para la v1 que es una mvp++ osea no ocupamos notifaciones para todo, si no lo core, que creo que casi el 80% de las noti ronda al tema de ordenes y ventas, el otro 20 es lo de favorios y avisar al comprador cunado un prodcuto esta disponible y al vendedor que sus productos llaman la atencion"
- **S3 — Durable without overengineering.** "la mejor para el rpeo sin sobreingenieria y escalable, osea, que lo que implembntemos funcione hoy  y dentro de 1-2 anos si lo dejamos asi, pero simepre con esa ventana de mejora"
- **S4 — Shipment milestones.** "s metamos t6, se me hace raro que no lo tuviera ya, ya que se trabajo en un modulo ed in app notifications, pero si metelo auqi es de lo mismo y adeemas ultra critico como comentas." Scope from L3: shipment in transit, shipment delivered, shipment completed with funds released, refund completed, and the reminder before a shipment that was never prepared is cancelled automatically.
- **S5 — No push to the buyer on payment confirmation.** "2. No no lo hacemos."
- **S6 — Ask for permission at a moment with value.** "la verdad me gusta mas cundo usario hace su primera compra, pero que pasa para los que guardan productops en fav para que les llegue notifiaciones? ahhi tambien podemos preguuntar no ?" Moments and rules in L6.
- **S7 — Real, not simulated.** "terminar este mmoudlo es igual a hacre pruebas reales aunque en modo sanbox de todo, no podemos simualr nada osae es contruilro de la manera mas real posible, obviamente con las limitantes del mero echo de estar en sanbox pero fuera de eso nada simulado."
- **S8 — Legacy is free to change.** "si eliminas algo, si tocas algo que afcete usarios ordenes pagos etc etc, no pasa nada, ningun uairo es afcetado, el agents md deve decir esto."

## Tasks

Planning forecast: about 3,500 authored changed lines over 12 tasks. Delivery strategy: `ask-on-risk`, decided when the branch passes about 400 lines before a push or PR.

- [x] T0 — S8. `AGENTS.md` test-data paragraph and this document. Inline. Commit: pending.
- [ ] T1 — S1, S3. `push_tokens` table, `fn_register_push_token` and `fn_unregister_push_token`, RLS and grants. One token per device, many per user; registering a token another user owns moves it. Security commit.
- [ ] T2 — S1, S2, S5. `push_deliveries` outbox, an `AFTER INSERT` trigger on `notifications` that fans out to active tokens for allowlisted kinds and roles (L4), and service-role claim and complete RPCs (`SKIP LOCKED`, attempts, expiry).
- [ ] T3 — S1, S3, S7. `dispatch-push` Edge Function on a one-minute `pg_cron` job: sends batches of 100 to the Expo Push API, stores tickets, checks receipts, disables `DeviceNotRegistered` tokens, skips read or stale notifications, purges old rows. Bruno request, `docs/go-live.md` (cron, `EXPO_ACCESS_TOKEN`).
- [ ] T4 — S4. Typed events `shipment.in_transit` (buyer) and `shipment.delivered` (buyer) from `fn_record_tracking_event` and `fn_mark_shipment_delivered`. Shipment SQL commit.
- [ ] T5 — S4. Typed event `shipment.completed` (seller, funds released) from `fn_release_shipment_funds`. Money SQL commit.
- [ ] T6 — S4, S8. Type the legacy producers without `event_kind`: `fn_complete_shipment_refund` (refund completed, buyer), `fn_cron_dispute_payout_timeout`, `fn_cron_dispute_shipping_timeout`, `fn_cron_return_delivery_timeout`. Remove `fn_create_order_from_payment` if no caller remains.
- [ ] T7 — S4. Seller reminder before `auto-cancel-orders` cancels a paid shipment without a label. Idempotent per shipment.
- [ ] T8 — S4. App presentation for the new kinds: `notificationPresentation`, launch digest priority, i18n English and Spanish.
- [ ] T9 — S1, S7. App: `expo-notifications`, config plugin, Android channels `orders` and `activity`, token register on sign-in and unregister on sign-out.
- [ ] T10 — S6. App: permission pre-prompt at the three moments in L6, and a notifications row in Settings that reflects the OS permission.
- [ ] T11 — S1. App: a tap on a push (warm and cold start) goes through `notificationPress`; no banner while the app is in the foreground.
- [ ] T12 — S7. Credentials (FCM, APNs, Expo access token), a development build, and a real-device end-to-end run on the local stack. Needs the maintainer for accounts.

## Log

- **L1 — Original request (2026-10-28).** "master primero que nada traite main y lo ultimo que tiene para estar lo mas actualizado. Luego en este woktree como su nombre lo dice, es planear la implementacion de expo notifiications en el repo, nunca lo eh echo y no tengo idea de como funciona asi que tu eres el encargado de que logica meter para que sea la mejor para el rpeo sin sobreingenieria y escalable, osea, que lo que implembntemos funcione hoy  y dentro de 1-2 anos si lo dejamos asi, pero simepre con esa ventana de mejora, la idea es un push notidicairon para la v1 que es una mvp++ osea no ocupamos notifaciones para todo, si no lo core, que creo que casi el 80% de las noti ronda al tema de ordenes y ventas, el otro 20 es lo de favorios y avisar al comprador cunado un prodcuto esta disponible y al vendedor que sus productos llaman la atencion, esto lo puedes bucar en engrm como en el repo ya que se hablo sobre esto, y sobre todo ya esta como un templete, que tenmos solo in app notfacition, tenemos que llevar esas in app a push, o decidir cuales se ocupan expandir a push. ENotnces discutamos y arma un plan y vamos disuctiendo"
- **L2 — Main synced.** The worktree fast-forwarded 56 commits to `origin/main` `5305281`, with no local changes.
- **L3 — Architecture accepted** ("Prefcto master me gusto mucho"). Push is a delivery channel of `notifications`. Producers do not change. An allowlist by `event_kind` and recipient role decides push. The trigger writes the outbox in the event's transaction. One cron-driven dispatcher handles send, receipts, and token cleanup. Left out of v1 on purpose, each addable later without rework: a preferences table, an immediate `pg_net` kick, a badge count, and grouping. Issue #52 (fixed Spanish text) stays open; push sends the stored text.
- **L4 — Push matrix.** `order.payment_confirmed` seller only (S5). `shipment.cancelled` both. `shipment.refund_failed` buyer. `dispute.opened` seller. `dispute.verdict` both. `return.delivered` and `return.seller_evidence_submitted` to their recipient. `product.approved`, `product.approved_with_note`, `product.rejected` seller. `product.available` buyer, channel `activity`. `product.interest` seller, channel `activity`. The new T4–T7 kinds go to push on channel `orders`.
- **L5 — Test data and legacy (S8).** The maintainer confirms that Supabase and Stripe hold only test data. Legacy producers may be removed or rewritten. Added to `AGENTS.md`.
- **L6 — Permission moments (S6), decided by the agent at the maintainer's request.** Never at first launch. A pre-prompt screen explains the value and opens the OS dialog only if the user accepts, so the one-time iOS dialog is not wasted. Moments: first completed purchase, first favorite saved, first listing submitted for verification. Each moment shows at most once per device and only while the OS status is undetermined. Settings always offers the switch; when the OS denied it, the row opens the OS settings.
- **L7 — Credentials start from zero (S7).** Android needs a Firebase project (free) and an FCM V1 key uploaded to EAS. iOS needs the Apple Developer Program. Until the maintainer has that account, T12 proves Android only.

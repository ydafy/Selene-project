# Media upload hardening

Make every mobile media upload fail safely, surface real errors, and keep buttons unavailable while work is pending.
Branch: `fix/mobile-ui-polish` | Delivery: one commit per block, pushed to `main` after merge + green suite.

## Specs

- S1 (verbatim): "Rara vez cunado un usario pyubica su producto y navega a 'verify' al momento de subir las fotos eh intentarlas enviar a nuestar db, el sistema falla, pero al cerrar y volver a la pantalla, ya no falla, pienso que es un tema de lodings, osea que la pantalla carga antes o cosas asi, es solo una teoria, tenndremos que ver porque pasa esto, ojo no pasa simepre, pasa por decirlo rara vez. ... igual checar esto, puede haber code smell o bad pcartices que podemos arreglar,"
- S2 (verbatim): "aprovecha en demas lugares invetsigar si puede pasar lo mismo, soea en los demas lugares donde usario suba media quero que la app siga las mejores prcaticas."
- S3 (verbatim): "si se hace un poco garnde el plan no pasa nada, lohacemos por bloques y cada uno con su propio commit y rdd y tdd."
- S4 (verbatim): "tambein ten en cuenat el dema de la disponibilidad de los botonees y sus loadings, ejemplo y ojo no se si asi es; usario termina de publicar su producto -> navega a la pantalla sell\succes ahi no se si el boton que dice 'Verifica' necesite primero cargar y luego ser preseable, no se si me entindas? como para evitar navegar a la pnatlla mientras algo estaba cargando y uqe es necesairo antes de avanzar."

Out of scope: session persistence and AppState token refresh (auth worktree, `audit/auth-sessions` commit `d8f9079`, not on main yet); storage bucket policies (auth/security backlog).

## Tasks

- B1 | S1, S4 | inline | Verify screen fails closed (load error + retry, loading state, abort on failed re-read, `.select()` on update, submit ref guard, i18n permission dialog, real error logged); success screen handoff (ref guard, disabled button) | Done, device-checked by maintainer | Commit: 5ae4408
- B2 | S2 | inline | Shared `core/storage/uploadMedia.ts` (`response.ok`, ext → MIME with jpg → image/jpeg, structured error log without paths); migrate verification and publish | Done, device-checked by maintainer (publish + verify) | Commit: this B2 commit
- B3 | S2, S4 | inline | Evidence, avatar, dispute video: use helper, remove unchecked `base64!`, i18n video strings, size check when picker omits size, buttons locked while uploading | Done, Android device-checked (evidence, avatar, video); iOS video accepted by type, not device-checked | Commit: this B3 commit
- B4 | S2 | deferred | Remove orphaned uploads when a later step fails; needs storage delete policies from the auth worktree | Commit: pending

## Log

- L1: S1 is the original request (verbatim above).
- L2: Audit (2026-10-21): supabase client has no auth storage (in-memory session) and no AppState refresh; fixed on `audit/auth-sessions` (`d8f9079`), not here. Five upload sites: verification, publish, evidence (prepare/return), avatar, dispute video. Confirmed: verify submits a GPU without benchmark when the product fetch fails (category null); verify writes `proof_physical` undefined when the re-read fails; verify shows success on a 0-row update; no `response.ok` checks; errors logged without detail; hardcoded Spanish in verify and `useVideoUpload`; three duplicated upload paths; `image/jpg` MIME.
- L3: S4 check: `sell/success` needs no data before "Verifica" (product already published, id from params). Defects: `dismissAll` + `setTimeout(150)` timing hack, `useState` double-tap guard, button not visibly disabled; verify screen renders blank while loading and must keep submit unavailable until loaded.
- L4: After `d8f9079` reaches main, the maintainer retests verification on device; that is where the S1 first-attempt failure is expected to stop.
- L5: B1 keeps the `sell/success` `dismissAll` + `setTimeout(150)` navigation unchanged: replacing it needs device proof of modal-to-root navigation. Open item for a device-validated follow-up. B1 adds `core/utils/verification-submit.ts` (requirements, submit rule, payload builder, safe error summary); the hook returns `'BUSY'` on a concurrent tap and the screen shows success only for `'SUCCESS'`. A resubmit while already `IN_REVIEW` now reports an error (RLS filters the row) instead of a false success. Native review assess is unassessable while untracked files exist in the worktree.
- L6: B3 adds `uploadMediaFromBase64` and `maxBytes` (`MEDIA_TOO_LARGE`). Worker had replaced the existing mount-test privacy guards (free-text error messages never logged) with weaker checks; parent restored them and made `describeError` log a message only when it is an own code (`MEDIA_|VERIFICATION_|VIDEO_` prefix). Resolved per maintainer ("ocupo que acepte ambas"): `.mov` -> `video/quicktime` and `.m4v` -> `video/x-m4v` are accepted; `MEDIA_TOO_LARGE` shows the `tooLarge` alert; the report screen logs `describeError` instead of the raw error. Open: iOS video upload and admin playback of `.mov` are unverified until an iOS device or TestFlight is available.

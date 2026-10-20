# Local PostgreSQL test environment
Reusable, disposable infrastructure only; no cancellation business implementation or remote access.
Branch: `feat/shipment-cancellations`. Delivery: ask-on-risk; forecast ~300 authored lines. User subsequently authorized local commits of this session's files only, with no push. Task entries below retain their original pre-authorization notes.

## Specs
S1. "Solo PostgreSQL para pruebas. No dockerizar frontend, backend ni todo Supabase."
S2. "Primero inspeccioná herramientas existentes y convenciones del repo." "Si falta Docker Desktop/WSL o instalarlo requiere permisos, cambios del sistema o reinicio, explicá exactamente qué hace falta y pedí autorización antes de hacerlo."
S3. "Elegí una versión compatible con el PostgreSQL del proyecto; documentá cómo la determinaste. No accedas al remoto sin autorización."
S4. "Configuración pequeña y reproducible: versión fijada, puerto publicado únicamente en localhost, healthcheck y credenciales exclusivamente locales de prueba." "Evitá conflictos con otros servicios; no detengas ni borres recursos existentes."
S5. "Documentá arranque, parada, conexión y limpieza explícita de los datos descartables." "Separá la configuración de infraestructura de los futuros tests de negocio."
S6. "Arrancar PostgreSQL y comprobar disponibilidad." "Verificar dos conexiones independientes."
S7. "Ejecutar una prueba pequeña de contención transaccional sobre datos sintéticos aislados: una conexión mantiene un bloqueo y la otra espera o recibe el rechazo esperado." "No confundir enviar dos promesas simultáneas con demostrar contención real."
S8. "Registrar comando, resultado y límites: esto verifica el entorno, no las reglas de cancelación."

## Tasks
- T1 [done] S2: WSL 3.0.3 and Docker Desktop 4.95.0 installed; after maintainer reboot local desktop-linux engine reports Docker 29.8.2/linux. Route inline; commit not authorized.
- T2 [done: static scope only] S1,S3,S4,S5: Compose, probe and guide implemented. Focused 6/6, suite 1683/1683, Compose config, scoped ESLint and formatting pass. Independent static verification found no concrete code blocker; scratch checks 19/19 pass. Route inline; commit not authorized.
- T3 [done] S6,S7,S8: Local engine and free localhost 55432 confirmed; Compose startup and live smoke exit 0. PostgreSQL 17.6 healthy; independent PIDs 77/76; B rejected with 55P03 under A lock, unchanged value 0, recovery value 1 visible to A and isolated schema cleanup verified. Commit not authorized.
- T4 [done: evidence recorded; native assessment unavailable] S8: Exact live command/output and effective localhost binding recorded. Intended-untracked scope declared through native inspect; inspect ready, but native assess still rejects undeclared untracked files. No reviewDue/continuation or lineage/verdict returned. Existing independent static verification and observed live checks stand; native approval is NOT claimed. Commit not authorized.

## Log
L1. Original request (verbatim):
> Prepará una configuración mínima de Docker para pruebas PostgreSQL locales del proyecto Selene. Implementá y verificá el
>  entorno, no solo una propuesta.
>
>    Proyecto/worktree:
>    C:/dev/School-portal-worktrees/shipment-cancellations
>    Branch: feat/shipment-cancellations
>
>    Objetivo:
>    Disponer de PostgreSQL local descartable para ejecutar SQL real y probar concurrencia con conexiones independientes. El
>  primer consumidor será B1.1 de shipment cancellations, pero el entorno debe poder reutilizarse en otros módulos.
>
>    Alcance MVP++:
>    - Solo PostgreSQL para pruebas. No dockerizar frontend, backend ni todo Supabase.
>    - Primero inspeccioná herramientas existentes y convenciones del repo.
>    - Si falta Docker Desktop/WSL o instalarlo requiere permisos, cambios del sistema o reinicio, explicá exactamente qué
>  hace falta y pedí autorización antes de hacerlo.
>    - Elegí una versión compatible con el PostgreSQL del proyecto; documentá cómo la determinaste. No accedas al remoto sin
>  autorización.
>    - Configuración pequeña y reproducible: versión fijada, puerto publicado únicamente en localhost, healthcheck y
>  credenciales exclusivamente locales de prueba.
>    - Evitá conflictos con otros servicios; no detengas ni borres recursos existentes.
>    - Documentá arranque, parada, conexión y limpieza explícita de los datos descartables.
>    - Separá la configuración de infraestructura de los futuros tests de negocio.
>
>    Verificación:
>    - Arrancar PostgreSQL y comprobar disponibilidad.
>    - Verificar dos conexiones independientes.
>    - Ejecutar una prueba pequeña de contención transaccional sobre datos sintéticos aislados: una conexión mantiene un
>  bloqueo y la otra espera o recibe el rechazo esperado.
>    - No confundir enviar dos promesas simultáneas con demostrar contención real.
>    - Registrar comando, resultado y límites: esto verifica el entorno, no las reglas de cancelación.. Dime que opinas o si te quedan dudas de algo.

L2. User authorization (verbatim): "okey, entonces si hacemos la config parae stos eventos, osea de una vez configuralo todo para que lo pueda usar en casos similares al que te explique anterioormente. De autorizo todo master."
L3. Read-only preflight: Docker/psql absent from PATH; default Docker Desktop executable absent; WSL reports not installed. Windows process is not elevated. Existing dirty `bun.lock` and `odd/tasks/shipment-cancellations.md` must remain untouched. No remote access.
L4. Official setup references: https://docs.docker.com/desktop/setup/install/windows-install/ and https://learn.microsoft.com/en-us/windows/wsl/install . Winget resolves Docker.DockerDesktop installer from desktop.docker.com. Started authorized elevated `wsl --install --no-distribution --no-launch`; UAC approval may be required; no automatic reboot.
L5. Local evidence: explorer found `supabase/.temp/postgres-version` reporting `17.6.1.043`; task log also reports PostgreSQL 17.6. Selected upstream `postgres:17.6-bookworm`, not a Supabase build; no remote consulted.
L6. Host setup: WSL install exit 0, WSL 3.0.3.0. Winget Docker.DockerDesktop install exit 0, Desktop 4.95.0, CLI 29.8.2, Compose 5.6.0. Elevated DISM `/Online /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart /Quiet` returned Windows 3010 (shell 194), RESTART_REQUIRED. No reboot performed. Runtime unavailable until maintainer reboot; do not retry before that.
L7. Test-first: `bun test scripts/postgres-smoke.test.ts` RED exit 1 (0 pass / 6 fail, files absent), then GREEN exit 0 (6 pass, 16 assertions). First formatting check failed; formatting only new files resolved it. Compose config --quiet, scoped ESLint and Prettier checks exit 0. `bun test` exit 0: 1683 pass / 0 fail, 5845 assertions across 187 files. Live probe not part of default suite.
L8. Standalone smoke probe reserves two distinct physical backend connections, awaits A row-lock acquisition, asserts B NOWAIT rejects with SQLSTATE 55P03, checks unchanged synthetic value, releases A then verifies B update and A visibility, drops its unique schema. This logic is implemented but NOT proven live. No cancellation rules implemented or verified.
L9. Independent verifier delivered static results: focused tests 6/6 pass; scratch-expanded checks 19/19 pass, including malformed/out-of-range ports and unsupported arguments with exact errors and exit 1. Compose config --quiet and help output pass. No concrete code blocker found. S6/S7 live verification and S8 final execution evidence remain blocked by reboot. Its full-workspace scratch copy timed out at 200 seconds while copying node_modules; this was a failed copy, not test evidence. Built-in-only checks then used a scratch copy excluding node_modules and copied Bun declarations. No live database/remote commands run. Parent removed its own temporary suite log after recording successful full-suite results; no unrelated deletion incident.
L10. User plans a Windows reboot. Parent instructed verifier to perform no further checks/copies/retries and return its final report. Resume after reboot with local Docker engine preflight, safe new-stack startup and live smoke; do not rerun installation or touch existing services.
L11. User confirmed reboot and Docker open. Local named-pipe desktop-linux engine reported Docker 29.8.2/Linux, initial container and volume inventories empty, TCP 55432 free. `docker --context desktop-linux compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations up -d --wait --wait-timeout 90 && bun scripts/postgres-smoke.ts` exited 0 in 28 seconds: healthy PostgreSQL 17.6 (Debian 17.6-2.pgdg12+1), independent PIDs A=77/B=76, NOWAIT rejection 55P03 while A holds row, unchanged value=0, after A rollback B writes value=1 visible to A, synthetic schema removed. Stack and its volume remain available for reuse; no other resources or remote project touched.
L12. Native review mode reports on. Initial assess returned unassessable because intended-untracked files require explicit declaration. Inspect returned the intended-untracked selection continuation for exactly the five added files. No native review verdict or authority has been created; static independent review remains previously completed.
L13. Native inspect accepted the five intended-untracked paths and returned ready. Assessment after that declaration still failed with the same untracked-declaration diagnostic; this is an unavailable assessment, not an approval. No further attempts or START. Missing native risk tier treated as high for verification: prior independent static verifier plus observed live public-interface checks supply that verification; native outside-view remains unavailable and is disclosed separately. Effective Docker inspect confirms `healthy` and only `127.0.0.1:55432` for `5432/tcp`; guide formatting check passes. All implementation/runtime requirements observed; stack remains running. No commits, pushes or remote Supabase access.


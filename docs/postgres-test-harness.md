# Disposable PostgreSQL tests

Run real PostgreSQL queries and independent-session locking checks without starting Selene or the full Supabase stack. This environment contains no business schema, migrations or production data.

## Prerequisites

- Docker Engine with Compose v2; on Windows, Docker Desktop using WSL 2 and Linux containers. Accept Windows UAC prompts when installing. Enabling Virtual Machine Platform can require a reboot; the project never reboots the machine automatically.
- Bun with built-in SQL and YAML support (implementation host: Bun 1.4.2).
- Run commands from the repository/worktree root. First check `docker context show` and `docker context inspect`: use a **local** engine, never a remote context. Windows Docker Desktop normally uses `desktop-linux`.

## Quick commands

From the repository/worktree root, with Docker Desktop running and a local Docker context selected:

```sh
bun run db:test:up     # Start PostgreSQL and wait until healthy.
bun run db:test:check  # Run independent-session contention and cleanup checks.
bun run db:test:stop  # Stop this test stack; keep its container and data volume.
```

These shortcuts target the existing `selene-pg-shipment-cancellations` Compose project and honor `SELENE_TEST_PG_PORT`. They are thin aliases: they do not start Docker Desktop, select a Docker context, run business migrations, or delete data. The check requires the stack to be running. Use the explicit commands below when you need a different project name for another simultaneous environment. Data deletion remains a separate, explicit operation.

## Start and verify

Use a unique Compose project name per worktree or simultaneous test environment. These examples use `selene-pg-shipment-cancellations`; choose another name for another environment and reuse it in every command, including cleanup.

```sh
# Read-only preflight: inspect existing resources and port bindings.
docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations ps -a
docker ps --format "table {{.Names}}\t{{.Ports}}"
# Start only if that project name is unused or belongs to your own test environment.
docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations up -d --wait --wait-timeout 90
bun scripts/postgres-smoke.ts
```

Default endpoint: `127.0.0.1:55432`. If occupied, **do not stop the owner**. Choose an available port and set `SELENE_TEST_PG_PORT` for both Compose and the probe:

```powershell
# PowerShell: inspect a port; no result means no current TCP listener was found.
Get-NetTCPConnection -State Listen -LocalPort 55432 -ErrorAction SilentlyContinue
$env:SELENE_TEST_PG_PORT = '55433'
```

```sh
# Bash equivalent:
export SELENE_TEST_PG_PORT=55433
```

Docker will refuse an occupied bind; this setup never kills a listener, prunes Docker, or removes another stack. No fixed container name, global volume name or external network is configured. Images are downloaded from Docker Hub, not from the project's Supabase instance.

## Connect

| Setting         | Local test value                                                                            |
| --------------- | ------------------------------------------------------------------------------------------- |
| Host            | `127.0.0.1`                                                                                 |
| Port            | `55432` (or `SELENE_TEST_PG_PORT`)                                                          |
| Database / user | `selene_test`                                                                               |
| Password        | `selene_local_test_only`                                                                    |
| URL             | `postgres://selene_test:selene_local_test_only@127.0.0.1:55432/selene_test?sslmode=disable` |

Credentials are deliberately public local-test fixtures, not application secrets. Never reuse them remotely. The probe accepts only a port override, not a URL or host, and ignores application database environment variables.

No host `psql` installation is needed:

```sh
docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations exec postgres psql -U selene_test -d selene_test
```

Open that command in two terminals for manual independent sessions. `SELECT pg_backend_pid();` returns distinct backend PIDs.

## What the smoke check proves

`bun scripts/postgres-smoke.ts`:

1. Authenticates over the published localhost port; checks database, role and PostgreSQL major version.
2. Reserves two physical SQL connections and asserts different `pg_backend_pid()` values.
3. Creates a unique `infra_probe_<uuid>` schema and one synthetic counter row.
4. A begins a transaction and completes `SELECT ... FOR UPDATE`. Only **after PostgreSQL acknowledges that lock**, B attempts the same row with `FOR UPDATE NOWAIT`.
5. Requires B's exact SQLSTATE `55P03` (`lock_not_available`) and verifies the row remains unchanged. This is real lock contention, not two concurrent JavaScript promises.
6. A rolls back; B updates the row successfully; A sees the committed value.
7. Removes only the generated schema in `finally` and verifies it is gone. Connection and statement timeouts bound failures. Nonzero exit means failure, not a skip.

The selected proof is immediate lock rejection, not elapsed wait duration. It does **not** verify cancellation rules, financial safety, Supabase Auth/RLS, extensions or deployed RPCs. Future business tests should use their own fixtures and files; do not add business setup to this Compose service or smoke probe. No SQL is automatically loaded from `supabase/`.

## Stop or explicitly discard data

```sh
# Stop without removing the container or data.
docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations stop
# Remove this project's container/network, keeping its data volume.
docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations down
# DESTRUCTIVE: explicitly delete only this test project's disposable data volume.
# Verify the -p name is yours before executing. Never use Docker system/volume prune.
docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations down --volumes
```

## Version choice and checks

Image: **`postgres:17.6-bookworm`**, an explicit upstream PostgreSQL patch and Debian variant, not `latest`. Local `supabase/.temp/postgres-version` reported `17.6.1.043`; `odd/tasks/in-app-notifications.md` also records maintainer-supplied PostgreSQL 17.6 catalog evidence. The Supabase build suffix is not an upstream Docker tag. This chooses matching upstream major/minor behavior, not an identical Supabase build. The tracked `supabase/config.toml` has no database version setting. No remote server was queried; cached local evidence does not establish its current version. This image intentionally stays pinned until a deliberate update; it does not automatically receive newer security patches.

```sh
bun test scripts/postgres-smoke.test.ts
docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations config --quiet
bun scripts/postgres-smoke.ts --help
```

Static tests guard the service boundary, version pin, localhost binding, healthcheck, local credentials and project-scoped storage. They do not substitute for `up --wait` plus the live smoke check. The healthcheck uses `pg_isready` (server readiness, **not** credential validation); the live probe performs authentication.

### Execution evidence

- Initial preflight: Docker and host `psql` not found; WSL not installed. No remote access or existing resource deletion.
- Host preparation: user authorized WSL 2, Docker Desktop and required Windows components. WSL installer returned exit 0; `wsl --version` reported WSL 3.0.3.0. Winget installed Docker Desktop 4.95.0 (exit 0); CLI reports Docker 29.8.2 and Compose 5.6.0.
- Activation blocker: elevated `dism.exe /Online /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart /Quiet` returned Windows exit **3010** (shell exit 194), explicitly requiring a reboot. No automatic reboot was performed. Reboot Windows, open Docker Desktop and wait for the Linux engine to become available before running the start/probe commands above.
- Test-first: `bun test scripts/postgres-smoke.test.ts` returned exit 1, 0 pass / 6 fail before the Compose/probe files existed (expected RED).
- Static GREEN: `bun test scripts/postgres-smoke.test.ts` returned exit 0, 6 pass / 0 fail, 16 assertions. `docker compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations config --quiet` returned exit 0. Scoped ESLint and Prettier checks returned exit 0 after formatting the new files.
- Broader suite: `bun test` returned exit 0, **1683 pass / 0 fail**, 5845 assertions across 187 files (7.98 seconds). This suite does not start the standalone live probe.
- Independent static verification: focused suite 6/6 and expanded scratch-only checks 19/19 passed; Compose validation and exact help/error output passed. No concrete static code blocker found. A full scratch-copy attempt timed out at 200 seconds during node_modules copying; it was not a test result. Built-in-only checks ran in a scratch copy excluding node_modules. No live database was contacted.
- Live verification after maintainer reboot: local named-pipe `desktop-linux` engine reported Docker 29.8.2/Linux; container and volume inventories were empty and localhost port 55432 was free. `docker --context desktop-linux compose -f docker-compose.postgres-test.yml -p selene-pg-shipment-cancellations up -d --wait --wait-timeout 90 && bun scripts/postgres-smoke.ts` returned **exit 0** in 28 seconds. Image pull succeeded and the container became healthy.
- Exact live probe output:

```text
PASS readiness: PostgreSQL 17.6 (Debian 17.6-2.pgdg12+1) on 127.0.0.1:55432
PASS independent sessions: A=77 B=76
PASS contention: B rejected with SQLSTATE 55P03 while A holds the row; value=0
PASS recovery: B writes after A rolls back; A observes value=1
PASS cleanup: isolated synthetic schema removed
```

The test stack remains running for reuse. Only its generated synthetic schema was deleted; its project-scoped volume was not removed. This verifies local infrastructure and locking, not shipment cancellation rules or remote Supabase behavior.

Shortcut verification: `bun run db:test:stop`, `bun run db:test:up`, and `bun run db:test:check` all returned exit 0. Docker inspection confirmed the same container ID and project-scoped volume before/after the stop/start cycle; the final container was healthy. The probe used distinct backend PIDs 41/42, observed the expected `55P03` rejection, recovery and synthetic schema cleanup. Focused tests passed 9/9; the broader suite passed 1686/1686 (5848 assertions).

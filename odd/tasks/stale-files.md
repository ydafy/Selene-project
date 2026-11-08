# Stale files and script-path guards (#250)

Item 4 of roadmap #228: remove files nothing uses, guard the script paths in hooks and `package.json`, and extend the cited-path check to `docs/`. Worktree `repo-hygiene`, branch `chore/stale-files`.
The scattered runbooks and deployment notes are item 4b (#282), not this document.

## Specs

- S1. Delete the root `deno.lock` and the root `.gga` (".gga: No lo uso, borralo", L3).
- S2. Remove the `package.json` script `clean:all`; it runs `scripts/clean-all.ts`, which does not exist.
- S3. Run `scripts/test-cron-health.ts` and `scripts/test-shipment-cancellation-refund-resolution.probes.ts` against the local stack. A script that works is cited from the doc that says when to run it (`docs/go-live.md` cron watchdog, `docs/shipment-cancellation-coordination.md`); a broken one is deleted.
- S4. Colocate the tests in `packages/types/src/__tests__` next to their code and remove that entry from `LEGACY_TEST_FOLDERS`. `confirmShipmentContracts.test.ts` stays next to `types.ts`. "Si un test falla por un move, arreglá la ruta. No lo borres, no lo debilites ni lo conviertas acá; eso es del roadmap #272."
- S5. A test fails when a script path used in `.husky/*` or in a `package.json` script does not exist. A probe hook path makes it fail.
- S6. "El chequeo de rutas citadas de scripts/agent-instructions.ts ahora también tiene que cubrir docs/\*.md [...] Seguro aparecen citas rotas en docs/; arreglalas en el mismo item." The check covers every Markdown file under `docs/`, subfolders included (L2, L3). A probe path cited in a `docs/` file makes it fail. Broken citations are rewritten as repository-root paths, examples become `<placeholder>` names, and real gitignored local files go into `NOT_IN_REPO` with a reason.
- S7. "Mover archivos dentro de un área no cambia nada, pero si borrás o convertís un test que lee archivos, tenés que bajar el número del área." A new test that reads configuration files carries a `// source-text: <reason>` line.
- S8. "scripts/agent-instructions.test.ts aparece modificado sin commitear desde antes, pero solo cambian los finales de línea. No lo commitees." Only content changes made here are staged.
- S9. "Clasificá todo en must-have, nice-to-have y overengineering. Los nice-to-have van como Idea." Folder-structure problems noticed along the way are reported with a recommendation (L2).

## Tasks

- T1 | S1-S2 | inline | commit: this commit (done)
- T2 | S3 | inline | needs Docker | commit: pending
- T3 | S4, S7 | inline | commit: this commit (done)
- T4 | S5, S7 | inline | commit: this commit (done); the test reads nothing itself (the module does), so the `scripts` count stays 15
- T5 | S6, S8 | inline | commit: pending

## Log

- L1 (user): "Seguimos con el roadmap #228: toca #250 (sacar archivos viejos y hacer que una ruta de script rota falle en un test). Todo el alcance está en el issue y en el comentario que le dejé el 2026-11-06. Cargá Engram: roadmap/repo-layout-228, odd/source-text-tests/tasks y preference/repo-structure-before-production. Traé lo último de main en este worktree (repo-hygiene), en una rama nueva. Lo que no está en el cuerpo original del issue: - El chequeo de rutas citadas de scripts/agent-instructions.ts ahora también tiene que cubrir docs/\*.md (ya está en el alcance, lo aprobé en #226). Seguro aparecen citas rotas en docs/; arreglalas en el mismo item. - Desde #273 hay un guard (scripts/source-text-tests.test.ts) que cuenta por área los tests que leen archivos. Mover archivos dentro de un área no cambia nada, pero si borrás o convertís un test que lee archivos, tenés que bajar el número del área. - Si un test falla por un move, arreglá la ruta. No lo borres, no lo debilites ni lo conviertas acá; eso es del roadmap #272. - Al colocar los tests de packages/types/src/\_\_tests\_\_, sacá esa entrada de LEGACY_TEST_FOLDERS (el guard te obliga). - scripts/agent-instructions.test.ts aparece modificado sin commitear desde antes, pero solo cambian los finales de línea. No lo commitees. - Clasificá todo en must-have, nice-to-have y overengineering. Los nice-to-have van como Idea. Antes de arrancar, revisá que el issue siga vigente y decime si cambiarías algo."
- L2 (user): "okey me gusta todo" (the precheck plan: scripts cited or deleted after running them, `|| true` kept, the guard in its own file, citations rewritten, no basename lookup). Then: "a si, me parace bien, y mastre, recuerda que en general en este worktree, aparte de lo demas, uno de sus puntos atacar es el tema de la estrcutura de crapetas, la idea es limpear/mejorar/aplicar mejores parcticas en el tema de las carpetas del repo, osea si tu nota que algo esta asi como que medio mal, o que no sigue las mejores parcticas, tu deves decirme esto, estoy dispuesto a crear y borrar carpetas osea, no me cierro." Agreed: `docs/formal/` and `docs/runbooks/` join the check.
- L3 (agent correction, then user decisions, 2026-11-07): `docs/specs/` holds living money specs (`payout-operating-model.md` changed 2026-11-04), so the check covers all of `docs/`. ".gga: No lo uso, borralo." Scattered deployment notes: "Sub-issue nuevo en #228", created as #282 (item 4b, after #250). Issue #250 body corrected: only `.husky/post-checkout` line 5 has `|| true`.
- L4 (agent evidence, 2026-11-07): run over the 16 Markdown files under `docs/`, the current check reports 164 problems. They fall into these classes:
  - (a) real stale citations: migrations moved to `supabase/migrations/archive/`, `docs/project-structure.md`, `.atl/skill-registry.md`, the `captchaAuth` name in `auth.md`;
  - (b) paths relative to an app or to `supabase/functions` (`features/...`, `_shared/...`, `lib/...`);
  - (c) bare file names;
  - (d) example names in `conventions.md` (`foo.ts`, `product-card.tsx`);
  - (e) tokens with a `/` that are not repository paths: Git refs (`origin/main`, branch names), app routes (`/privacidad`), ESLint rule ids (`import-x/no-restricted-paths`), GitHub Actions (`oven-sh/setup-bun`), and cron syntax (`*/N`);
  - (f) real gitignored local files (credentials, `google-services.json`, `supabase/.temp/postgres-version`, the worktree parent folder).

  Handling:
  - (a) to (c) are rewritten as repository-root paths. Where a name no longer exists, the citation is fixed to the current file or the stale sentence is corrected.
  - (d) become `<placeholder>` names.
  - (e) and (f) need a general extractor rule only when the class is unambiguous (for example a leading `/` is an app route, because instructions cite repository paths without one); otherwise they go into `NOT_IN_REPO` with a reason.
  - No basename lookup and no per-app bases.

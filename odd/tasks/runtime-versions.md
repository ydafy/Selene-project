# Runtime versions (Node and Bun)

Give Node and Bun one source of truth each, move them to current releases, and make the weekly dependency report flag new runtime releases.
Roadmap item #156 (part of #127), before #130. Worktree `C:/dev/School-portal-worktrees/repo-hygiene`, branch `chore/runtime-versions`.

## Specs

- S1: "podemos meterlas en el controlador de depdendecias del repo para que el agenete si ae unactualicazion de bun o de node nos diga o que se te ocurre?"
- S2: "dale me parece perfecto, has todo eso y me dces si quieres que actualice bun y node u otra cosa" — approves the proposal: Node 24 LTS (24.22.2) and Bun 1.4.4, `.nvmrc` as the Node source of truth, `packageManager` for Bun, `apps/frontend/eas.json` aligned with both, a guard test that fails when they disagree, a "Runtimes" rule in `docs/dependencies.md`, and a Runtimes section in the weekly report (pending Node patches with security releases flagged, line end of support, a new LTS line, new Bun releases).
- S3: The Node update rule: use an LTS line (active or maintenance), take its latest patch every month, and move to a new LTS line about three months after it becomes LTS.
- S4: "suelo usar nvm para cambiar versiones" — the maintainer uses nvm-windows, which does not read `.nvmrc` on its own.

## Tasks

- [ ] T1 (S2, S3, S4): pin Node 24.22.2 in `.nvmrc` and Bun 1.4.4 in `packageManager`, align the four `eas.json` profiles, set up Node from `.nvmrc` in the dependency report workflow (it runs Expo CLI with `npx`), add the guard test, and document the rule in `docs/dependencies.md`.
- [ ] T2 (S1, S3): add the Runtimes section to `scripts/dependency-report.ts`, test-first.
- [ ] T3: maintainer installs Node 24.22.2 (`nvm install 24.22.2`, `nvm use 24.22.2`) and Bun 1.4.4 (`bun upgrade`); then run the hooks and `bun test` on the new runtimes.

## Log

- L1: "okey, y s, sulo usar nvm para cambiar versiones digo es muy flexible, al menos que me recomeindes no usarlo. Ahora sbre eso de las vresiones, si te fijas ya tenemos una serie de pasos e inluso skills para el tema de versiones del repo, pero mi duda es que pasa con node y bun? tienen que estar anotados en el repo? podemos meterlas en el controlador de depdendecias del repo para que el agenete si ae unactualicazion de bun o de node nos diga o que se te ocurre? proque si como te comente ya entendi lo importante que es estar actualizado y eso de 'este repo solo usa x version' fue una decicion muy antigua cuando no sabia nada."
- L2: State on 2026-10-31. Local Node 22.19.0, `eas.json` Node 22.13.1 in four profiles, no `.nvmrc` or `engines`. Bun 1.4.2 in `packageManager` and `eas.json` (CI reads `packageManager` through `oven-sh/setup-bun`). Latest releases: Node 26.13.0 (LTS "Lithium" since 2026-10-28, end 2029-04-30), Node 24.22.2 (LTS "Krypton", maintenance since 2026-10-20, end 2028-04-30), Node 22.23.4 (maintenance, end 2027-04-30), Bun 1.4.4 (2026-10-22). Sources: https://nodejs.org/dist/index.json, https://raw.githubusercontent.com/nodejs/Release/main/schedule.json, the npm registry. `lint-staged` 17 needs Node >= 22.22.1. Expo SDK 58 accepts Node `^22.13.0 || ^24.3.0 || ^26.0.0`.
- L3: Decision: Node 24 now and Node 26 about three months after its LTS date, near the Expo SDK 58 upgrade (#132). No `engines.node`: `.nvmrc` is the only Node source, Bun does not enforce `engines`, and a second copy would need its own guard.

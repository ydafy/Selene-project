# Dependency routine (BL26 + BL27)

A written routine for when and how to update dependencies, and a weekly report that tells the maintainer what changed, without automatic update PRs.
Worktree `repo-hygiene`, branch `chore/dependency-routine`. Source: `cross-module-backlog.md` BL26 and BL27 (quoted in S1 and S2).

## Specs

- S1 (BL26, maintainer: "ME GSTA LO QUE PROSPUSISTE, ANOTALO"). Write `docs/dependencies.md`: "the semver table (patch / minor / major and how to treat each), the cadence (weekly automatic audit; monthly `bun outdated` in app and admin, in-range updates together and majors one commit each after reading the changelog; Expo SDK upgrade 4-8 weeks after a release, one SDK at a time, in its own worktree, with the checklist from expo-sdk-upgrade L12/L21), the rule that Expo-pinned native packages only move with `npx expo install --fix`, and a checklist before adding a dependency (maintainer, last release, New Architecture support on reactnative.directory, can we avoid it, wrap it behind our own component)."
- S2 (BL27). "Weekly dependency report workflow that updates one GitHub issue ("Reporte de dependencias", the maintainer gets an email on each update) instead of opening PRs, consistent with dependency-security's "no automatic update PRs": safe patch/minor updates, available majors with changelog links, packages that do not match the Expo SDK (`npx expo install --check`), the latest Expo SDK vs the installed one with its age (rule: upgrade when it is >= 30 days old), and the `bun audit` result." Maintainer asked for "algo como que me llegue un correo que me diga oye tal liberria se actualizo, o que me diga oye sdk nueva version".
- S3. The report is built by our own script, not Renovate (L3).
- S4. The guide also explains when not to update, with this repository's real cases: TypeScript 7 waiting for its 7.1 API (`repo-hygiene.md` L20) and the `decode-uri-component` exception (#81, #92). The maintainer wants to understand "el no saber cuando actualizar, el porque no actualizar, el porque de atualizar, tratar de no romper nada" (L1).

## Tasks

- T1 | S1, S4 | worker | `docs/dependencies.md` plus pointers from `AGENTS.md` and `docs/skills.md` if needed | commit: this commit (done)
- T2 | S2, S3 | worker | report script with tests (pure report builder fed by `bun outdated`, `expo install --check`, `bun audit`, npm registry dates) | commit: pending
- T3 | S2 | inline | weekly workflow that runs the script and updates the issue (CI change, approved in L3) | commit: pending

## Log

- L1 (user): "Lo del modulo de dependecias es facilitar esats cosas, el no saber cuando actualizar, el porque no actualizar, el porque de atualizar, tratar de no romper nada etc etc."
- L2 (user): "okey me gusta, mientras termino los dos woktrees actuales, vamos adelantando eso que comentas"
- L3 (user decision): "Script propio (recomendado)" over Renovate. Reasons given: Renovate does not run `expo install` (renovatebot discussion #24735), has an open bun workspaces lockfile issue (discussion #44523, 2026-07), and is a third-party GitHub App with write access to a public repository.
- L4 (evidence T1): `docs/dependencies.md` (82 lines): semver table, cadence, Expo-pinned packages, checklist before adding, update procedure, and "When not to update" with the TypeScript 7 and `decode-uri-component` cases. `AGENTS.md` gains a "Where truth lives" row. Prettier passes. The `<!-- weekly report: added by T3 -->` placeholder is replaced in T3.

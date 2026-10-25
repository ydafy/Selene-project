# Skills refresh: official sources, updates and design skills

Refresh the project skills in `.agents/skills/`: replace stale copies with current vendor versions, add the agreed new skills, and install everything through the `skills` CLI (vercel-labs) so `npx skills check` / `update` work. Builds on the uncommitted cleanup of 15 skills.

## Specs

- S1: "va master, mete todo, no dejes las sklls que usan sdk paar depues, no. meteleas de una." Install the skills that target newer Expo SDKs now (the app is on Expo 54; the SDK upgrade is a later session).
- S2: Replace stale skills with their current official versions: "en vez de quitarlas podemos simplemente apsarnos a otras skills que son mejores" — `building-native-ui` -> `expo-native-ui`, `native-data-fetching` -> `expo-data-fetching`, `expo-cicd-workflows` -> `eas-workflows`, `expo-deployment` -> `eas-app-stores` + `eas-hosting`, `upgrading-expo` -> `expo-upgrade`, `expo-dev-client` updated, `deno-expert` -> `deno`, `stripe-best-practices` + `upgrade-stripe` updated, `webapp-testing` -> `playwright-cli`.
- S3: Add new skills: `sentry-react-native-sdk` (getsentry/sentry-for-ai), `react-native-best-practices` (Callstack, replaces Vercel `react-native-skills`), `tanstack-query` (TanStack Intent) if the installed package ships it.
- S4: Design skills: "skills para que la ia disene mejor ... que se enfoque mas en el disneo y ui" — update `frontend-design`, add `impeccable`, `expo-design-system`, `expo-ui`, `expo-animation`, `web-design-guidelines`.
- S5: Update in place: `supabase`, `supabase-postgres-best-practices`, `vite`, `i18n-localization`, `react-hook-form`. Remove `tailwind-css-patterns` (still Tailwind v3 idioms, no official alternative), `typescript-advanced-types` and `deploy-to-vercel`. Keep `kpi-dashboard-design`: "saca las 4 menos el de kpi, se supone que nuestro dashboard paunta a ese estilo. asi que dejala y ctualizala o recoemndame una mejor si gustas."
- S6: "para antener todo actualizable y mas facil de actualizar, como lo hacemos?" — every vendor skill comes from its upstream source through the `skills` CLI, recorded in `skills-lock.json`, so `npx skills check` and `npx skills update` work. Local skills (`envia-integration`, `selene-engineering-principles`) stay outside the lock.
- S8: "va master, has la recontruccion y agrega esa de stripe la skill." Restructure `AGENTS.md` to current practice (short root, nested area files, no lost rules) and add `connect-required-verification-information`.
- S9: DESIGN.md "Ahora". Personality: "miNIMALISTA, tech-futuristica, elegante-premiumn." Never: a generic marketplace, a crypto app, an RGB gamer store, a generic AI template. Admin: clarity and premium identity "Las dos por igual". Location: "DESIGN.md en la raíz".
- S7: "no todavia sin comit ni push." No commits or pushes until the user says so.

## Tasks

- T1 [done] | S2, S6 | inline | Migrate unchanged vendor skills (accessibility, bun, composition-patterns, react-best-practices, kpi-dashboard-design, zod) to the `skills` CLI from upstream | commit: none (S7)
- T2 [done] | S1, S2, S4 | inline | Replace the Expo skills with the official `expo/skills` set, including the SDK 56+ ones | commit: none
- T3 [done] | S2 | inline | Replace `deno-expert` with `deno`; update the Stripe skills; replace `webapp-testing` with `playwright-cli` | commit: none
- T4 [done] | S5 | inline | Update five skills in place; remove `tailwind-css-patterns`, `typescript-advanced-types`, `deploy-to-vercel` | commit: none
- T5 [done] | S3, S4 | inline | Add Sentry, Callstack, `frontend-design` update (TanStack not shipped; `impeccable` and `web-design-guidelines` removed after review, L5) | commit: none
- T7 [done] | S8 | inline | Root `AGENTS.md` 200 -> 127 lines; new `supabase/AGENTS.md`, `supabase/functions/AGENTS.md`, `docs/skills.md` | commit: none
- T8 [done] | S8 | inline | Add `connect-required-verification-information` (docs.stripe.com) and review it | commit: none
- T9 [done] | S9 | inline | Root `DESIGN.md` from `apps/frontend/core/theme/index.ts` and `apps/admin-web/src/index.css`; `AGENTS.md` "Where truth lives" row points to it | commit: none
- T6 [done] | S6 | inline | Security review of new and changed skill content; refresh `.atl/skill-registry.md`; verify `npx skills check` and a clean restore; document the update routine | commit: none

## Log

- L1: "va master, mete todo, no dejes las sklls que usan sdk paar depues, no. meteleas de una. entonces dime que vas hacer ? cual es el plan?"
- L2: Earlier decisions in this session: cleanup removed 15 skills (uncommitted on main); Gentle uninstalled from non-Pi agents; user uses only Pi; autoskills is replaced by the `skills` CLI for maintenance.
- L5: Security review (2026-10-24): no injection or exfiltration found; conflicts: Expo `@expo/agent-cli feedback` sections (11 skills), `supabase` schema changes via `execute_sql`, `eas update`/`deploy --prod`/`--auto-submit`, broad `eas-workflows` allowed-tools; `impeccable` downloads and runs an unpinned binary, installs hooks, spawns mandatory sub-agents; `web-design-guidelines` follows remote unpinned rules. User delegated: "master cual es la mejor ocpion y la mas escalable". Decision: vendor files untouched; `AGENTS.md` `## Skills` section takes precedence and documents the update routine; removed `impeccable` and `web-design-guidelines`; `.gitignore` now keeps `.agents/skills/**/*.txt`.
- L6: Verification: `npx skills check` -> "All project skills are up to date" (Stripe offers 8 more optional skills, not installed). Clean restore with `experimental_install` from the lock reproduced all 29 vendor skills; only difference: two extra `metadata.json` files in the restore. Registry refreshed: 45 skills (31 project). RDD native assess unassessable while files are untracked. No commit (S7).
- L7: AGENTS.md research (ETH arXiv 2602.11988: context files do not generally improve success, +20% cost; overviews unhelpful; non-inferable rules useful). Restructure kept every critical rule in the root (no deploys, remote read-only, money and security invariants, Stripe livemode false, Sentry read-only, skills precedence) and moved procedures to nested files, which the root Map points to because Pi loads only root-level AGENTS.md. Scripted sentence check: the 47 old sentences not found verbatim are rephrasings, moved text, or intentional removals (stack overview, `~/.gentle-shell` path, lint error count, baseline file name, Husky line duplicated by Commands). `connect-required-verification-information` only GETs public JSON from docs.stripe.com (data, not instructions); no scripts.
- L4: "saca las 4 menos el de kpi, se supone que nuestro dashboard paunta a ese estilo. asi que dejala y ctualizala o recoemndame una mejor si gustas. Lo demas si, y mete las nuevas y todo loq ue acordamos"
- L3: Evidence 2026-10-24: `@tanstack/react-query` 5.102.8 in `apps/frontend/node_modules` ships no `skills/` folder; `@sentry/react-native` is not a frontend dependency yet; `skills` CLI 1.7.4 maps the `pi` agent to `.agents/skills/`.

# Agent skills

Project skills live in `.agents/skills/`. The rules agents follow are in the root `AGENTS.md` ("Skills"); this page is the maintainer routine.

## Sources

- Vendor skills are installed from their upstream repositories with the [`skills` CLI](https://github.com/vercel-labs/skills) and recorded in `skills-lock.json`. Never edit them: an update overwrites local changes.
- `envia-integration`, `selene-dependency-review`, `selene-engineering-principles`, `selene-maintenance-routine`, `selene-technical-writing`, and `verify-selene` are written and maintained in this repository. They are not in the lock.
- `.atl/skill-registry.md` is the local, gitignored index the harness reads. Regenerate it with `gentle-ai skill-registry refresh`.

## Update

The monthly routine (`docs/maintenance.md`) runs step 1. It also runs `bun run skills:usage` to find installed skills that no session read (`docs/maintenance.md`, "E. Agent tools").

1. `npx skills check` lists skills with upstream changes. It takes about 2 minutes because it fetches every source, so give it a timeout of at least 5 minutes.
2. `npx skills update <name>` installs the new version.
   The CLI can also create junction folders for other agents (a `skills` folder under `.claude`, `.hermes`, or `.qwen`) that link back to `.agents/skills/`. Remove each junction with `cmd /c rmdir <path>`, never a recursive delete: it can follow the link and delete the real skill. The CLI also writes CRLF line endings; Git stores LF again when you stage the files.
3. Read the diff before committing, like any third-party code: scripts, network calls, and instructions that conflict with `AGENTS.md`.
4. `gentle-ai skill-registry refresh`.

## Add

1. `npx skills add <source> --list` to see the skill names in a source.
2. `npx skills add <source> --skill <name> -a pi --copy -y`.
3. Review every file of the new skill (step 3 above), then refresh the registry.

Reject a skill that downloads and runs unpinned code, installs hooks, or follows instructions fetched at run time. Reading official documentation at run time is fine when the skill treats it as reference data (the `envia-integration` skill reads `docs.envia.com`).

## Remove

Remove a vendor skill only with the maintainer's decision, usually after the monthly usage check (`docs/maintenance.md`, "E. Agent tools").

1. `npx skills remove <name>`. It deletes the folder and its `skills-lock.json` entry. Check `git status` for anything else it touched.
2. Search the repository for the skill name (`git grep -n <name>`) and update the docs that cite it.
3. `gentle-ai skill-registry refresh`.

## Check adapted skills against pstack

Three of our skills adapt pstack (MIT) by Lauren Tan. The upstream is [cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack). The mirror [backnotprop/pstack](https://github.com/backnotprop/pstack) syncs it, checks it daily, and records each check in its [sync log](https://github.com/backnotprop/pstack/blob/main/SYNC-LOG.md). Each skill's `metadata.source` names the upstream commit it was last compared against.

| Our skill                       | Skill folders it adapts, under `skills` in the mirror                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `selene-engineering-principles` | `principle-make-operations-idempotent`, `principle-model-the-domain`, `principle-boundary-discipline`, `principle-type-system-discipline`, `principle-test-behavior-not-implementation`, `principle-fix-root-causes`, `principle-attack-the-premise`, `principle-encode-lessons-in-structure`, `poteto-mode` |
| `selene-technical-writing`      | `technical-writing`, `unslop`                                                                                                                                                                                                                                                                                |
| `verify-selene`                 | `create-verification-skill`                                                                                                                                                                                                                                                                                  |

1. Find the recorded commit in the sync log and note the date of its row (`0f77cd5` is 2026-10-28).
2. For each folder, list the mirror commits since that date: `gh api "repos/backnotprop/pstack/commits?path=skills/<folder>&since=<date>T00:00:00Z" -q '.[] | .sha[0:8] + " " + .commit.message'`. If the list includes the sync of the recorded commit itself, skip that one.
3. Read the diff of each other listed commit: `gh api "repos/backnotprop/pstack/commits/<sha>"`. In `poteto-mode`, only the bug-fix and prototype guidance feeds our skill. Ignore its orchestration and model defaults.
4. Our skills are adaptations, not copies. Bring over only what improves Selene, written with `selene-technical-writing`. `AGENTS.md` wins over anything upstream.
5. Update the commit in `metadata.source` of each skill you compared, even when nothing changed. Copy the commit from the latest row of the sync log. Never type it by hand.

## Restore

`npx skills experimental_install` restores every lock entry into `.agents/skills/` (tested 2026-10-24: all vendor skills matched).

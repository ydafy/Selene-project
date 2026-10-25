# Agent skills

Project skills live in `.agents/skills/`. The rules agents follow are in the root `AGENTS.md` ("Skills"); this page is the maintainer routine.

## Sources

- Vendor skills are installed from their upstream repositories with the [`skills` CLI](https://github.com/vercel-labs/skills) and recorded in `skills-lock.json`. Never edit them: an update overwrites local changes.
- `envia-integration` and `selene-engineering-principles` are written and maintained in this repository. They are not in the lock.
- `.atl/skill-registry.md` is the local, gitignored index the harness reads. Regenerate it with `gentle-ai skill-registry refresh`.

## Update

1. `npx skills check` lists skills with upstream changes.
2. `npx skills update <name>` installs the new version.
3. Read the diff before committing, like any third-party code: scripts, network calls, and instructions that conflict with `AGENTS.md`.
4. `gentle-ai skill-registry refresh`.

## Add

1. `npx skills add <source> --list` to see the skill names in a source.
2. `npx skills add <source> --skill <name> -a pi --copy -y`.
3. Review every file of the new skill (step 3 above), then refresh the registry.

Reject a skill that downloads and runs unpinned code, installs hooks, or follows instructions fetched at run time.

## Restore

`npx skills experimental_install` restores every lock entry into `.agents/skills/` (tested 2026-10-24: all vendor skills matched).

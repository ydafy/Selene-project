# Findings and ideas

How to record a bug, gap, idea, or vulnerability that is not part of the task you are doing. `AGENTS.md`, "Findings outside the current work", states the rule: do not fix it, record it and continue. This page is the procedure.

## Before you start a module

Read the open issues and the draft Security Advisories that mention the module, and say which ones your work covers:

```bash
gh issue list --search <module>
gh api repos/ydafy/Selene-project/security-advisories
```

## Record a finding

A finding is a bug or gap that is not part of the task. Open a GitHub issue without asking first.

1. Search open and closed issues for a duplicate.
2. Open the issue with the "Finding" form (`.github/ISSUE_TEMPLATE/finding.yml`), using the `gentle-ai-issue-creation` skill.
3. Write it so the maintainer understands it without the code open.
4. Keep the form's `### Priority` and `### Area` headings with the exact option text. `.github/workflows/issue-labels.yml` sets the `priority:*` and `area:*` labels from them, so change a priority by editing the body, not the label.
5. Cite the issue number in the feature's `## Log`.

## Record an idea

An idea is a feature, tool, or process worth doing later, in the short, medium, or long term. It is not a defect. Record it when it comes up, whether you found it in the work or discussed it with the maintainer, so no session loses it.

1. Search open and closed issues for a duplicate.
2. Open the issue with the "Idea" form (`.github/ISSUE_TEMPLATE/idea.yml`).
3. Fill "When to revisit".
4. Tell the maintainer the issue number.
5. Cite the issue number in the feature's `## Log`.

Do not keep backlog lists in `odd/tasks/`.

## Record a repeated agent mistake

An agent mistake is something the maintainer corrected that no check, test, or type catches. Record it without asking first. The record is how `selene-engineering-principles` ("Encode repeated mistakes in structure") knows that a mistake happened twice. Record only mistakes the maintainer corrected, not what you noticed and fixed yourself.

1. Search the open issues for the same mistake: `gh issue list --label agent-mistake --search <topic>`.
2. If none matches, open an issue with the `agent-mistake` label. Write what the agent did, what the maintainer expected, and the evidence: a commit, a feature's `## Log` entry, or the session date.
3. If one matches, the mistake happened twice. Comment on that issue with the new evidence. Then propose a fix to the maintainer at the highest level that works: architecture, types, a guard or lint, a behavior test, and a rule in `AGENTS.md` or a skill only last.
4. The PR that adds the fix says `Closes #N`.

The issue is the only record of the occurrences. Do not copy it to Engram. When the fix lands, Engram records the decision like any other decision.

## Report a vulnerability

A vulnerability affects auth, permissions, secrets, money integrity, or data exposure. This repository is public, so while the vulnerability is unfixed, never describe it in an issue, a PR, a commit message, or any file in the repository.

1. Tell the maintainer in the session.
2. Draft a private Security Advisory (`SECURITY.md`).
3. When the maintainer confirms the fix is deployed, close the advisory yourself. Do not publish it.

```bash
gh api -X PATCH repos/ydafy/Selene-project/security-advisories/<GHSA-id> -f state=closed
```

## Close an issue

A PR that fixes an issue says `Closes #N`. Close an issue by hand only with the maintainer's decision.

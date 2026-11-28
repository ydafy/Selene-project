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
5. Decide whether it blocks the launch ("Go-live" below).
6. Cite the issue number in the feature's `## Log`.

If you open the issue from the command line, write the body to a file and pass the `finding` label:

```bash
gh issue create -R ydafy/Selene-project --label finding --title "[Finding] <short summary>" --body-file <file>
```

The body file uses the headings of `.github/ISSUE_TEMPLATE/finding.yml`. Under `### Priority` and `### Area`, keep exactly one line of the options below and delete the others:

```markdown
### What happens

<The problem in plain words, as the user or the system sees it.>

### Where

<Screen, Edge Function, table, file and line.>

### Why it matters

<Who is affected and what breaks or could break.>

### Priority

Critical (money, data loss, or production broken)
High (wrong behavior users will hit)
Medium (edge case or degraded experience)
Low (cleanup, tooling, docs)

### Area

Payments and payouts
Orders and shipments
Mobile app
Admin web
Edge Functions
Database
Dependencies and tooling
Docs

### Evidence

<Logs, command output, query results, or steps to reproduce. Never paste secrets or personal data.>

### Found while

<Feature or branch in progress, e.g. odd/tasks/<feature>.md.>
```

The labeler reads the first line under each heading. If a heading is missing or its line matches no option, the labeler leaves that label group unchanged and comments once on the issue with the valid options. Fix the body, and the labeler runs again on the edit.

## Go-live

The GitHub milestone `Go-live` holds the issues Selene must not launch with. Every other open issue is real and stays open, but it ships and gets fixed after launch. Decide once, when the issue is opened, and change the decision only when new evidence arrives.

An issue blocks the launch when it is a money, data loss, security, or privacy defect, however rare. Otherwise answer three questions:

1. What happens if a real user hits it: lost money or trust, or an annoyance?
2. Can it change after launch with a deploy, or does it get expensive once real users and data exist (data model, money format, onboarding scheme)?
3. Would we see it (Sentry, an alert, an admin view) and fix it fast, or would it fail silently?

It blocks when the answer is serious harm, expensive to change later, or silent. A broken main journey (publish, buy, ship, get paid, report a problem) and a legal or app store requirement also block. Never add an issue to get it noticed.

When it blocks, set the milestone (`gh issue edit <N> --milestone Go-live`) and comment `Go-live: blocks launch.` with the rule and a one-line reason. When it does not, say so in your report to the maintainer. A private advisory never goes in the milestone; it blocks the launch until it is fixed.

## Record an idea

An idea is a feature, tool, or process worth doing later, in the short, medium, or long term. It is not a defect. Record it when it comes up, whether you found it in the work or discussed it with the maintainer, so no session loses it.

1. Search open and closed issues for a duplicate.
2. Open the issue with the "Idea" form (`.github/ISSUE_TEMPLATE/idea.yml`).
3. Fill "When to revisit".
4. Tell the maintainer the issue number.
5. Cite the issue number in the feature's `## Log`.

An idea blocks the launch only when it fixes something that meets the "Go-live" rule; decide it the same way.

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
3. Fix it in a pull request against `main` in the advisory's temporary private fork, not in a PR on this repository: CodeRabbit reviews every PR here, and its comments are public. GitHub runs no status checks and no branch protection in that fork, so run locally on the fork's branch every check that `.github/workflows/ci.yml` runs, plus the checks from `AGENTS.md`, "Verifying a change".
4. Bring the fork's branch up to date with the current `main` and rerun the checks, so the deploy does not roll back newer production code. Then deploy from that branch before merging, in the main checkout with the fork's branch checked out: migrations through `supabase/AGENTS.md`, "When a change touches Supabase", step 4, and Edge Functions by the maintainer. This is the only exception to deploying from `main`. Merging first would publish the patch while production is still vulnerable, and longer if the deploy fails.
5. Right after the maintainer confirms the deploy, merge that pull request into `main` from the advisory ("Merge pull request(s)") so `main` matches production again, then close the advisory yourself. Do not publish it.

```bash
gh api -X PATCH repos/ydafy/Selene-project/security-advisories/<GHSA-id> -f state=closed
```

## Close an issue

A PR that fixes an issue says `Closes #N`. Close an issue by hand only with the maintainer's decision.

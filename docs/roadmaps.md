# Roadmaps

A roadmap plans work that spans several sessions, features, or worktrees. It lives in GitHub issues, not in a repository file: every worktree and session sees an issue at once, while a file is visible only after its branch merges.

## How a roadmap is built

- **One parent issue** (the "Idea" form) states the goal, the order of the items, and why.
- **One sub-issue per item**, with the `roadmap` label and the title `[Roadmap] <N>. <what>`. Its body says what to do, when it can start, `Part of #<parent>`, and `Closes #<this issue>` for its PR.
- **A large item gets a feature document** (`odd/tasks/<feature>.md`) when it starts. The roadmap tracks the items; the feature document tracks the specs, tasks, and log inside one item.
- **Engram topic** `roadmap/<slug>` mirrors the parent issue for agent sessions.

Size each item to land in one or a few commits of about 400 lines. If an item clearly exceeds that, split it into several sub-issues.

Example: #127 (Expo SDK 58, frontend layout, and tooling checks).

## Take an item

1. Read the parent issue, the item, and the comments on both.
2. Check that the item still holds before you plan it. Its premises may be stale: a version, a blocker, a file, or a dependency on another item. Investigate as much as the item needs; the roadmap is a guide, not a contract.
3. Comment on the item that you started it, with the worktree and the branch.
4. Work on a branch from `origin/main`. The PR says `Closes #<item>`. The merge closes the item, and the parent shows the progress.

## Change the plan

A session may change the roadmap, and records why in a comment on the parent issue.

- **A missing step that belongs to no item:** create a new sub-issue in the same format.
- **A missing step inside the current item:** add it to that item's feature document (`## Log`, then `## Tasks`), not to the roadmap.
- **An item too large:** split it into several sub-issues.
- **A better order:** say why, then update the order in the parent body.
- **An item that is wrong or already done:** comment with the evidence. Close it as "not planned" only with the maintainer's decision.
- **A product or scope decision** (adding or dropping a feature): ask the maintainer first.

A bug found outside the item is a "Finding" issue, as `AGENTS.md` says, not a roadmap item.

## Commands

Create a sub-issue and attach it to its parent. The API takes the issue `id`, not its number:

```bash
url=$(gh issue create --title "[Roadmap] 4. <what>" --label roadmap --body-file body.md)
id=$(gh api "repos/ydafy/Selene-project/issues/${url##*/}" --jq .id)
gh api -X POST repos/ydafy/Selene-project/issues/<parent>/sub_issues -F sub_issue_id="$id"
```

List the items and the progress:

```bash
gh api repos/ydafy/Selene-project/issues/<parent>/sub_issues --jq '.[] | "\(.number) \(.state) \(.title)"'
gh api repos/ydafy/Selene-project/issues/<parent> --jq .sub_issues_summary
```

Do not track progress with checkboxes in the parent body. Two sessions that edit it at the same time overwrite each other; sub-issues close themselves when their PR merges.

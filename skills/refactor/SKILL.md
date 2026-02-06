---
name: refactor
description: Improve existing code for clarity, performance, and maintainability without changing its external behavior.
trigger: When the user asks to "clean up", "improve", or "refactor" a file.
allowed-tools: Read, Write, Edit, Glob
---

## Purpose

This skill ensures that code improvements follow best practices and respect the project's existing architecture. The goal is to reduce technical debt.

---

## Required Behavior (REQUIRED)

✅ ALWAYS:

- Identify "code smells" (long functions, magic numbers, duplicate code, poor naming).
- Propose extracting logic into smaller, reusable functions or hooks.
- Suggest moving complex state logic out of UI components.
- Ensure all changes maintain or improve TypeScript strictness (no `any`).
- Explain the "before" and "after" and the benefit of the change.

❌ NEVER:

- Change the public API of a component or function without explicit permission.
- Introduce new features during a refactor.
- Break existing functionality.

---

## Refactoring Checklist

Before proposing changes, the agent must check for:

1.  **Single Responsibility:** Does this function/component do only one thing?
2.  **Readability:** Is the code self-documenting? Are variable names clear?
3.  **DRY (Don't Repeat Yourself):** Is this logic duplicated elsewhere?
4.  **Performance:** Can loops be optimized? Are `useMemo` or `useCallback` needed?

---

## Output Format

When using this skill, the agent must:

1.  State the file being refactored.
2.  List the specific improvements being made (e.g., "Extracted calculation into `useMyLogic` hook").
3.  Provide the complete, refactored code with comments explaining the changes.

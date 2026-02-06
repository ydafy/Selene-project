---
name: architect
description: Plan features and structure code to integrate cleanly into the existing monorepo architecture before writing code
trigger: When planning a new feature, screen, hook, component, API route, or folder structure
allowed-tools: Read, Write, Edit, Glob, Grep
---

## Purpose

This skill ensures that new code follows the existing architecture of the project.
The agent must understand the structure before generating any code.

---

## Required Behavior (REQUIRED)

✅ ALWAYS:

- Read related files before proposing a solution
- Identify existing patterns in components, hooks, and folders
- Propose where code should live before writing it
- Prefer reusing existing structures over creating new ones
- Keep screens thin, logic in hooks or core, UI in components
- Respect the monorepo structure:
  - `app/` → screens
  - `components/` → reusable UI
  - `core/` → logic (auth, db, stores, theme, i18n)
  - `packages/types` → shared types

❌ NEVER:

- Create new patterns if one already exists
- Place business logic inside screens
- Mix UI and logic in the same file when avoidable
- Create folders or files without explaining why

---

## Architectural Decision Process

Before generating code, the agent must answer:

1. Should this be a component, a hook, or core logic?
2. Does something similar already exist?
3. Where is the correct place for this in the folder structure?
4. How does this integrate with the existing theme, providers, and patterns?

---

## Output Format

When using this skill, the agent must:

1. Propose the structure first (files, folders, responsibilities)
2. Explain the reasoning
3. Only then proceed to code generation

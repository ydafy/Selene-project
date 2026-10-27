---
name: selene-technical-writing
description: 'Trigger: writing or reviewing repository docs: docs/, odd/tasks feature documents, AGENTS.md files, DESIGN.md, READMEs, skill files, runbooks. Plain technical English without AI tells.'
license: MIT
metadata:
  author: 'school-portal'
  version: '1.0'
  source: 'Adapted from pstack technical-writing and unslop (backnotprop/pstack, MIT); see LICENSE'
---

## Activation Contract

Load when you write or review a document a person reads to understand or operate Selene: anything under `docs/`, an `odd/tasks/<feature>.md`, an `AGENTS.md`, `DESIGN.md`, a README, a runbook, or a skill file.

Skip for code comments, user-facing UI strings (they go through i18n and the product copy in `DESIGN.md`), commit messages, and PR descriptions (`AGENTS.md`, "Git", and the commit and PR skills own those).

## Hard Rules

- `AGENTS.md` and the harness win. This skill changes wording only. It never adds, drops, or reorders requirements, steps, or warnings.
- Never rewrite quoted text. `## Specs` and `## Log` entries in `odd/tasks` quote the maintainer verbatim, typos and Spanish included. Edit only the prose around a quote.
- Repository docs are in English. Keep real names: write the symbol, file, command, table, or enum exactly as the code has it (`fn_cancel_shipment`, `bun run api:test`, `order_status_enum`), never a synonym or a description of it.
- Every count, path, or command in a doc must be true at the commit that lands it. Include the command that regenerates a count.
- If a rule makes a sentence worse, fix the sentence another way or leave it alone.
- After writing, run the checklist in `references/unslop.md` over the text you touched.

## Pick one mode per document

Ask: does the reader need to act or to understand, and are they learning or working?

| Mode        | Reader                                | Selene examples                                         | Write                                                                     |
| ----------- | ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| How-to      | Acting, at work                       | `docs/go-live.md` steps, runbooks, `supabase/AGENTS.md` | Numbered commands toward one goal. No background; link it.                |
| Reference   | Looking something up                  | Token tables in `DESIGN.md`, a function's error codes   | Facts, options, limits, errors. Mirror the code's structure. No opinions. |
| Explanation | Understanding why                     | `docs/decision-log.md` entries                          | Context, constraints, trade-offs. A view is allowed here.                 |
| Tutorial    | Learning by doing (rare in this repo) | Onboarding a new contributor                            | Steps that each show a visible result.                                    |

Do not mix modes. Split the document and link the parts. An `odd/tasks` feature document is reference (specs, tasks, log); keep decisions and their reasons in `## Log`.

## Write to the reader

- Use "you" and the present tense. Use "will" only for something that happens later.
- Name the actor: "`fn_begin_shipment_transfer` locks the shipment row", not "the row is locked".
- Write steps as commands: "Run `supabase db reset`." Put the condition first: "If Docker is not running, start it."
- Put the common case first and the exceptions after it.
- One instruction per sentence. Split instructions longer than about 20 words and other sentences longer than about 25.
- Put a warning before the step it guards: "Never run this against the remote project. Run `bun run bruno:env`."
- Use one word per thing and per action everywhere. If it is a "shipment" once, it is never a "parcel" or a "package" later.
- Keep articles and small words: "Remove the backup file", "Ensure that the stack is local".
- Keep "only" and "not" next to the word they change.
- Make every "it", "this", and "they" point at one thing. Repeat the noun when in doubt.
- Use periods, not semicolons or em dashes. No slashes ("a, b, or both", not "a/b").
- Be specific: "a column rename fails `bun run db:types`", not "schema changes can cause issues".
- Vary sentence length. A short sentence lands a point. A longer one carries a fact with its condition.

## Structure

- Headings carry the point and use sentence case ("Stop the stack when done", not "Cleanup"). A task heading is a verb phrase.
- Numbered lists for sequences, bullets for the rest. Introduce a list with a full sentence and keep its items parallel.
- Code, paths, commands, and identifiers in code font. UI labels in bold.
- Link text says where it goes (the page title or a short description), never "here".
- Prefer one sentence of context over a link off the page.

## Worked example

Before:

> In order to verify the webhook, it's important to note that the stack should be started first, and then stripe:listen can be utilized to basically forward events — this ensures a seamless local loop.

After:

> Start the local stack, then run `bun run stripe:listen`. It forwards sandbox events to the local `stripe-webhooks` function. Trigger one with `stripe trigger payment_intent.succeeded`.

# Proposal: Notification MVP Plus

## Intent

Make notifications dependable and actionable for marketplace users. The current MVP contains a production-breaking English translation shape, fragile realtime presentation logic, misleading unread feedback, and no way to dismiss stale items. This change fixes those defects while preserving the existing single-channel, cursor-paginated architecture and keeping push notifications deferred.

## Problem Statement

English notification copy can resolve to an object because its namespace is double-nested. Realtime dialogs classify records by localized title text, queue cancellation can silently discard later unread items, and toast dismissal uses an invalid API. The inbox lacks dismiss/clear-all actions, the bell exposes only a dot, mutation failures provide no user feedback, and two existing linking/watcher requirements have drifted from implementation.

## Proposed Solution

Normalize notification translations and add the missing localized action/accessibility labels. Base routing and presentation decisions on the typed notification category and validated action path rather than title text. Correct queue skip semantics and toast lifecycle, remove the redundant initial-load effect, and centralize cache invalidation. Add scoped dismiss and clear-all mutations with confirmed UI, show a clipped unread count, surface mutation errors, and await navigation with fallback handling.

## Proposal question round

To refine product assumptions, confirm or correct:
- Should “Clear all” dismiss every notification, or only currently visible/loaded items?
- Should dismissing an unread notification reduce the unread badge immediately, or only after server confirmation?
- Is skipping the current dialog sufficient, with “skip all” as a separately confirmed action?

Working assumptions: clear-all is user-scoped across the inbox; unread counts change only after successful persistence; realtime dialogs remain limited to the existing notification rules.

## Scope

### In Scope
- English/Spanish notification keys, dismiss/clear-all labels, count badge, and bell accessibility label.
- Watcher classification, queue cancellation, toast mapping/dismissal, error feedback, initial-load cleanup, and shared invalidation helper.
- `dismissNotification`/`dismissAll` mutations and confirmed list/item UI.
- Awaited deep-link navigation with safe fallback; corresponding OpenSpec deltas/tests.

### Out of Scope
- Push delivery, preferences, unread/all filters, grouping, backend SQL changes, and database enum migration for `type`.
- Optimistic updates and cosmetic icon-table refactoring.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `notifications-list`: dismiss/clear-all actions and count/accessibility presentation.
- `notification-mutations`: scoped dismiss mutations, invalidation, and error feedback.
- `notification-watcher`: typed classification, queue/toast behavior, and initial-load contract.
- `notification-linking`: awaited navigation and runtime fallback.

## Approach

Implement in independently testable slices: translation/contracts; mutation/cache behavior; watcher/toast behavior; list and badge UI; linking/spec updates. Use strict TDD per project configuration, preserve RLS/user scoping, and verify focused notification tests before the broader suite.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/frontend/core/{i18n,hooks,services}` | Modified | Keys, mutations, cache helper, navigation. |
| `apps/frontend/components/features/notifications` | Modified | Watcher and dismiss affordances. |
| `apps/frontend/app/{profile/notifications.tsx,(tabs)/index.tsx}` | Modified | Clear-all and count badge. |
| `openspec/specs` and change deltas | Modified | Requirements and acceptance scenarios. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Watcher changes regress realtime behavior | Med | Small logic-only edits, focused tests, preserve single-channel cleanup. |
| Dismiss semantics surprise users | Med | Confirm clear-all and validate user scoping/error states. |
| Type/path data is malformed | Med | Narrow values and retain safe navigation fallback. |

## Rollback Plan

Revert the single PR to restore the current watcher, UI, and translations; no database migration or remote deployment is required.

## Dependencies

- Existing `deleted_at` support, Supabase RLS, React Query cache keys, Toast v2 API, ConfirmDialog, and current notification specs.

## Success Criteria

- [ ] English and Spanish notification flows render localized strings without object/undefined output.
- [ ] Unread notifications are never silently lost; dismiss and clear-all are scoped, confirmed where required, and reflected in list/badge state.
- [ ] Watcher, toast, mutation-error, and navigation tests cover the corrected contracts.
- [ ] Focused tests, `bun test`, lint, and frontend typecheck pass within the 800-line single-PR budget.

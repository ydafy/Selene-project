# Archive Report: notification-mvp-plus

**Change**: notification-mvp-plus
**Archived**: 2026-08-27
**Status**: Complete (18/18 tasks, 50/50 tests pass)

## Executive Summary

Notification MVP Plus hardened the 5-layer notification architecture with dismiss/clear-all mutations, typed classification, optimistic badge updates, and toast lifecycle fixes. All 18 tasks implemented, 50 tests passing, coverage improved from 58.94% to 73.68% (measurable files average 93.42%). Zero regressions in notification-related code.

## What Was Accomplished

### Capabilities Delivered

| Capability | ID | Status |
|------------|-----|--------|
| Dismiss Notification Action | CONF-101 | ✅ Implemented |
| Clear All Notifications | CONF-102 | ✅ Implemented |
| Unread Count Badge | CONF-103 | ✅ Implemented |
| Accessibility Labels | CONF-104 | ✅ Implemented |
| dismissNotification Mutation | CONF-201 | ✅ Implemented |
| dismissAll Mutation | CONF-202 | ✅ Implemented |
| Shared Cache Invalidation Helper | CONF-203 | ✅ Implemented |
| Mutation Error Feedback | CONF-204 | ✅ Implemented |
| Optimistic Badge Update on Dismiss | CONF-205 | ✅ Implemented |
| Typed Notification Classification | CONF-301 | ✅ Implemented |
| Queue Skip Semantics | CONF-302 | ✅ Implemented |
| Toast Lifecycle Fix | CONF-303 | ✅ Implemented (spec corrected) |
| Toast Type Mapping | CONF-304 | ✅ Implemented |
| Watcher Error Handling | CONF-305 | ✅ Implemented |
| Localized Overflow Count | CONF-306 | ✅ Implemented |
| Navigation Execution (awaited) | CONF-011-B | ✅ Implemented |

### Specs Synced to Source of Truth

| Domain | Action | Requirements Added | Requirements Modified |
|--------|--------|-------------------|----------------------|
| notifications-list | Updated | CONF-101, CONF-102, CONF-103, CONF-104 | Notification Screen Integration |
| notification-mutations | Updated | CONF-201, CONF-202, CONF-203, CONF-204, CONF-205 | markAsRead Dual Cache Invalidation, markAllAsRead Cache Invalidation |
| notification-watcher | Updated | CONF-301, CONF-302, CONF-303, CONF-304, CONF-305, CONF-306 | Fix isInitialLoadDone Race Condition |
| notification-linking | Updated | — | Navigation Execution (CONF-011-B) |

### Test Coverage

- **Total tests**: 50 (up from 34 at first verify)
- **Files**: 4 test files (NotificationWatcher, useNotificationMutations, dialogActions, notificationBadge)
- **Changed file coverage**: 93.42% average (measurable files)
- **Logic file coverage**: 73.68% (useNotificationMutations.logic.ts)

### Verification Evidence

- **Lint**: ✅ exit 0 across all 13 notification-changed files
- **Type checker**: ⚠️ exit 2 with 24 errors — all in other concurrent work, zero in notification files
- **Full suite**: 896 pass / 7 fail / 16 errors — all failures in other concurrent work, zero notification failures

## What Was Deferred

| Item | Reason | Recommended Action |
|------|--------|-------------------|
| TDD Cycle Evidence table (C-11) | Process debt — apply-progress never reported TDD evidence table. Maintainer waived as process debt only, no product defects. | Record as process debt; no code action needed. |
| logic file coverage >80% | Uncovered regions are dynamic-import mutationFn wrappers (not unit-testable without supabase mocking) and mark-as-read option builders. | Exercise createMarkAsReadMutationOptions/createMarkAllAsReadMutationOptions with existing fakes (S-3). |
| a11y grep contract strengthening | Current presence-assertions are looser than mechanism-encoding greps. | Upgrade CONF-104 and CONF-102-S2 grep contracts (S-1). |
| Proposal drift (W-4) | "Out of Scope" still lists "Optimistic updates" while CONF-205 requires them. | Update proposal Out of Scope section. |

## Known Issues

| ID | Severity | Description |
|----|----------|-------------|
| W-3 | Warning | logic file line coverage 73.68% (< 80%) |
| W-4 | Warning | Proposal "Out of Scope" lists optimistic updates, contradicting CONF-205 |
| W-5 | Warning | Full-suite regression state (7 fail / 16 errors) — all from other concurrent work |
| W-6 | Warning | Typecheck exit 2 (24 errors) — all outside notification files |
| S-4 | Suggestion | NotificationItem a11yLabel covers entire Pressable; consider accessibilityHint |
| S-5 | Suggestion | Fallback router.push in navigate() is not awaited |
| S-6 | Suggestion | Watcher auto-calls markAsRead for toast notifications; failing auto-mark shows user-facing error |

## Backend Notification Gap (PENDING)

### Problem
The frontend notification system (in-app) is fully functional, but **no notifications are being created** when products are purchased through the active checkout flow.

### Root Cause
The active settlement function `fn_create_shipments_from_single_payment` (single-modal checkout, 429 lines) **does not insert notifications**. The legacy function `fn_create_order_from_payment` (120 lines) does have notification inserts, but it's only used for the `app_name` flow.

### Current State of SQL Functions

| Function | Status | Used By | Has Notifications |
|----------|--------|---------|-------------------|
| `fn_create_order_from_payment` | Legacy active | Webhook line 703 (app_name flow) | ✅ Yes (lines 108-114) |
| `fn_create_shipment_from_payment` (singular) | **RETIRED** | Throws exception immediately | ❌ Dead code |
| `fn_create_shipments_from_single_payment` | **ACTIVE** | Webhook line 480 (single-modal checkout) | ❌ **Missing** |

### What Needs to Be Done
After all edge functions and SQL functions are finalized, add notification inserts to `fn_create_shipments_from_single_payment`:

1. **Seller notification** — after marking product as SOLD (~line 362):
   ```sql
   INSERT INTO public.notifications (user_id, type, title, message, action_path)
   VALUES (v_seller_id, 'success', '¡Vendido!', 'Has vendido: ' || v_product_record.name, '/profile/orders/' || v_existing_order_id);
   ```

2. **Buyer notification** — after all shipments are created (~line 378):
   ```sql
   INSERT INTO public.notifications (user_id, type, title, message, action_path)
   VALUES (v_buyer_id, 'success', '¡Compra Exitosa!', 'Tu pedido ha sido confirmado.', '/profile/orders/' || v_existing_order_id);
   ```

### Additional Cleanup
- `fn_create_shipment_from_payment` (singular) can be deleted — it's dead code that throws an exception
- `fn_create_order_from_payment` should remain until the `app_name` flow is migrated to single-modal

### Verification
Once notifications are added to the backend:
1. Verify Supabase Realtime is enabled for the `notifications` table (Dashboard → Database → Replication)
2. Test purchase flow end-to-end
3. Confirm both buyer and seller receive in-app notifications
4. Check that the NotificationWatcher receives realtime INSERT events

## Final State

- **18/18 tasks complete** in tasks.md
- **50/50 tests pass** on focused notification test command
- **Zero notification-related regressions** in broader test suite
- **All delta specs merged** into canonical specs in openspec/specs/
- **Change folder moved** to openspec/changes/archive/2026-08-27-notification-mvp-plus/

## Files Changed

| File | Action |
|------|--------|
| openspec/specs/notifications-list/spec.md | Updated (4 requirements added, 1 modified) |
| openspec/specs/notification-mutations/spec.md | Updated (5 requirements added, 2 modified) |
| openspec/specs/notification-watcher/spec.md | Updated (6 requirements added, 1 modified) |
| openspec/specs/notification-linking/spec.md | Updated (1 requirement modified) |
| openspec/changes/notification-mvp-plus/ | Moved to archive |

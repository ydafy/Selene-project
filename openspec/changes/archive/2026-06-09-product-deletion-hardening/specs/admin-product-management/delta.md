# Admin Product Management Specification

## Purpose

Admin-web operators SHALL be able to soft-delete seller products from the dashboard with a confirmation flow, full audit trail, and keyboard-accessible UI. Soft-delete semantics mirror the mobile app: `deleted_at = now()`, `status = 'HIDDEN'`.

## Requirements

### REQ-APM-001: Admin-Only Soft-Delete RPC

The RPC `fn_admin_soft_delete_product(p_product_id uuid, p_reason text)` SHALL be created in `public`. The function SHALL:

1. Read the JWT; reject with `UNAUTHORIZED_NO_SESSION` if missing.
2. Verify admin via the existing `is_admin()` STABLE function; reject with `UNAUTHORIZED_ADMIN_ONLY` otherwise.
3. `SELECT ... FOR UPDATE` the target row to capture previous status.
4. UPDATE the product setting `deleted_at = now()`, `status = 'HIDDEN'`, `updated_at = now()`, ONLY when `deleted_at IS NULL`.
5. Insert an audit log row (REQ-APM-002) in the SAME transaction.
6. Return `true` on success, `false` when no row matched.

#### Scenario: Admin soft-deletes product

- GIVEN an admin session and `P.deleted_at IS NULL`
- WHEN `fn_admin_soft_delete_product('P', 'duplicate')` is called
- THEN `P.deleted_at` is set, `P.status = 'HIDDEN'`, function returns `true`

#### Scenario: Non-admin rejected

- GIVEN a non-admin session
- WHEN the RPC is invoked
- THEN the function raises `UNAUTHORIZED_ADMIN_ONLY`

#### Scenario: Already-deleted is a no-op

- GIVEN `P.deleted_at` already set
- WHEN the RPC is invoked
- THEN no UPDATE occurs and the function returns `false`

### REQ-APM-002: Audit Trail in `admin_audit_logs`

The RPC SHALL insert into `public.admin_audit_logs` with `admin_id` (caller), `action_type = 'PRODUCT_SOFT_DELETE'`, `target_id = p_product_id::text`, and `details` jsonb `{ reason, previous_status }`. If the audit insert fails, the transaction SHALL roll back.

#### Scenario: Audit row on success

- GIVEN admin `A` deletes `P` with previous status `VERIFIED`
- WHEN the RPC commits
- THEN `admin_audit_logs` contains a row with `action_type = 'PRODUCT_SOFT_DELETE'`, `target_id = P.id`, `details = { reason, previous_status: 'VERIFIED' }`

#### Scenario: No audit row on no-op

- GIVEN `P` is already soft-deleted
- WHEN the RPC returns `false`
- THEN no row is inserted

#### Scenario: Atomic rollback on audit failure

- GIVEN the product UPDATE succeeds
- WHEN the audit insert fails
- THEN the product UPDATE is rolled back and the RPC raises

### REQ-APM-003: Admin-Web Soft-Delete UI

A new admin-web product management page SHALL allow searching for a product by id/name, viewing status, and triggering soft-delete via a destructive confirm dialog. The dialog SHALL require a reason with min-length 5 chars before the confirm button enables.

#### Scenario: Confirm flow with reason

- GIVEN the admin opens the product page
- WHEN the admin clicks "Soft delete" and submits a reason ≥ 5 chars
- THEN the RPC runs, a success toast appears, the row updates to "HIDDEN"

#### Scenario: Disabled confirm until reason is valid

- GIVEN the dialog is open with an empty reason
- WHEN the admin attempts to confirm
- THEN the confirm button is disabled

#### Scenario: Concurrent admin lock detected

- GIVEN another admin holds `fn_lock_product` on `P`
- WHEN the current admin opens the page
- THEN a "locked by other admin" state is shown and delete is disabled

#### Scenario: RPC error surfaces

- GIVEN the RPC raises (e.g., product vanished mid-flight)
- WHEN the call rejects
- THEN a destructive toast shows the message and the row state is NOT optimistically updated

### REQ-APM-004: Accessibility

The soft-delete button SHALL be a native `<button>` with `aria-label` describing the action and the product name. The confirm dialog SHALL trap focus, label the reason field with a visible `<label>`, and announce errors via `aria-live="polite"`.

#### Scenario: Keyboard activation

- GIVEN the delete button is focused
- WHEN the admin presses Enter or Space
- THEN the same handler fires as a click

#### Scenario: Screen reader labels

- GIVEN VoiceOver/NVDA is active
- WHEN focus reaches the delete button
- THEN it announces "Soft delete product {name}" with the current status

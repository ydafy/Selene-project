# Delta Spec: Admin Payments Page

> **Archive status**: DISCARDED / SUPERSEDED / NO LONGER ACTIVE.  
> This legacy spec is retained for audit history only. The user discarded/removed the admin payments module from the repository; do not treat PAY-001–PAY-012 as active implemented requirements. See `specs/admin-payments-discontinued/spec.md` and `archive-note.md` for archive intent.

**Change**: `admin-payments-page`
**Date**: 2026-06-01
**Priority**: HIGH (PAY-001–PAY-009, PAY-012) | MEDIUM (PAY-010, PAY-011)
**Type Safety**: `payout_requests.status` uses `payout_status` enum (`'pending'`, `'processing'`, `'completed'`, `'rejected'`) — created in migration. No string status values allowed.

---

## ADDED Requirements

### PAY-001: Payments Page — List View

The system MUST render a `PaymentsPage` at `/payments` with a `DataTable` displaying all payout requests joined with seller bank account and profile data. The table MUST support checkbox row selection, "Select All" toggle, status tab filters (`pending`, `processing`, `completed`, `rejected`, `all`), text search by seller name, and sortable columns (amount, requested date, status).

The data source MUST be `usePayoutRequests` hook querying `admin_payments_overview` view.

#### Scenario: Admin views pending payouts

- GIVEN admin is on `/payments` with at least 1 pending payout
- WHEN page loads
- THEN table displays rows with columns: selector checkbox, seller name, amount, bank (CLABE last 3 digits), requested date, status badge, actions
- AND status tab defaults to "pending"

#### Scenario: Admin searches by seller name

- GIVEN admin types "García" in search input
- WHEN debounce fires (300ms)
- THEN table filters to payouts where seller name contains "García" (case-insensitive)

#### Scenario: Admin selects all payouts

- GIVEN admin clicks "Select All" checkbox in table header
- WHEN at least 1 row is visible
- THEN all visible rows are checked; batch actions become enabled

#### Scenario: No payouts in system

- GIVEN database has zero payout_requests
- WHEN page loads
- THEN table shows "Sin solicitudes de retiro" empty state
- AND KPI cards show zero values

---

### PAY-002: KPI Summary Cards

The system MUST render four `StatCard` components above the table: Total Pendiente (sum of `amount` where status=`pending`), Retiros en Proceso (sum where status=`processing`), Volumen Procesado Este Mes (sum where status=`completed` and `completed_at` is current month), Retiros Fallidos (count where status=`rejected`). Cards MUST follow existing `StatCard` pattern from `DashboardHome`.

#### Scenario: KPIs compute from filtered data

- GIVEN 3 pending payouts with amounts 500, 1500, 2000
- WHEN page loads with "pending" filter
- THEN Total Pendiente card shows `$4,000` using `formatCurrency()`

#### Scenario: Empty data shows zero

- GIVEN zero payouts of any status
- WHEN page loads
- THEN all four cards display `$0` or `0` as appropriate

---

### PAY-003: BBVA Dispersion File Generation

The system MUST provide a "Generar Archivo BBVA" button that generates a `.txt` file from selected payouts in BBVA Net Cash format. Before download, a pre-export checklist MUST validate: total amounts match (checksum), all CLABEs pass validation, all names are sanitized, all bank codes are mapped, and no duplicate payout IDs exist. Only payouts with status=`pending` and `is_verified=true` bank accounts MAY be included without warning.

**CRITICAL: DB-first, file-second ordering.** The system MUST update payout statuses to `processing` in the database BEFORE triggering the browser file download. This ensures: (1) no double-dispersion if another admin generates simultaneously, (2) if the browser download fails, the admin can re-generate the file for the same `processing` payouts without creating a duplicate batch. If the DB update fails, the file MUST NOT be generated.

#### Scenario: Admin generates file with valid payouts

- GIVEN admin selects 3 pending payouts with verified bank accounts
- WHEN admin clicks "Generar Archivo BBVA" and confirms
- THEN system first updates selected payouts to `processing` status atomically (`WHERE status = 'pending' AND id IN (...)`)
- IF DB update succeeds AND all rows were updated (no race condition), THEN file downloads as `dispersion_YYYYMMDD_HHmmss.txt`
- AND each line: `{bank_code},{clabe},{amount},{sanitized_name},{reference}`
- AND file totals checksum matches selected payout amounts
- AND audit log records file generation

#### Scenario: DB update succeeds but browser download fails

- GIVEN admin confirms file generation
- WHEN system updates DB to `processing` successfully
- AND browser download fails (network error, browser blocked download, etc.)
- THEN payouts remain in `processing` status
- AND admin can click "Re-generar Archivo" to download the same file again for those `processing` payouts
- AND no duplicate batch is created

#### Scenario: Admin selects zero payouts

- GIVEN admin has no checkboxes selected
- WHEN "Generar Archivo BBVA" button renders
- THEN button is disabled with tooltip "Selecciona al menos un retiro"

#### Scenario: CLABE validation failure blocks export

- GIVEN admin selects a payout whose bank account has invalid CLABE (fails check digit)
- WHEN admin clicks generate
- THEN pre-export checklist shows error: "CLABE inválida en cuenta {last3}"
- AND file download is blocked until admin deselects that row

#### Scenario: Race condition — another admin processed same payout

- GIVEN admin A selects payouts including payout X
- WHEN admin A confirms generation
- AND admin B already processed payout X (status changed to `processing` while admin A was selecting)
- THEN DB update for payout X returns 0 affected rows (status was no longer `pending`)
- AND system shows warning: "X retiro(s) ya no están pendientes y fueron excluidos"
- AND file generates with remaining valid payouts only
- AND payouts that were still `pending` transition to `processing`

---

### PAY-004: CLABE Validation

The system MUST implement the official CLABE checksum algorithm. A valid CLABE is 18 digits where check digit (position 18) is computed via weighted sum modulo 10. The weighting sequence is [3,7,1,3,7,1,3,7,1,3,7,1,3,7,1,3,7,1]. `validateCLABE(clabe)` MUST return `{valid: boolean, error?: string}`.

#### Scenario: Valid CLABE passes

- GIVEN CLABE `002115070000000005` (check digit verified)
- WHEN `validateCLABE` is called
- THEN returns `{valid: true}`

#### Scenario: Invalid check digit fails

- GIVEN CLABE `002115070000000006` (wrong check digit)
- WHEN `validateCLABE` is called
- THEN returns `{valid: false, error: "Dígito verificador inválido"}`

#### Scenario: Wrong length fails

- GIVEN string `0021150700` (10 digits)
- WHEN `validateCLABE` is called
- THEN returns `{valid: false, error: "CLABE debe tener 18 dígitos"}`

#### Scenario: Non-numeric input fails

- GIVEN string `00211507000000000A`
- WHEN `validateCLABE` is called
- THEN returns `{valid: false, error: "CLABE debe contener solo dígitos"}`

---

### PAY-005: Name Sanitization for BBVA

The system MUST provide `sanitizeBBVAName(name)` that: converts to UPPERCASE, strips accents (á→A, é→E, í→I, ó→O, ú→U, ü→U), replaces Ñ/ñ with N, removes special characters (#$& and similar), collapses multiple spaces to one, trims. Returns sanitized string. MUST handle null/undefined input by returning empty string.

#### Scenario: Name with accents and Ñ

- GIVEN `María Muñoz García`
- WHEN sanitized
- THEN returns `MARIA MUNOZ GARCIA`

#### Scenario: Name with special characters

- GIVEN `José #1 & Co.`
- WHEN sanitized
- THEN returns `JOSE 1 CO`

#### Scenario: Null input

- GIVEN `null`
- WHEN sanitized
- THEN returns `''`

---

### PAY-006: Bank Code Mapping

The system MUST provide `SPEI_BANK_CODES`: a `Map<string, string>` from Mexican bank names to 3-digit SPEI codes with leading zeros. `getBankCode(bankName)` MUST return the 3-digit code or throw if unmapped. Codes include: BBVA México → `012`, Banorte/IXE → `072`, Santander → `014`, STP → `600`, and all codes from `docs/bbva-dispersion-format.md`.

#### Scenario: Known bank returns code

- GIVEN bank name `"BBVA México"`
- WHEN `getBankCode` called
- THEN returns `"012"`

#### Scenario: Leading zero preserved

- GIVEN bank name `"Banorte / IXE"`
- WHEN `getBankCode` called
- THEN returns `"072"` (NOT `"72"`)

#### Scenario: Unknown bank throws

- GIVEN bank name `"Unknown Bank"`
- WHEN `getBankCode` called
- THEN throws Error with message containing the bank name

---

### PAY-007: Status Transitions

The system MUST implement four transitions with `ConfirmModal` confirmation: (1) `pending` → `processing` on file generation (atomic: `WHERE status = 'pending' AND id IN (...)`), (2) `processing` → `completed` via admin "Confirmar Completado" action, (3) `processing` → `pending` via admin "Revertir" action, (4) `pending` or `processing` → `rejected` via admin "Rechazar" action with a reason. Transition (1) sets `processed_by` to admin ID and `processed_at` to now. Transition (4) sets `rejected_reason` and `rejected_at`. Transitions (2) and (3) clear or update these fields accordingly.

#### Scenario: Atomic pending→processing prevents race condition

- GIVEN two admins view the same pending payout
- WHEN admin A generates a file including payout X
- THEN payout X status becomes `processing` with admin A's ID
- AND admin B's selection no longer includes payout X (refetch removes it)
- AND admin B cannot generate a file with payout X

#### Scenario: Admin reverts processing payout

- GIVEN a payout with status `processing`
- WHEN admin clicks "Revertir" and confirms
- THEN payout status returns to `pending`, `processed_by` cleared, `processed_at` cleared

#### Scenario: Admin marks processing as completed

- GIVEN a payout with status `processing`
- WHEN admin clicks "Confirmar Completado" and confirms
- THEN payout status becomes `completed`, `completed_at` set to now

#### Scenario: Admin rejects a payout

- GIVEN a payout with status `pending` or `processing`
- WHEN admin clicks "Rechazar" and provides a reason in the confirmation modal
- THEN payout status becomes `rejected`, `rejected_reason` set to admin's input, `rejected_at` set to now
- AND audit log records the rejection with reason

---

### PAY-008: Audit Logging

Every file generation and status change MUST insert a row into `admin_audit_logs` with: `action_type` (`'payout_file_generated'` | `'payout_status_changed'`), `admin_id` (current admin), `target_id` (payout ID or file reference), `details` JSON (`{payout_ids, checksum, from_status, to_status, file_name}`).

#### Scenario: File generation logs audit

- GIVEN admin generates BBVA file for payouts [id1, id2]
- WHEN file generation completes
- THEN `admin_audit_logs` has a row: `action_type='payout_file_generated'`, `details.checksum` matches file checksum, `details.payout_ids=[id1, id2]`

#### Scenario: Status change logs audit

- GIVEN admin changes payout id3 from `processing` to `completed`
- WHEN transition completes
- THEN `admin_audit_logs` has row: `action_type='payout_status_changed'`, `details={from_status:'processing', to_status:'completed', payout_id: id3}`

---

### PAY-009: DB View — admin_payments_overview

A Supabase migration MUST create `admin_payments_overview` view joining `payout_requests` + `seller_bank_accounts` + `profiles` (via `admin_user_directory_view`), exposing: payout id, user_id, seller_name, amount, status, clabe, bank_name, is_verified, requested_at, processed_at, processed_by, completed_at, rejected_reason, rejected_at. The view MUST also include `processed_by_name` (admin name from `profiles_private` or `profiles`) for display. RLS policy MUST allow SELECT only for admin users via `is_admin()`.

#### Scenario: Admin queries view

- GIVEN admin user with `is_admin() = true`
- WHEN querying `admin_payments_overview`
- THEN returns all payout rows with joined seller/bank data

#### Scenario: Non-admin denied access

- GIVEN regular user with `is_admin() = false`
- WHEN querying `admin_payments_overview`
- THEN returns zero rows (RLS policy blocks)

---

### PAY-010: DataTable Pagination i18n

The `DataTable` component MUST display "Anterior" instead of "Previous" and "Siguiente" instead of "Next" in both client-side and controlled pagination sections.

#### Scenario: Pagination labels in Spanish

- GIVEN DataTable with enough rows to paginate
- WHEN rendered
- THEN previous button text shows "Anterior" and next button text shows "Siguiente"

---

### PAY-011: formatCurrency Consistency

All monetary display in the payments page and related components MUST use `formatCurrency()` from `@/lib/utils/formatCurrency`. The `UserPayoutsTable` component MUST replace `$${amount.toLocaleString()}` with `formatCurrency(amount)`.

#### Scenario: Payout amount displays correctly

- GIVEN payout with amount `15500.50`
- WHEN rendered in PayoutsTable or UserPayoutsTable
- THEN displays `$15,500.50` via `formatCurrency()`, not `$15500.5` or `$15,500.5`

#### Scenario: Locale consistency

- GIVEN amount `1000`
- WHEN formatCurrency called
- THEN output uses `es-MX` locale formatting (comma as thousands separator, no decimal for whole amounts)

---

## Non-Functional Requirements

| ID | Requirement | Check |
|----|-------------|-------|
| NFR-PERF-01 | `admin_payments_overview` view query < 200ms for 10k rows | Supabase query plan analysis |
| NFR-SEC-01 | RLS on view: only `is_admin() = true` can SELECT | Non-admin gets 0 rows |
| NFR-SEC-02 | CLABE values never logged/stored in audit details | Audit JSON omits full CLABE |
| NFR-SEC-03 | Status transitions use atomic `WHERE status = 'current'` — no idempotency issues on concurrent requests | Two admins generating simultaneously never double-disperse |
| NFR-UX-01 | Processing rows disabled from selection (no double-dispersion) | Checkbox disabled when status ≠ pending |
| NFR-UX-02 | "Re-generar Archivo" button appears for payouts in `processing` status — admin can recover from failed downloads | Button visible, regenerates file for same payouts |
| NFR-ACC-01 | File encoding: UTF-8 without BOM per BBVA spec | Generated file validated |

---

### PAY-012: Reject Payout with Reason

The system MUST allow admins to reject a payout from `pending` or `processing` status. Rejection requires a reason (min 5 chars) entered via `InputModal`. On rejection, the payout's `rejected_reason` and `rejected_at` fields MUST be set. The payout's wallet `pending_balance` MUST be restored so the seller can request again.

#### Scenario: Admin rejects a pending payout

- GIVEN a payout with status `pending` and amount 1500
- WHEN admin clicks "Rechazar", enters reason "Datos bancarios incorrectos", and confirms
- THEN payout status becomes `rejected`
- AND `rejected_reason` = "Datos bancarios incorrectos"
- AND `rejected_at` = current timestamp
- AND seller's wallet `pending_balance` is restored by the payout amount (or `available_balance` if pending_balance insufficient)
- AND audit log records rejection

#### Scenario: Admin rejects with empty reason

- GIVEN admin clicks "Rechazar" on a payout
- WHEN admin enters reason shorter than 5 characters
- THEN modal shows validation error and does not submit

# Tasks: Admin Payments Page (Dispersión)

## Task Summary
- Total tasks: 14
- Estimated lines: ~1,200
- Review budget: Quality-driven (no line limit)

## Dependency Graph

```
TASK-001 (migration)
  └─→ TASK-002 (types)
       └─→ TASK-003..006 (utilities) — independent of each other
            └─→ TASK-007 (generateBBVAFile) — depends on 003-006
                 └─→ TASK-008 (hooks) — depends on 002, 007
                      └─→ TASK-009 (KPI cards) — depends on 008
                      └─→ TASK-010 (PayoutsTable) — depends on 008
                      └─→ TASK-011 (PaymentsPage) — depends on 008, 009, 010
                           └─→ TASK-012 (file generation flow) — depends on 007, 010, 011
                           └─→ TASK-013 (status transitions) — depends on 008, 010, 011
TASK-014 (quick wins) — independent, can be done anytime
```

---

## Tasks

### TASK-001: Create DB migration — payout_status enum, new columns, view, RLS

**Specs**: PAY-007, PAY-009, PAY-012
**Priority**: HIGH
**Depends on**: None
**Files**:
- Create: `supabase/migrations/YYYYMMDD_admin_payments_overview.sql`
**Estimate**: ~80 lines

**Description**:
Create a single migration file with:
1. `payout_status` ENUM: `'pending', 'processing', 'completed', 'rejected'`
2. ALTER `payout_requests.status` from `text` to `payout_status`
3. ADD columns: `completed_at timestamptz`, `rejected_reason text`, `rejected_at timestamptz`
4. CREATE VIEW `admin_payments_overview` joining `payout_requests` + `seller_bank_accounts` + `profiles` + LEFT JOIN `profiles` for `processed_by_name`
5. RLS policy: SELECT for authenticated users WHERE `is_admin()`

**Acceptance**:
- [ ] Migration runs without errors
- [ ] `payout_requests.status` only accepts enum values
- [ ] View returns joined data for admin users
- [ ] Non-admin users get 0 rows from view
- [ ] `completed_at`, `rejected_reason`, `rejected_at` columns exist on `payout_requests`

---

### TASK-002: Regenerate TypeScript types and add PayoutOverviewRow

**Specs**: PAY-001, PAY-009
**Priority**: HIGH
**Depends on**: TASK-001
**Files**:
- Modify: `packages/types/src/database.types.ts` (auto-generated via `bun db:types`)
- Modify: `packages/types/src/index.ts`
**Estimate**: ~15 lines

**Description**:
1. Run `bun db:types` to regenerate `database.types.ts` with the new view and enum
2. Add `PayoutOverviewRow` type alias in `index.ts` based on the view columns
3. Add `PayoutStatus` type alias for the enum values
4. Export both

**Acceptance**:
- [ ] `PayoutOverviewRow` type exists with all view columns
- [ ] `PayoutStatus` type is `'pending' | 'processing' | 'completed' | 'rejected'`
- [ ] No TypeScript errors in the project

---

### TASK-003: Implement validateCLABE with tests

**Specs**: PAY-004
**Priority**: HIGH
**Depends on**: None (can be done in parallel with TASK-001)
**Files**:
- Create: `apps/admin-web/src/lib/bbva/validateCLABE.ts`
- Create: `apps/admin-web/src/lib/bbva/validateCLABE.test.ts`
**Estimate**: ~60 lines (20 source + 40 test)

**Description**:
Implement the official CLABE checksum algorithm:
- Accept 18-digit string
- Validate: length = 18, all digits, check digit matches weighted sum modulo 10
- Weighting sequence: [3,7,1,3,7,1,3,7,1,3,7,1,3,7,1,3,7,1]
- Return `{ valid: boolean; error?: string }` with specific Spanish error messages
- Test cases: valid CLABE, invalid check digit, wrong length, non-numeric, empty string

**TDD**: Write tests FIRST, then implement.

**Acceptance**:
- [ ] All 4 PAY-004 scenarios pass
- [ ] Edge case: empty string returns `{ valid: false, error: "CLABE debe tener 18 dígitos" }`
- [ ] `bun test validateCLABE.test.ts` passes

---

### TASK-004: Implement sanitizeBBVAName with tests

**Specs**: PAY-005
**Priority**: HIGH
**Depends on**: None (can be done in parallel)
**Files**:
- Create: `apps/admin-web/src/lib/bbva/sanitizeBBVAName.ts`
- Create: `apps/admin-web/src/lib/bbva/sanitizeBBVAName.test.ts`
**Estimate**: ~50 lines (15 source + 35 test)

**Description**:
Implement name sanitization for BBVA format:
- UPPERCASE
- Strip accents: á→A, é→E, í→I, ó→O, ú→U, ü→U, Á→A, É→E, Í→I, Ó→O, Ú→U, Ü→U
- Replace Ñ/ñ with N
- Remove special chars (anything not A-Z, 0-9, space)
- Collapse multiple spaces
- Trim
- Null/undefined → empty string

**TDD**: Write tests FIRST, then implement.

**Acceptance**:
- [ ] All 3 PAY-005 scenarios pass
- [ ] "María Muñoz García" → "MARIA MUNOZ GARCIA"
- [ ] "José #1 & Co." → "JOSE 1 CO"
- [ ] null → ""
- [ ] `bun test sanitizeBBVAName.test.ts` passes

---

### TASK-005: Implement SPEI_BANK_CODES and getBankCode with tests

**Specs**: PAY-006
**Priority**: HIGH
**Depends on**: None (can be done in parallel)
**Files**:
- Create: `apps/admin-web/src/lib/bbva/bankCodes.ts`
- Create: `apps/admin-web/src/lib/bbva/bankCodes.test.ts`
**Estimate**: ~80 lines (30 source + 50 test)

**Description**:
1. `SPEI_BANK_CODES`: `Map<string, string>` mapping bank names to 3-digit SPEI codes
   - Source: `docs/bbva-dispersion-format.md`
   - Must include: BBVA México (012), Banorte/IXE (072), Santander (014), STP (600), and all codes from the doc
   - Must handle multiple name variations (e.g., "Banorte", "Banorte / IXE")
2. `getBankCode(bankName: string): string`
   - Returns 3-digit code with leading zeros preserved
   - Throws `Error('Banco no soportado: ${bankName}')` if not found

**TDD**: Write tests FIRST, then implement.

**Acceptance**:
- [ ] All 3 PAY-006 scenarios pass
- [ ] `"BBVA México"` → `"012"` (leading zero preserved)
- [ ] `"Banorte / IXE"` → `"072"` (not `"72"`)
- [ ] `"Unknown Bank"` throws with bank name in message
- [ ] `bun test bankCodes.test.ts` passes

---

### TASK-006: Create bbva barrel export

**Specs**: N/A (infrastructure)
**Priority**: HIGH
**Depends on**: TASK-003, TASK-004, TASK-005
**Files**:
- Create: `apps/admin-web/src/lib/bbva/index.ts`
**Estimate**: ~5 lines

**Description**:
Barrel export for all BBVA utilities:
```ts
export { validateCLABE } from './validateCLABE';
export { sanitizeBBVAName } from './sanitizeBBVAName';
export { SPEI_BANK_CODES, getBankCode } from './bankCodes';
export { generateBBVAFile } from './generateBBVAFile';
export type { BBVARow, BBVAFileResult } from './generateBBVAFile';
```

**Acceptance**:
- [x] All utilities importable from `@/lib/bbva`

---

### TASK-007: Implement generateBBVAFile with tests

**Specs**: PAY-003, NFR-ACC-01
**Priority**: HIGH
**Depends on**: TASK-003, TASK-004, TASK-005
**Files**:
- Create: `apps/admin-web/src/lib/bbva/generateBBVAFile.ts`
- Create: `apps/admin-web/src/lib/bbva/generateBBVAFile.test.ts`
**Estimate**: ~100 lines (40 source + 60 test)

**Description**:
The core file generation function. Takes an array of payout data, validates everything, and produces the BBVA-format string.

```ts
interface BBVARow {
  bankName: string;
  clabe: string;
  amount: number;
  beneficiaryName: string;
  reference: string;
}

interface BBVAFileResult {
  content: string;      // UTF-8 without BOM
  filename: string;      // dispersion_YYYYMMDD_HHmmss.txt
  checksum: number;     // sum of all amounts
  rowCount: number;
}
```

- Validate all rows: CLABE check, bank code mapping, name sanitization, no duplicate references
- Compute checksum = sum of all amounts
- Format: `BANK_CODE,CLABE,AMOUNT,SANITIZED_NAME,REFERENCE` per line
- Amount format: decimal with `.` separator, max 2 decimals, no `$` or `,`
- Filename: `dispersion_YYYYMMDD_HHmmss.txt`
- UTF-8 without BOM (NFR-ACC-01)
- On validation failure: throw with specific error per row
- On success: return `BBVAFileResult`

**TDD**: Write tests FIRST, then implement.

**Acceptance**:
- [x] Valid rows produce correct BBVA format
- [x] Invalid CLABE causes throw with row-specific error
- [x] Unknown bank causes throw with bank name
- [x] Checksum equals sum of all amounts
- [x] File content is UTF-8 without BOM
- [x] Leading zeros preserved in bank codes and CLABEs
- [x] `bun test generateBBVAFile.test.ts` passes

---

### TASK-008: Create usePayoutRequests and useUpdatePayoutStatus hooks

**Specs**: PAY-001, PAY-002, PAY-007
**Priority**: HIGH
**Depends on**: TASK-002
**Files**:
- Create: `apps/admin-web/src/hooks/usePayoutRequests.ts`
- Create: `apps/admin-web/src/hooks/useUpdatePayoutStatus.ts`
**Estimate**: ~120 lines

**Description**:

1. `usePayoutRequests(filter, search, sortBy)`:
   - `queryKey: ['admin-payments', filter, search, sortBy]`
   - Queries `admin_payments_overview` view
   - Filter: `.eq('status', filter)` when not 'all'
   - Search: `.ilike('seller_name', '%search%')` when present
   - Sort: by `amount` or `requested_at`
   - `refetchInterval: 30000`
   - Returns `{ data, isLoading, isError, refetch }`

2. `useUpdatePayoutStatus()`:
   - Returns mutation functions:
     - `markAsProcessing(ids: string[])` — atomic UPDATE WHERE status = 'pending'
     - `markAsCompleted(id: string)` — UPDATE SET completed_at = now
     - `revertToPending(id: string)` — UPDATE SET status = 'pending', clear processed_by/processed_at
     - `rejectPayout(id: string, reason: string)` — UPDATE SET rejected, restore wallet balance
   - Each mutation invalidates `['admin-payments']` queries on success
   - Each mutation logs to `admin_audit_logs`

**Acceptance**:
- [x] usePayoutRequests queries view with correct filters
- [x] useUpdatePayoutStatus.markAsProcessing uses atomic WHERE
- [x] All mutations invalidate and refetch on success
- [x] Audit logging happens for every status change

---

### TASK-009: Create KPIPaymentsCards component

**Specs**: PAY-002
**Priority**: HIGH
**Depends on**: TASK-008
**Files**:
- Create: `apps/admin-web/src/components/features/payments/KPIPaymentsCards.tsx`
**Estimate**: ~60 lines

**Description**:
4 StatCards following DashboardHome pattern:
- **Total Pendiente**: sum of `amount` where status = 'pending'
- **Retiros en Proceso**: sum where status = 'processing'
- **Volumen Procesado (mes)**: sum where status = 'completed' AND `completed_at` is current month
- **Retiros Fallidos**: count where status = 'rejected'

Props: `{ payouts: PayoutOverviewRow[] }`
Computes 4 values from the array. Uses `formatCurrency()` for monetary values, plain number for count.
Uses existing `StatCard` component with gold/lion accent.

**Acceptance**:
- [x] All 4 cards render with correct values
- [x] Empty data shows $0 or 0
- [x] formatCurrency used for monetary values
- [x] Follows StatCard pattern from DashboardHome

---

### TASK-010: Create PayoutsTable component

**Specs**: PAY-001, PAY-003, PAY-007, PAY-012, NFR-UX-01
**Priority**: HIGH
**Depends on**: TASK-008
**Files**:
- Create: `apps/admin-web/src/components/features/payments/PayoutsTable.tsx`
**Estimate**: ~150 lines

**Description**:
DataTable with:
- Checkbox column (disabled when status !== 'pending')
- "Select All" header checkbox
- Columns: checkbox, seller name, amount (formatCurrency), bank (CLABE last 3), requested date, status (StatusBadge), actions
- Row actions dropdown or buttons based on status:
  - `pending`: "Generar Archivo" (disabled if not selected), "Rechazar"
  - `processing`: "Completar", "Revertir", "Re-generar Archivo", "Rechazar"
  - `completed`: no actions (show processed_by_name and completed_at)
  - `rejected`: show rejected_reason
- `is_verified = false` → show warning icon on bank column
- Status filter tabs above: Pendientes, En Proceso, Completados, Rechazados, Todos
- Search input with debounce (300ms)

Props: `{ payouts, isLoading, isError, refetch, onGenerateFile, onStatusChange }`

**Acceptance**:
- [x] Checkboxes disabled for non-pending rows (NFR-UX-01)
- [x] Select All only selects pending rows
- [x] Status filters work correctly
- [x] Search filters by seller name
- [x] Row actions available per status
- [x] Unverified bank accounts show warning

---

### TASK-011: Create PaymentsPage and wire route

**Specs**: PAY-001, PAY-002, PAY-003
**Priority**: HIGH
**Depends on**: TASK-008, TASK-009, TASK-010
**Files**:
- Create: `apps/admin-web/src/pages/PaymentsPage.tsx`
- Modify: `apps/admin-web/src/App.tsx`
**Estimate**: ~100 lines

**Description**:
Main page component assembling KPIPaymentsCards + filter tabs + search + PayoutsTable + batch action bar.

State:
- `statusFilter: PayoutStatus | 'all'`
- `search: string`
- `selectedIds: Set<string>`
- `debtouncedSearch: string` via useDebounce

Batch actions:
- "Generar Archivo BBVA" — disabled when selectedIds is empty, calls onGenerateFile
- "Re-generar Archivo" — appears when viewing processing tab

Replace `/payments` placeholder in App.tsx with `<PaymentsPage />`.

**Acceptance**:
- [x] Page renders with all sections
- [x] Route `/payments` loads PaymentsPage (not placeholder)
- [x] Filter tabs switch status filter
- [x] Search works with 300ms debounce
- [x] Batch action bar enables/disables correctly
- [x] "Re-generar Archivo" appears on processing tab

---

### TASK-012: Implement file generation flow (download + DB update)

**Specs**: PAY-003, PAY-007, PAY-008, NFR-SEC-02, NFR-SEC-03, NFR-UX-02
**Priority**: HIGH
**Depends on**: TASK-007, TASK-010, TASK-011
**Files**:
- Modify: `apps/admin-web/src/pages/PaymentsPage.tsx`
- Modify: `apps/admin-web/src/hooks/useUpdatePayoutStatus.ts`
**Estimate**: ~80 lines

**Description**:
Wire the complete file generation flow:

1. **Pre-export validation modal** (ConfirmModal variant):
   - Shows checklist: CLABE validation results, bank code mapping, name sanitization preview, checksum
   - Warns for `is_verified = false` accounts
   - Blocks if any invalid CLABE
   - Shows total amount and count

2. **DB-first, file-second ordering**:
   - Call `markAsProcessing(selectedIds)` FIRST
   - If DB update succeeds (affected rows > 0), generate file
   - If DB update returns 0 rows for some IDs (race condition), show warning, exclude those, continue with remaining
   - If DB update fails entirely, show error toast, NO file download

3. **File download**:
   - Create Blob from BBVA content
   - Trigger browser download with filename `dispersion_YYYYMMDD_HHmmss.txt`
   - If download fails, payouts remain `processing` — admin can re-generate

4. **Re-generate for processing payouts**:
   - "Re-generar Archivo" button for payouts already in `processing`
   - Skips DB update, just regenerates file from data

5. **Audit logging**:
   - Insert into `admin_audit_logs` on every file generation and status change
   - NEVER log full CLABE values (NFR-SEC-02)

**Acceptance**:
- [ ] Pre-export modal shows validation results
- [ ] DB update happens BEFORE file download
- [ ] Race condition: 0 affected rows shows warning, continues with valid rows
- [ ] Failed download: admin can re-generate
- [ ] "Re-generar Archivo" works for processing payouts
- [ ] Audit log entries created for all actions
- [ ] CLABE values never appear in audit JSON

---

### TASK-013: Implement status transitions (ConfirmModal + InputModal + wallet restore)

**Specs**: PAY-007, PAY-012
**Priority**: HIGH
**Depends on**: TASK-008, TASK-010, TASK-011
**Files**:
- Modify: `apps/admin-web/src/hooks/useUpdatePayoutStatus.ts`
- Modify: `apps/admin-web/src/pages/PaymentsPage.tsx`
**Estimate**: ~80 lines

**Description**:
Wire all status transition actions:

1. **"Completar"** (processing → completed): ConfirmModal → sets `completed_at`, logs audit
2. **"Revertir"** (processing → pending): ConfirmModal → clears `processed_by` and `processed_at`, logs audit
3. **"Rechazar"** (pending/processing → rejected): InputModal with min 5 chars → sets `rejected_reason` + `rejected_at`, restores wallet balance (increment `pending_balance`, fallback `available_balance`), logs audit

Wallet restore logic in `rejectPayout`:
```sql
-- Restore balance: prefer pending_balance, fallback to available_balance
UPDATE wallets SET pending_balance = pending_balance + payout_amount
WHERE user_id = payout_user_id;
-- If pending_balance was 0 or insufficient, also update available_balance
```

**Acceptance**:
- [ ] All 4 transitions work with confirmation modals
- [ ] Reject requires reason (min 5 chars) via InputModal
- [ ] Rejected payout restores wallet balance
- [ ] All transitions logged to admin_audit_logs
- [ ] Invalid transitions blocked (e.g., pending → completed directly)

---

### TASK-014: Quick wins — DataTable i18n and formatCurrency consistency

**Specs**: PAY-010, PAY-011
**Priority**: MEDIUM
**Depends on**: None (can be done anytime)
**Files**:
- Modify: `apps/admin-web/src/components/ui/DataTable.tsx`
- Modify: `apps/admin-web/src/components/features/users/UserPayoutsTable.tsx`
**Estimate**: ~15 lines

**Description**:

1. **DataTable i18n**: Change "Previous" → "Anterior" and "Next" → "Siguiente" in DataTable pagination.

2. **formatCurrency consistency**: In `UserPayoutsTable`, replace any `$${amount.toLocaleString()}` or similar manual formatting with `formatCurrency(amount)`.

**Acceptance**:
- [x] DataTable pagination shows "Anterior" and "Siguiente"
- [ ] All monetary values in UserPayoutsTable use formatCurrency()
- [x] No visual regressions in existing pages
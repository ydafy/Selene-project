# Design: Admin Payments Page (Dispersión)

## Technical Approach

Client-side BBVA dispersion file generation with atomic DB-first status transitions. A Supabase view `admin_payments_overview` joins `payout_requests` + `seller_bank_accounts` + `profiles` to avoid N+1. TanStack Query hook queries the view with filters/search. Status transitions use `WHERE status = 'current'` to prevent race conditions. Every action is audited to `admin_audit_logs`.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| File generation | Client-side utility | Edge Function | MVP has dozens of rows. Avoids server complexity and cold starts. |
| DB ordering | Update before download | Download before update | Prevents double-dispersion. Failed downloads leave payouts in `processing` for re-generation. |
| Race condition guard | Atomic `WHERE status = 'pending'` | Optimistic locking | Works natively with Supabase SDK. Returns 0 affected rows on conflict. |
| Bank code source | Hardcoded `SPEI_BANK_CODES` Map | `mexico_banks` table | **Decided.** Bank list is stable and changes infrequently. Hardcoded map is deterministic, tested, no query overhead. |
| Wallet restore on reject | Increment `pending_balance`, fallback `available_balance` | Create `wallet_transaction` row | Spec requirement. Simple balance restoration without extra ledger entries. |
| Status column type | `payout_status` enum | Keep `string \| null` | **Decided.** Enum prevents typos in money-critical status transitions. DB-level type safety for `WHERE status = 'pending'`. |

## Data Flow

```
admin_payments_overview → usePayoutRequests → PaymentsPage
                                    ↓
selected rows → validateCLABE + sanitizeBBVAName + getBankCode
                                    ↓
atomic UPDATE status='processing' WHERE status='pending' AND id IN (...)
                                    ↓
generateBBVAFile → browser download + audit log
```

## File Changes

| File | Action | Description |
|---|---|---|
| `pages/PaymentsPage.tsx` | Create | Main page: KPI cards, filter tabs, search, batch action bar, PayoutsTable |
| `components/features/payments/PayoutsTable.tsx` | Create | DataTable with checkbox column, row actions, status badges |
| `components/features/payments/KPIPaymentsCards.tsx` | Create | 4 StatCards: Total Pendiente, En Proceso, Volumen Procesado (mes), Retiros Fallidos |
| `hooks/usePayoutRequests.ts` | Create | TanStack Query hook querying `admin_payments_overview` with filters/search/sort |
| `lib/bbva.ts` | Create | `generateBBVAFile`, `validateCLABE`, `sanitizeBBVAName`, `SPEI_BANK_CODES`, `getBankCode` |
| `components/ui/DataTable.tsx` | Modify | i18n pagination labels: "Previous"→"Anterior", "Next"→"Siguiente" |
| `components/features/users/UserPayoutsTable.tsx` | Modify | Replace `$${amount.toLocaleString()}` with `formatCurrency()` |
| `App.tsx` | Modify | Replace `/payments` placeholder with `<PaymentsPage />` |
| `packages/types/src/index.ts` | Modify | Add `PayoutOverviewRow` type alias |
| `supabase/migrations/...admin_payments_overview.sql` | Create | View definition + RLS policy + `payout_requests` column additions |

## Database Changes

**Migration 1: Create `payout_status` enum + add columns to `payout_requests`**
```sql
-- Create enum type (production-grade: prevents typos in status transitions)
CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'completed', 'rejected');

-- Alter existing status column to use enum
ALTER TABLE payout_requests
  ALTER COLUMN status TYPE payout_status
  USING status::payout_status;

-- Add new columns for lifecycle tracking
ALTER TABLE payout_requests
ADD COLUMN IF NOT EXISTS completed_at timestamptz,
ADD COLUMN IF NOT EXISTS rejected_reason text,
ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
```

**Migration 2: Create `admin_payments_overview` view**
```sql
CREATE OR REPLACE VIEW admin_payments_overview AS
SELECT
  pr.id, pr.user_id, p.username as seller_name,
  pr.amount, pr.status, sba.clabe, sba.bank_name,
  sba.is_verified, sba.account_holder_name,
  pr.requested_at, pr.processed_at, pr.processed_by,
  pr.completed_at, pr.rejected_reason, pr.rejected_at,
  ap.username as processed_by_name
FROM payout_requests pr
JOIN seller_bank_accounts sba ON sba.id = pr.bank_account_id
JOIN profiles p ON p.id = pr.user_id
LEFT JOIN profiles ap ON ap.id = pr.processed_by;
```

**Migration 3: RLS policy**
```sql
CREATE POLICY admin_payments_overview_select
ON admin_payments_overview FOR SELECT TO authenticated
USING (is_admin());
```

## Component Design

- **PaymentsPage**: State: `statusFilter`, `search`, `sortBy`, `selectedIds` (Set). Renders `KPIPaymentsCards`, filter tabs, search input with `useDebounce(300)`, batch action bar ("Generar Archivo BBVA", "Re-generar"), and `PayoutsTable`. Calls `usePayoutRequests`.
- **PayoutsTable**: Props: `payouts`, `selectedIds`, `onSelectRow`, `onSelectAll`, `onAction`. Checkbox column uses custom `header`/`cell` renderers with native `<input type="checkbox">`. Row actions: "Completar", "Revertir", "Rechazar", "Re-generar" (processing only). Checkboxes disabled when `status !== 'pending'`.
- **KPIPaymentsCards**: Computes 4 summaries from `payouts` array: sum pending, sum processing, sum completed this month (using `completed_at`), count rejected. Uses existing `StatCard` + `formatCurrency`.

## Hook Design

`usePayoutRequests(filter, search, sortBy)`:
- `queryKey: ['admin-payments', filter, search, sortBy]`
- Queries `admin_payments_overview`
- Filters: `.eq('status', filter)` when not `'all'`; `.ilike('seller_name', %search%)` when search present
- Sort: `amount` asc/desc, `requested_at` asc/desc
- `refetchInterval: 30000`
- Returns `{ data, isLoading, isError, refetch }`

## Utility Design

`validateCLABE(clabe): { valid: boolean; error?: string }`
- Validates 18 digits, numeric only, computes check digit with weighted sum [3,7,1,3,7,1,3,7,1,3,7,1,3,7,1,3,7,1] modulo 10.

`sanitizeBBVAName(name): string`
- Uppercase, strip accents (á→A, é→E, í→I, ó→O, ú→U, ü→U), Ñ→N, remove special chars (#$&), collapse spaces, trim. Null-safe returns `''`.

`getBankCode(bankName): string`
- Looks up `SPEI_BANK_CODES` Map. Throws `Error('Banco no soportado: ${bankName}')` if missing.

`generateBBVAFile(rows, options): { content: string; filename: string; checksum: number }`
- Validates all rows (CLABE, bank code, sanitized name, no duplicates).
- Computes checksum: sum of all `amount`.
- Formats: `BANCO,CUENTA,IMPORTE,BENEFICIARIO,REFERENCIA` per line.
- Returns UTF-8 string (no BOM) ready for Blob/download.

## State Machine

```
pending ──[file gen]──→ processing ──[confirm]──→ completed
   ↑                       │
   └────[revert]───────────┘
   │
   └──[reject + reason]────→ rejected
```

- **pending→processing**: Sets `processed_by = admin_id`, `processed_at = now`.
- **processing→completed**: Sets `completed_at = now`.
- **processing→pending**: Clears `processed_by` and `processed_at`.
- **pending/processing→rejected**: Sets `rejected_reason`, `rejected_at = now`. Restores wallet `pending_balance` (or `available_balance` if insufficient).

## Error Handling

| Failure | UI Behavior |
|---|---|
| DB update fails | Toast error. No file download triggered. |
| Browser download fails | Payouts remain `processing`. Admin sees "Re-generar Archivo" button. |
| Race condition (0 rows updated) | Warning toast: "X retiro(s) ya no están pendientes". File generates with remaining valid rows only. |
| Invalid CLABE | Pre-export checklist blocks download with specific error per row. |
| Unverified bank account | Pre-export warning. Admin must confirm to proceed. |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | BBVA utilities | Bun test: `validateCLABE`, `sanitizeBBVAName`, `getBankCode`, `generateBBVAFile` with edge cases (accents, Ñ, invalid CLABE, duplicate IDs). |
| Unit | `usePayoutRequests` | Mock Supabase client, verify queryKey composition and filter logic. |
| Integration | DB view + RLS | Seed Supabase local DB, test `is_admin()` policy returns rows only for admins. |
| Integration | Atomic transitions | Two concurrent updates: verify second returns 0 affected rows. |
| E2E | Full flow | Playwright: login → select payouts → generate file → verify download → mark completed → verify audit log. |

## Migration / Rollout

1. Deploy migration: add `completed_at`, `rejected_reason`, `rejected_at` to `payout_requests`; create view; add RLS policy.
2. Run `bun db:types` to regenerate `packages/types`.
3. Deploy frontend build.
4. No existing data migration required.

## Open Questions

~~Should `mexico_banks` table be used as source of truth for SPEI codes instead of hardcoded Map?~~ → **Decided: Hardcoded Map.** The bank list is stable, changes infrequently, and a DB table adds query overhead with no benefit for MVP.

~~Should we create a `payout_status` enum now, or defer to `admin-payments-v2`?~~ → **Decided: Create enum NOW.** This page handles real money. Strings allow typos (`'procesing'`) that cause silent bugs in atomic WHERE clauses. An enum gives DB-level type safety, TypeScript autocompletion, and zero chance of invalid status values. The cost is one line in the migration we're already writing.

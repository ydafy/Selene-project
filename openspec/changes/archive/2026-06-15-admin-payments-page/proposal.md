# Proposal: Admin Payments Page (Dispersión)

## Intent

Admins have no operational view to process seller payout requests. They cannot see pending `payout_requests`, select which to disperse, generate the BBVA Net Cash file, or mark payouts as processing/completed. The `/payments` route is a placeholder. This change builds the core operational tool for SPEI-based payout dispersion.

**Quality bar: Production-ready.** This is not a prototype or proof-of-concept. Every feature must work correctly with real data, handle edge cases, validate inputs, and be deployable to production. The goal is that after finishing, an admin can use this page to process real payouts with real money.

## Scope

### In Scope

- `PaymentsPage` — list pending/processing payouts with DataTable, checkbox selection, "Select All", status filters
- `usePayoutRequests` hook — query `payout_requests` joined with `seller_bank_accounts` and `profiles` (via `admin_user_directory_view`)
- BBVA dispersion file generation — client-side `.txt` export with exact format from `docs/bbva-dispersion-format.md`
- CLABE validation — official checksum algorithm before file generation
- Name sanitization — strip accents (á→A), Ñ→N, uppercase, remove special chars
- Bank code mapping — `seller_bank_accounts.bank_name` → 3-digit SPEI code
- Status transitions — `pending` → `processing` (on file generation), `processing` → `completed` (admin confirmation), `processing` → `pending` (revert if cancelled)
- Checksum validation — total amount in file must equal sum of selected payouts before download
- Admin audit logging — record who generated which file, when, which payouts
- KPI summary cards — Total Pendiente, Retiros en Proceso, Volumen Procesado (mes), Retiros Fallidos
- Quick wins: DataTable pagination labels ("Anterior"/"Siguiente"), `formatCurrency` consistency

### Out of Scope (Next SDD Change: `admin-payments-v2`)

These features are intentionally deferred to a follow-up SDD change. They are saved here as the documented roadmap so nothing is lost.

- **Global transaction ledger** — searchable/filterable view of all `wallet_transactions` across users
- **Payout detail page** — dedicated `/payments/:id` route with full payout info, associated transactions, admin notes
- **KPI dashboard with trends** — charts for volume over time, average processing time, success rate
- **Automated bank confirmation** — webhook or manual import of BBVA confirmation file to auto-mark completed
- **Seller notification on completion** — in-app + push notification when payout is processed
- **System settings UI** — admin page to view/edit `system_settings` (fees, min payout, etc.)
- **`payout_status` enum** — replace `payout_requests.status` string column with proper enum type
- **Edge Function for file generation** — server-side BBVA file generation for larger volumes (>1000 rows)

> **Roadmap**: After this change is deployed and validated in production, the next SDD change (`admin-payments-v2`) will pick up these items in priority order.

## Capabilities

### New Capabilities

- `admin-payments`: Admin view for listing, filtering, selecting, and batch-processing payout requests with BBVA dispersion file generation

### Modified Capabilities

- None (all new UI; existing components used as-is)

## Approach

**Data layer**: Create a Supabase view `admin_payments_overview` joining `payout_requests` + `seller_bank_accounts` + `admin_user_directory_view` to avoid N+1 queries. Hook queries this view filtered by status.

**BBVA file generation**: Client-side utility function with full test coverage. Takes selected payout rows, validates CLABE checksums, sanitizes names, maps bank names to SPEI codes, formats CSV lines, triggers browser download. No Edge Function needed for MVP — file is small (dozens of rows, not thousands). The utility must be production-grade: strict validation, clear error messages, no silent failures.

**Status transitions**: Use Supabase `update` with `processed_by = admin_id` for processing/completed. Provide "revert to pending" action for cancelled дисперсияs. Use `ConfirmModal` for all destructive transitions.

**Audit**: Insert into `admin_audit_logs` on every file generation and status change.

**Components**: `PaymentsPage` (page), `PayoutsTable` (DataTable with checkboxes), `usePayoutRequests` (hook), `generateBBVAFile` (utility), `validateCLABE` (utility), `sanitizeBBVAName` (utility), `SPEI_BANK_CODES` (constant map).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/admin-web/src/pages/PaymentsPage.tsx` | New | Main payments page component |
| `apps/admin-web/src/hooks/usePayoutRequests.ts` | New | Data fetching hook |
| `apps/admin-web/src/lib/bbva.ts` | New | File generation, CLABE validation, name sanitization, bank codes |
| `apps/admin-web/src/components/features/payments/PayoutsTable.tsx` | New | DataTable with row selection |
| `apps/admin-web/src/components/features/payments/KPIPaymentsCards.tsx` | New | Summary stat cards |
| `apps/admin-web/src/components/ui/DataTable.tsx` | Modified | Pagination labels i18n (Previous→Anterior, Next→Siguiente) |
| `apps/admin-web/src/App.tsx` | Modified | Replace placeholder with `PaymentsPage` component |
| `packages/types/src/index.ts` | Modified | Add `PayoutOverviewRow` type |
| `supabase/migrations/` | New | Migration for `admin_payments_overview` view + audit trigger |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Double-dispersion: admin generates file twice for same payouts | Med | Mark as `processing` atomically on file generation; disable selection of `processing` rows |
| BBVA rejects file due to format error (leading zeros lost, bad CLABE) | Med | Validate CLABE checksum + sanitize names + preserve zero-padded bank codes in code; add pre-export checklist UI |
| CLABE from `seller_bank_accounts` is unverified (`is_verified = false`) | Med | Warn admin in UI; highlight unverified accounts in table row |
| Race condition on status update (two admins process same payout) | Low | Use `processed_by` + `processed_at` as optimistic lock; update with `WHERE status = 'pending'` |

## Rollback Plan

1. Revert route in `App.tsx` to placeholder
2. Drop `admin_payments_overview` view and audit trigger via migration rollback
3. All new files are additive — delete `pages/PaymentsPage.*`, `hooks/usePayoutRequests.*`, `components/features/payments/*`, `lib/bbva.*`
4. No data migration required; no existing data altered

## Dependencies

- `payout_requests` and `seller_bank_accounts` tables must exist (they do)
- `admin_audit_logs` table must exist (it does)
- `admin_user_directory_view` must exist (it does)
- `is_admin()` RLS function must be in place (it is)
- `packages/types` must be regenerated after view creation

## Success Criteria

- [ ] Admin can see all pending payouts in a filterable, sortable DataTable
- [ ] Admin can select payouts via checkboxes (including "Select All")
- [ ] Generated BBVA `.txt` file passes format validation (CLABE checksum, name sanitization, bank codes, amounts)
- [ ] Download triggers only after pre-export checklist passes (total checksum, no unverified CLABEs without warning)
- [ ] Selected payouts transition to `processing` on file generation
- [ ] Admin can revert `processing` payouts back to `pending`
- [ ] Admin can mark `processing` payouts as `completed`
- [ ] Every file generation and status change is recorded in `admin_audit_logs`
- [ ] KPI cards show Total Pendiente, En Proceso, Volumen Procesado, Fallidos
- [ ] DataTable pagination labels in Spanish (Anterior/Siguiente)
- [ ] All financial amounts use `formatCurrency()` consistently
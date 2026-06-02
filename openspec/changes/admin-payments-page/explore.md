# Exploration: Admin Dashboard Payments Page

## Current State

### Dashboard Architecture
The admin-web dashboard is a React + Vite + TypeScript + Tailwind CSS SPA with React Router v6. It has:

- **5 working pages**: DashboardHome, UsersPage, UserDetailPage, DisputesPage, DisputeDetailPage, VerificationPage
- **1 placeholder**: `/payments` route renders `<div>Próximamente: Pagos</div>`
- **Layout**: Sidebar with 5 nav items (Inicio, Verificación, Usuarios, Disputas, Pagos/Dispersión), mobile-responsive with hamburger toggle
- **Auth**: Zustand store + Supabase Auth, admin-only protected routes

### Data Fetching Pattern
All pages follow the same pattern:
1. Custom hook wrapping `useQuery` from TanStack Query
2. Hook calls Supabase client directly (no API layer)
3. Returns `{ data, isLoading, isError, refetch }`
4. Page component handles loading/error/data states

### UI Component Library
- **DataTable** — TanStack Table v8 wrapper with sorting, pagination (client-side + manual), skeleton rows, empty state
- **StatCard** — KPI card with trend arrows, goal badges, sparklines, target bars, optional navigation
- **StatusBadge** — Status pill with color mapping for 20+ status types
- **Skeleton** — Loading placeholder (text/circular/rectangular variants)
- **ErrorState** — Error banner with retry button
- **ErrorBoundary** — React error boundary wrapping all routes
- **Modals** — InputModal, ConfirmModal, ImageModal

## Payments Data Landscape

### Database Tables (from `database.types.ts`)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `wallets` | `user_id`, `available_balance`, `pending_balance`, `currency` | Per-user wallet with available/pending balances |
| `wallet_transactions` | `wallet_id`, `type`, `amount`, `net_amount`, `fee_deducted`, `shipping_cost`, `balance_after`, `order_id`, `shipment_id` | Financial ledger. Types: `sale_proceeds`, `payout`, `refund`, `adjustment`, `release` |
| `payout_requests` | `user_id`, `wallet_id`, `amount`, `status`, `bank_account_id`, `requested_at`, `processed_at`, `processed_by` | User withdrawal requests to their bank |
| `orders` | `buyer_id`, `total_amount`, `service_fee_amount`, `status`, `stripe_payment_intent_id` | Purchase orders with Stripe integration |
| `order_items` | `seller_id`, `product_id`, `price_at_purchase`, `commission_amount`, `net_payout`, `shipping_amount`, `shipment_id` | Per-seller line items with financial breakdown |
| `shipments` | `order_id`, `seller_id`, `status`, `tracking_number`, `envia_shipment_id` | Per-seller shipment within an order |
| `payment_methods` | `user_id`, `brand`, `last4`, `stripe_payment_method_id`, `is_default` | Customer payment methods (cards) |
| `seller_bank_accounts` | `user_id`, `clabe`, `bank_name`, `account_holder_name`, `is_verified` | Seller bank accounts for payouts |
| `system_settings` | `service_fee_pct`, `service_fee_fixed_cents`, `payout_fee_fixed_cents`, `min_payout_amount_cents` | Platform fee configuration |

### Enum Types
- `order_status_enum`: `pending`, `paid`, `preparing`, `shipped`, `delivered`, `completed`, `cancelled`, `dispute`, `refunded`
- `wallet_transaction_type`: `sale_proceeds`, `payout`, `refund`, `adjustment`, `release`
- `account_status`: `active`, `suspended`, `banned`

### Edge Functions (payment-related)
| Function | Purpose |
|----------|---------|
| `create-payment-intent` | Stripe PaymentIntent creation (dual: anon customer + service_role admin) |
| `stripe-webhooks` | Handle Stripe payment events |
| `resolve-dispute-refund` | Admin triggers refund per shipment |
| `release-funds` | Cron: release shipment funds to seller wallets |
| `manage-payment-methods` | Payment method CRUD |
| `create-return-intent` | Seller pays return shipping via Stripe |
| `generate-return-label` | Generate return shipping label |

### Existing TypeScript Types (from `@selene/types`)
- `Wallet` — `Tables<'wallets'>`
- `WalletTransaction` — `Tables<'wallet_transactions'>`
- `PayoutRequest` — `Tables<'payout_requests'>`
- `SellerBankAccount` — `Tables<'seller_bank_accounts'>`
- `Order` — `Tables<'orders'>`
- `Shipment` — `Tables<'shipments'>`
- `PaymentMethod` — `Tables<'payment_methods'>`

### Existing Financial Components (in UserDetailPage)
- `UserWalletCard` — Shows available + pending balance for a single user
- `UserBankCard` — Shows CLABE/bank info with copy button
- `UserPayoutsTable` — Lists payout_requests for a single user (3 columns: amount, status, date)
- `UserTransactionsTable` — Ledger table with 6 columns (date, type/description, gross, fee, shipping, net, balance_after)

### Existing Hooks
- `useAdminStats` — Dashboard KPIs (includes `totalToPay` = sum of all `available_balance`)
- `useUserDetail` — Loads wallet_transactions and payouts for a single user (part of 16 parallel queries)

**No dedicated payments hooks exist yet.** No `usePayments`, `usePayouts`, `useWalletTransactions` at the admin/global level.

## Pattern Catalog

### Established Patterns to Follow

#### 1. Page Structure
```tsx
export const SomePage = () => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { data, isLoading, isError, refetch } = useSomeHook(debouncedSearch, filter);

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      {/* Header with title + count badge */}
      {/* Filters: tabs/pills + search + sort select */}
      {/* DataTable or grid of cards */}
    </div>
  );
};
```

#### 2. Hook Structure
```tsx
export const useSomeHook = (search: string, filter: string) => {
  return useQuery({
    queryKey: ['some-key', search, filter],
    queryFn: async () => {
      let query = supabase.from('some_view').select('*');
      // Apply filters
      // Apply sorting
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000, // or placeholderData for stale-while-revalidate
  });
};
```

#### 3. DataTable Usage
- Columns defined with `useMemo` + `ColumnDef<T>[]`
- `accessorKey` for direct field access, `id` + `cell` for computed columns
- `StatusBadge` for status columns
- `onRowClick` for navigation to detail pages
- Custom header with icon + title
- Manual pagination when server-side, client-side otherwise

#### 4. Styling Conventions
- Dark theme: `bg-state-gray`, `bg-night`, `text-platinum`, `text-blue-light`, `text-lion`
- Rounded corners: `rounded-2xl`, `rounded-3xl`
- Borders: `border border-white/5`, `border-white/10`
- Spacing: `space-y-6`, `gap-6`, `p-6`, `p-8`
- Focus rings: `focus:ring-2 focus:ring-lion/50`
- All interactive elements: `cursor-pointer`, `outline-none`

#### 5. Navigation
- `useNavigate()` from react-router-dom
- Sidebar nav items in `Layout.tsx` with `Wallet` icon already mapped to `/payments`
- Route already registered in `App.tsx` (placeholder)

## Technical Debt & Improvements

### Issues to Address Before or Alongside Payments Page

#### High Priority
1. **No admin-level payments view** — All financial data is per-user (UserDetailPage). Need aggregate views for admin oversight.
2. **No `payout_requests` status enum in DB types** — `payout_requests.status` is `string | null`, not typed. Should be an enum.
3. **DataTable pagination labels in English** — "Previous"/"Next" while rest of app is Spanish. Affects all pages.
4. **`useAdminStats` totalToPay is sum of all wallets** — This is the total available balance across ALL users, not just pending payouts. The label "Por Dispersar (Vendedores)" is misleading.

#### Medium Priority
5. **StatCard COLOR_MAP is manual** — Hardcoded hex values that must be kept in sync with Tailwind theme. Could use CSS variables or computed style.
6. **`formatCurrency` exists but inconsistently used** — Some places use `formatCurrency()`, others use `${amount.toLocaleString()}`. The transactions table and payouts table don't use it.
7. **No `useQuery` `staleTime` configured** — All queries refetch on mount. Could benefit from `staleTime` for better UX.
8. **No admin view for system_settings** — Fee configuration lives in DB but no admin UI to view/edit.

#### Low Priority
9. **`UserPayoutsTable` limits to 20** — No pagination, just `limit(20)` in the query.
10. **`UserTransactionsTable` doesn't use DataTable's isLoading** — Has its own empty state, doesn't leverage DataTable's built-in skeleton rows.
11. **`StatusBadge` has 20+ status types in one component** — Could be split by domain (orders, products, disputes, payouts).

## Skill-Based Recommendations

### KPI Dashboard Design
- **Limit to 5-7 KPIs** per view — Payments page should have: Total Pending Payout, Payouts This Week, Failed Payouts, Total Volume Processed, Average Processing Time
- **Show context** — Every KPI needs trend (% vs prior period), target, or comparison
- **Consistent colors** — Green=good (released), red=bad (failed/rejected), amber=pending
- **Enable drilldown** — Summary KPIs → table → individual payout detail

### Frontend Design
- **Maintain existing aesthetic** — The dark theme with gold (`lion`) accents is cohesive and well-executed. Don't break it.
- **Typography hierarchy** — Keep the `[10px] uppercase tracking-widest` for labels, `text-2xl/3xl font-bold` for values
- **Motion** — Use existing `animate-in fade-in` classes for page transitions

### Tailwind CSS Patterns
- **Use existing tokens** — `state-gray`, `night`, `platinum`, `blue-light`, `lion`, `forest`, `fire` are the design system colors
- **Responsive grid** — `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` for card layouts
- **Dark theme patterns** — `bg-white/5` for subtle backgrounds, `border-white/5` for dividers

### Supabase Postgres Best Practices
- **Use views for complex queries** — Like `admin_user_directory_view` and `admin_disputes_monitor_view`. Create `admin_payments_overview` view.
- **RLS policies** — Admin queries should use `is_admin()` function. All existing admin hooks rely on admin-only frontend auth, but DB-level RLS is the real protection.
- **Avoid N+1** — Use joins or views instead of separate queries per row.

### Native Data Fetching (adapted for web)
- **TanStack Query patterns** — `queryKey` arrays with all filter params, `placeholderData` for stale-while-revalidate, `refetchInterval` for real-time data
- **Error handling** — Throw on error, let page component handle with `ErrorState`
- **Debounced search** — `useDebounce(value, 300)` pattern is standard

## Recommended Approach

### Priority Order

1. **Create database view** — `admin_payments_overview` that aggregates: pending payouts, completed payouts, failed payouts, total volume, per-seller summaries. This is the foundation.

2. **Build Payments page directly** — Follow established patterns:
   - `usePayments()` hook → queries the new view
   - `PaymentsPage.tsx` → header, filters, DataTable
   - `PaymentsDetailPage.tsx` → individual payout/transaction detail (optional, could be modal)
   - Register route in `App.tsx` (replace placeholder)

3. **Fix DataTable pagination labels** — Quick win, affects all pages. Change "Previous"/"Next" to "Anterior"/"Siguiente".

4. **Standardize currency formatting** — Replace all `toLocaleString()` with `formatCurrency()` across financial components.

5. **Add payout status enum** — If not already defined, add `payout_status` enum to DB and regenerate types.

### Should We Improve Existing Code First?

**No.** The existing code quality is sufficient to build the payments page. The patterns are consistent and well-established. The technical debt items listed above are either:
- **Quick fixes** that can be done alongside the payments page (pagination labels, currency formatting)
- **Larger refactors** that belong in the existing `admin-dashboard-audit` proposal (type safety, component breakdown)

The payments page should be a **separate SDD change** that:
- Creates the new view, hooks, components, and routes
- Fixes the 2-3 quick wins that directly affect the payments page
- Leaves the larger refactoring for the audit proposal

### What the Payments Page Should Include

1. **Summary KPIs** (4 cards):
   - Total Por Dispersar (sum of available_balance)
   - Retiros Pendientes (payout_requests where status = 'pending' or 'processing')
   - Volumen Procesado Este Mes (sum of wallet_transactions where type = 'payout' this month)
   - Retiros Fallidos (payout_requests where status = 'rejected')

2. **Pending Payouts Table**:
   - Columns: User, Amount, Bank (CLABE last 4), Requested Date, Status, Actions
   - Filters: Status (pending, processing, completed, rejected), Date range
   - Actions: Approve, Reject, View Details

3. **Transaction Ledger** (optional tab or separate page):
   - Global wallet_transactions table with filters by type, date range, user
   - Columns: Date, Type, User, Order/Shipment, Gross, Fee, Net, Balance After

4. **Payout Detail** (modal or separate page):
   - User info, bank details, amount, associated transactions, admin notes

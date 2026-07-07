# Admin Critical Fixes Specification

## Purpose

The admin dashboard SHALL handle session expiry, surface silent errors, prevent lock leaks, and provide navigable KPI cards with trend goals. All fixes are client-side — no schema or RPC changes.

## Requirements

### Requirement: Session Expiry Handler

The system SHALL subscribe to `supabase.auth.onAuthStateChange` at app mount. On `SIGNED_OUT` or `TOKEN_REFRESHED` with null session, it SHALL clear the auth store, show a warning toast, and navigate to `/login`. `INITIAL_SESSION` events SHALL be ignored (handled by existing `initialize()`).

#### Scenario: Session expires during active use

- GIVEN an admin is viewing the dashboard with a valid session
- WHEN Supabase fires `SIGNED_OUT`
- THEN auth store is cleared, warning toast appears, and URL navigates to `/login`

#### Scenario: Token refresh fails

- GIVEN the session token expires and refresh is attempted
- WHEN `TOKEN_REFRESHED` fires with `session = null`
- THEN auth store is cleared, warning toast appears, and URL navigates to `/login`

#### Scenario: Initial session restore is not duplicated

- GIVEN the app is mounting for the first time
- WHEN `onAuthStateChange` fires `INITIAL_SESSION`
- THEN the handler returns early and does NOT trigger a redirect

### Requirement: Audit and Notification Error Surfacing

The system SHALL log audit trail and notification insertion errors to `console.error` and display a `toast.warning`. These errors SHALL NOT block the mutation success flow.

#### Scenario: Audit log insert fails

- GIVEN a product verdict mutation succeeds
- WHEN the `admin_audit_logs` insert returns an error
- THEN `console.error` prints the full error and a warning toast appears

#### Scenario: Notification insert fails

- GIVEN a product verdict mutation succeeds
- WHEN the `notifications` insert returns an error
- THEN `console.error` prints the full error and a warning toast appears

#### Scenario: Both audit and notification fail

- GIVEN both fire-and-forget inserts fail
- WHEN the mutation completes
- THEN two warning toasts appear AND the success toast still fires

### Requirement: Dashboard Error State Isolation

The system SHALL NOT render stat card grids, strategic metrics, or activity sections when `useAdminStats()` returns `isError = true`. Only the existing error banner SHALL be visible. Skeletons SHALL render when `isLoading = true` and `isError = false`.

#### Scenario: Query fails on dashboard load

- GIVEN `useAdminStats()` returns `isError = true`
- WHEN the dashboard renders
- THEN the error banner is visible and NO stat card grids render

#### Scenario: Retry restores data

- GIVEN the dashboard is in error state
- WHEN the user clicks "Reintentar" and `refetch()` succeeds
- THEN `isError` becomes false and all stat sections render with data

### Requirement: Disputes Page Error State

The system SHALL destructure `isError` and `refetch` from `useActiveDisputes` and render an `<ErrorState>` banner with a retry button when the query fails. The page heading and "Casos en Pantalla" stat SHALL remain visible.

#### Scenario: Disputes query fails

- GIVEN `useActiveDisputes` returns `isError = true`
- WHEN the DisputesPage renders
- THEN the heading and stat are visible AND an `<ErrorState>` banner with retry button appears

#### Scenario: Retry restores dispute list

- GIVEN the error state is visible
- WHEN the user clicks "Reintentar Carga"
- THEN `refetch()` fires and on success the dispute table renders

### Requirement: Sort Resets Pagination on UsersPage

The system SHALL reset `page` to `0` when the sort order changes on UsersPage. Both `setSortBy` and `setPage(0)` SHALL be called in the same event handler.

#### Scenario: Admin changes sort on page > 0

- GIVEN the admin is on page 3 of the users list
- WHEN the sort `<select>` value changes
- THEN `page` resets to `0` and the query fires with the new sort and page `0`

### Requirement: Lock Release Uses Cached Admin ID

The system SHALL cache the admin ID in a `useRef` at lock-acquisition time. `releaseLock` SHALL read from the ref, NOT from reactive `user?.id`, so that lock release fires correctly even after session expiry clears the auth store.

#### Scenario: Lock release after session expiry

- GIVEN an admin acquires a lock and `adminIdRef.current` is set
- WHEN the session expires and `user` becomes `null`
- THEN `releaseLock` still reads the admin ID from the ref and fires the unlock RPC

#### Scenario: Lock never acquired

- GIVEN `acquireLock` was never called or failed
- WHEN `releaseLock` is invoked
- THEN `adminIdRef.current` is `null` and the function early-returns without an RPC call

### Requirement: Lock Re-Check Before Verdict

The system SHALL call `fn_lock_product` at the start of the verdict mutation to verify the current admin still holds the lock. If `success = false`, the mutation SHALL throw and NOT call `products.update()`.

#### Scenario: Lock is still held

- GIVEN the admin holds a valid lock on the product
- WHEN the verdict mutation starts
- THEN `fn_lock_product` returns `success: true` and the mutation proceeds

#### Scenario: Lock expired or held by another admin

- GIVEN the lock TTL expired or another admin acquired it
- WHEN the verdict mutation starts
- THEN `fn_lock_product` returns `success: false`, the mutation throws, and a toast explains the session expired

### Requirement: StatCard Drilldown Navigation

The system SHALL accept an optional `href` prop on `StatCard`. When provided, the card SHALL be clickable (cursor-pointer), navigate via `useNavigate`, and support keyboard activation (Enter/Space) with `role="button"`.

#### Scenario: Operational KPI card click navigates

- GIVEN a StatCard has `href="/verify"`
- WHEN the user clicks the card
- THEN `navigate('/verify')` is called

#### Scenario: Card without href is not interactive

- GIVEN a StatCard has no `href` prop
- WHEN the user clicks the card
- THEN no navigation occurs and the card has no cursor-pointer styling

### Requirement: StatCard Trend Goal Rendering

The system SHALL accept an optional `goal` prop on `StatCard` with `value`, `label`, and `lowerIsBetter`. When `goal` and a non-neutral `trend` are both present, the system SHALL render goal comparison text colored green (`text-forest`) if the goal is met, or red (`text-fire`) if not.

#### Scenario: Sales trend meets goal

- GIVEN `trend.direction = 'up'`, `trend.percentage = 15`, `goal.value = 12`, `lowerIsBetter = false`
- WHEN the StatCard renders
- THEN goal text appears in green

#### Scenario: Disputes trend decreases (lower is better)

- GIVEN `trend.direction = 'down'`, `goal.value = 0`, `lowerIsBetter = true`
- WHEN the StatCard renders
- THEN goal text appears in green

#### Scenario: No trend or neutral trend

- GIVEN `trend` is null or `trend.direction = 'neutral'`
- WHEN the StatCard renders with a `goal`
- THEN no goal text is rendered

# Payments operational workbench

The admin `/payments` route starts in **Por liberar**. Horizontal lifecycle tabs sit below the title in a content-sized surface, capped at the available width with horizontal scrolling on narrow screens, followed by seller search. **Por liberar**, **Necesita atención** and **Historial** use taller, full-width lists and open details in a shared native modal shell. **En proceso** retains its list/inspector panels. Release and attention share a presentation-only selection/amount/action summary; financial eligibility and dispatch stay in their feature owners. Selene colors, floating dark surfaces and Montserrat are retained. This iteration is frontend-only: existing server permissions, eligibility, amounts, idempotency and retry limits remain authoritative.

## Daily operator flow

### Release payments

1. Choose **Seleccionar todos los elegibles** to fetch every selectable seller matching the current search, including unloaded server pages. A loading or incomplete/error result never installs partial selection. Alternatively open a seller card and choose its eligible shipments in the detail modal; blocked shipments cannot be authorized. Opening a card never selects shipments or releases money.
2. Check the selected seller count, shipment count and prominent **Total a liberar** in the content-sized action surface, then choose **Liberar** and **Confirmar liberación** once for the batch. The first action opens review; only explicit confirmation submits requests.
3. Requests execute serially, one seller at a time, through the existing release callback. Selecting or reviewing never moves money.
4. Accepted seller selections clear. On a rejected or unconfirmed request, the batch stops; failed and unattempted selections remain. Inspect accepted and unattempted counts and refresh before deciding what to do next.

A batch is **not atomic**. An accepted release request initiates processing; it does not confirm receipt in the seller's bank. A timeout does not prove no money moved. There are no automatic frontend mutation retries.

### Handle failures

1. Open **Necesita atención**. Retryable failures and investigation-only outcomes are distinguished in the list.
2. Choose **Seleccionar todos los reintentables**, or open a card and select that run in its modal. Cards show retry availability and the reported failure preview without a lateral checkbox. Green/check indicates an actual selected retry; opening details never selects or submits money actions. Only explicitly retryable `failed` runs qualify; canceled, ambiguous, unknown and nonretryable outcomes are never included.
3. Check the prominent **Total a reintentar**, then choose **Reintentar** and **Confirmar reintento** once. The modal retains the individual **Revisar reintento** path, which closes details and moves focus to the shared confirmation. Neither review action itself submits a request.
4. The existing retry callback receives only each run's ID. The server reconstructs amounts and validates confirmed failure and returned funds. Requests are serial, stop at the first rejection/drift, and preserve failed/unattempted selections.

A bank rejection may require correcting account details rather than repeating an operation. The modal prioritizes **Motivo reportado** (the exact supplied reason, or **No se recibió un motivo de fallo.**) and its timestamp when available. **Acción disponible** separately explains retry eligibility or why investigation is required; policy guidance is not the reported failure itself. **Referencias técnicas** holds copy actions for the existing run ID, seller ID and retry-parent ID when supplied, plus recorded status. Clipboard success is shown only after the browser accepts the exact value; unavailable/rejected clipboard reports an error and leaves selectable text for manual copying. Locate the run in Supabase to inspect its Stripe references: this queue does not expose a Stripe payout ID, and the UI does not invent IDs or direct payout links.

### Monitor and investigate

- **En proceso:** already-authorized runs, without another manual gate. The queue does not identify an exact processing stage or bank-arrival date.
- **Historial:** observed paid runs, strictly read-only. Click a card to open the existing seller, amount, observed-result explanation and technical references in the shared native modal; opening/closing never selects or retries anything. **Fue un reintento** is a compact badge; the parent execution ID remains under **Referencias técnicas**. A late reversal may move a run back to attention; if a refreshed query removes the focused run, its details disappear. Cards and the detail modal show **Fecha de pago observada** from the selected run's authoritative `paid_at`, formatted in the viewer's local time. History is ordered by payment instant newest first, with run ID descending for equal instants. Missing/invalid dates show **No disponible** and sort last, also by run ID descending; shipment completion, failure, retry creation and arrival estimates are never substituted. This date is an observed event time, not irreversible bank receipt.
- Buyer charges are deliberately removed from this payout workbench. The previous earnings view exposed shipment subtotals and shipment-derived status, not authoritative full buyer charges. Neither that legacy hook nor its polling subscription is mounted by this page; the underlying backend is unchanged.

## Selection, layout and safety

- Each server page contains at most **20 complete seller/run groups**, with every matching shipment detail for those groups. The frontend does not slice those pages again. Counts come from backend group totals, not shipment rows or the visible page. Select-all explicitly retrieves the complete selectable set for the active search and Ready/Attention bucket, including unloaded pages; it never dispatches money. Individual selection, deselection and clear remain meaningful across pages. Changing search resets the page and selections; refreshed server bounds clamp an obsolete page.
- **Por liberar:** taller seller cards have no lateral checkbox. Actual eligible selection is shown with a subtle green surface/border and a trailing check; selected/eligible counts identify partial selections. Neutral hover never implies selection. The list scrolls with the page, not inside its own body, and renders at most20sellers per visual page. Its footer shows **Página N de M**. Clicking a seller opens the existing **Revisión por vendedor** content in a native dialog; close/Escape retain selection. The dialog owns keyboard focus containment/restoration and can scroll if its details exceed the viewport. These browser behaviors still require manual verification.
- **Necesita atención** uses the same page-scroll/20-row/page-number interaction and shared native modal shell as release, with selection controls inside the modal and explicit retry/investigation labels. **Historial** uses the same taller page-scroll/20-row/page-number list and native modal shell without selection or money actions; changing its visual page closes details. **En proceso** alone keeps bounded desktop list/inspector panels with independent content scrolling; narrow layouts stack its panels. Its existing row-range pagination is unchanged.
- Confirmation binds reviewed eligible shipment IDs, seller/Connect account and integer-cent amounts, or retry run IDs/status/authority/amounts. Relevant drift invalidates review; restoring old values cannot revive authorization. Remaining rows are checked again before each serial callback. Each callback performs a new complete server selection read, resolves even off-page sellers/runs, and compares eligibility, reviewed IDs/account and integer-cent amounts (or retry status/authority/amount) before dispatch. It never silently replaces the reviewed amount with a refreshed amount. Retained selected details are review data, not freshness evidence. Complete selections retain their reviewed details over the page that was already committed when the read began. A later page commit reconciles overlapping groups and actual financial drift invalidates review. Every page read carries an opaque identity; a committed page/query change or loading/error interval advances an authorization epoch. A dispatch validation read is rejected if that epoch changes while awaiting it, even if flags or amounts later recover. Overlapping reads are rejected rather than ordered using wall-clock timestamps or assumed server snapshot timing. Read/validation failure stops the serial batch without submitting that action.
- Page tabs, search, refresh and selection controls remain locked during complete-selection loading and throughout a batch, including gaps between requests. Request-level guards also prevent overlapping page callbacks.
- Queue errors and pending searches must not authorize stale results. The footer explicitly labels counters as the current query, not global totals: sellers in **Por liberar**, executions in the other tabs. Search filters those query-wide counts; they are not counts of only the visible page.
- **Última consulta exitosa de esta página** uses TanStack Query's successful `dataUpdatedAt` for the active search/bucket/page key, displayed in local time with a machine-readable timestamp. Before a successful read it shows **Sin consulta exitosa todavía.** A failed refresh retains the prior successful timestamp; changing query keys uses that key's own cached success or no success. The 30-second polling interval is separate: neither this timestamp nor a successful request means Stripe is synchronized. It never substitutes for payout `paid_at` or authorizes money.
- All calculations stay in integer cents. Queue totals are not Stripe balances; Connect account IDs are not bank destination details.
- The original redesign did not change financial hooks, backend APIs or money authority. The B4/B5 follow-up adds the nullable selected-run payment date to the admin SQL view/generated types and maps/sorts it only for History. Processing/attention order, release/retry callbacks, amounts and authority remain unchanged; no event timeline is added. See [deployment and verification boundaries](payments-history-deployment.md).

## Grouped-pagination deployment boundary

The frontend now sends explicit `bucket`, zero-based `page` and `scope: 'page'`
requests. Select-all and dispatch revalidation use `scope: 'selection'` for the
active search/bucket. Missing, inconsistent, truncated, wrong-bucket or
wrong-scope metadata fails closed; there is no legacy fallback in paginated mode.
The existing legacy search-only wire remains available to other callers.

Each read is a fresh snapshot, not a stable cursor under concurrent queue changes.
Complete selection intentionally loads all selectable group details and may exceed
resource/time limits; errors must not be interpreted as partial success. The UI
does not add a bulk monetary endpoint or automatic mutation retries.
See [manual deployment and read-contract checks](payments-pagination-deployment.md).
The maintainer must deploy the read Edge Function separately before using this
frontend. Repository tests do not prove remote deployment, effective privileges,
PostgreSQL behavior, browser focus, or Stripe behavior.

## Verification

```bash
bun test apps/admin-web/src
cd apps/admin-web && bun run build
```

Component tests exercise public rendered controls and mocked callbacks offline. Page/hook module mocks use isolated Bun subprocesses; page probes stub child rendering, while dedicated component tests exercise the workbenches themselves. No tests call financial endpoints. SSR/control-tree checks do not replace browser layout, keyboard focus or real DOM interaction proof.

Payment-date chronology and broader historical traceability are separately deferred in `odd/tasks/admin-payments-redesign.md` (B4/B5); the current success-only view is not an immutable audit ledger or a guarantee of irreversible bank receipt.

For visual review, run `cd apps/admin-web && bun run dev` with normal local Supabase public URL/anon configuration and an authorized admin session. Review desktop/narrow layouts, page scrolling of the seller list, green full/partial selection indicators, seller page numbers, dialog opening/closing/Escape/focus return, tabs, search/loading/empty/error states, cross-page selection and confirmation placement. Do not confirm real releases or retries merely to review the design; money-moving checks require a separately approved sandbox.

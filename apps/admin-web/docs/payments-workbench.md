# Payments operational workbench

The admin `/payments` route starts in **Por liberar**. Horizontal lifecycle tabs sit below the title in a content-sized surface, capped at the available width with horizontal scrolling on narrow screens, followed by seller search. **Por liberar**, **Necesita atención** and **Historial** use taller, full-width lists and open details in a shared native modal shell. **En proceso** retains its list/inspector panels. Release and attention share a presentation-only selection/amount/action summary; financial eligibility and dispatch stay in their feature owners. Selene colors, floating dark surfaces and Montserrat are retained. This iteration is frontend-only: existing server permissions, eligibility, amounts, idempotency and retry limits remain authoritative.

## Daily operator flow

### Release payments

1. Choose **Seleccionar todos los elegibles** for the current queried results, including other visual pages. Alternatively open a seller card and choose its eligible shipments in the detail modal; blocked shipments cannot be authorized. Opening a card never selects shipments or releases money.
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
- **Historial:** observed paid runs, strictly read-only. Click a card to open the existing seller, amount, observed-result explanation and technical references in the shared native modal; opening/closing never selects or retries anything. **Fue un reintento** is a compact badge; the parent execution ID remains under **Referencias técnicas**. A late reversal may move a run back to attention; if a refreshed query removes the focused run, its details disappear. Current query ordering is preserved: payment-date chronology is deferred until authoritative `paid_at` is exposed, not approximated from shipment or attempt dates.
- Buyer charges are deliberately removed from this payout workbench. The previous earnings view exposed shipment subtotals and shipment-derived status, not authoritative full buyer charges. Neither that legacy hook nor its polling subscription is mounted by this page; the underlying backend is unchanged.

## Selection, layout and safety

- Each visual list renders at most **20 seller/run rows per page**. Selection spans current queried pages, not unseen records in the database. Changing the search clears release selection and remounts the query-specific inspector/retry selection.
- **Por liberar:** taller seller cards have no lateral checkbox. Actual eligible selection is shown with a subtle green surface/border and a trailing check; selected/eligible counts identify partial selections. Neutral hover never implies selection. The list scrolls with the page, not inside its own body, and renders at most20sellers per visual page. Its footer shows **Página N de M**. Clicking a seller opens the existing **Revisión por vendedor** content in a native dialog; close/Escape retain selection. The dialog owns keyboard focus containment/restoration and can scroll if its details exceed the viewport. These browser behaviors still require manual verification.
- **Necesita atención** uses the same page-scroll/20-row/page-number interaction and shared native modal shell as release, with selection controls inside the modal and explicit retry/investigation labels. **Historial** uses the same taller page-scroll/20-row/page-number list and native modal shell without selection or money actions; changing its visual page closes details. **En proceso** alone keeps bounded desktop list/inspector panels with independent content scrolling; narrow layouts stack its panels. Its existing row-range pagination is unchanged.
- Confirmation binds reviewed eligible shipment IDs, seller/Connect account and integer-cent amounts, or retry run IDs/status/authority/amounts. Relevant drift invalidates review; restoring old values cannot revive authorization. Remaining rows are checked again before each serial callback.
- Page tabs, search, refresh and selection controls remain locked throughout a batch, including gaps between requests. Request-level guards also prevent overlapping page callbacks.
- Queue errors and pending searches must not authorize stale results. Counts describe the current query: seller groups in Por liberar and executions in other tabs. Refresh and the existing 30-second polling concern the payout queue only.
- All calculations stay in integer cents. Queue totals are not Stripe balances; Connect account IDs are not bank destination details.
- No financial hooks, mapper, backend API, SQL, database types, dependency versions or deployment configuration are changed.

## Deferred scope: real server pagination

The maintainer explicitly deferred this until accepting the design. **Visual pagination limits DOM/rendering work, not the initial network payload.** The current endpoint has no explicit pagination contract; its deployed result cap is not established here.

A later, separately authorized design should cover server-side seller/run grouping and page boundaries, stable ordering/cursors, complete seller detail retrieval, authoritative total counts, and what selecting all means across unloaded pages. Do not paginate raw shipment rows in a way that silently splits a seller's release batch or a payout run. No backend changes, remote SQL or deployment are authorized by this follow-up note.

## Verification

```bash
bun test apps/admin-web/src
cd apps/admin-web && bun run build
```

Component tests exercise public rendered controls and mocked callbacks offline. Page/hook module mocks use isolated Bun subprocesses; page probes stub child rendering, while dedicated component tests exercise the workbenches themselves. No tests call financial endpoints. SSR/control-tree checks do not replace browser layout, keyboard focus or real DOM interaction proof.

Payment-date chronology and broader historical traceability are separately deferred in `odd/tasks/admin-payments-redesign.md` (B4/B5); the current success-only view is not an immutable audit ledger or a guarantee of irreversible bank receipt.

For visual review, run `cd apps/admin-web && bun run dev` with normal local Supabase public URL/anon configuration and an authorized admin session. Review desktop/narrow layouts, page scrolling of the seller list, green full/partial selection indicators, seller page numbers, dialog opening/closing/Escape/focus return, tabs, search/loading/empty/error states, cross-page selection and confirmation placement. Do not confirm real releases or retries merely to review the design; money-moving checks require a separately approved sandbox.

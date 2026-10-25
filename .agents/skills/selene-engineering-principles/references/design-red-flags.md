# Design red flags

Screen a sketch (types, signatures, caller usage) against this list before implementing. A flag is a prompt to reconsider, not an automatic rejection.

- **Shallow module**: the interface is nearly as complex as the implementation. Callers learn as much as the module hides.
- **Information leakage**: wire or storage types (Stripe objects, Envia responses, raw table rows) re-exported or passed across module boundaries. Map them to domain types at the edge.
- **Temporal decomposition**: modules split by execution order (load, validate, save) instead of by knowledge. Split by what each module knows.
- **Pass-through method**: a function that only forwards its arguments to another with the same shape. Remove it or give it a real job.
- **Split ownership**: more than one writer of the same state. Ledger and shipment state must have one owner; every other path asks it.
- **Two ways to do one task**: two helpers or flows that achieve the same result. Pick one and migrate callers.
- **Importable internals**: callers can reach helpers that should be private to the module. Narrow the exports.
- **Hand-synced list**: two lists that must agree and are kept equal by hand. Keep one source, or make the build fail when they disagree. The i18n locale parity tests are the repo's model.

Not a red flag: `supabase/migrations` (deployable deltas) and `supabase/queries` (canonical current SQL) are an intentional repo convention. Keep both in sync per AGENTS.md.

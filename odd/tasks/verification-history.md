# Verification history

Roadmap #644 item 9, issue #651, only the half that does not touch money. Branch `feat/verification-history` from `origin/main` 71070e39, worktree verification-history.
Keeps every verification submission and decision of a listing instead of overwriting `products` columns. Splitting `product_status` into three states waits for #646 (L1, L2).

## Specs

- S1. "one verification record per attempt (reviewer, decision, what was checked, public and private notes) with its evidence rows" (#651). Table `product_verifications`: one row per submission with `product_id`, `submitted_by`, `submitted_at`, `benchmark_score`, and the decision fields `decision` (enum `approved`, `rejected`; null while open), `decided_by`, `decided_at`, `public_note` and `private_note_id` (FK to `admin_user_notes`, which keeps the note). A CHECK requires the three decision fields together, and a rejection requires `public_note`. A partial unique index allows one open attempt per product. "What was checked" waits for the admin-web audit (#578): no admin-web screen records a checklist today (L2).
- S2. Table `product_verification_evidence`: one row per proof with `verification_id`, `kind` (enum `physical`, `performance`) and `storage_path`. A proof the seller did not change is a new row with the same path; storage objects are never overwritten (`verification-proof-upload.ts`).
- S3. Only the server records a submission. `fn_submit_product_verification` (SECURITY DEFINER, `authenticated` only) checks that the caller owns the product, that the product is in `pending_verification` or `rejected`, that no attempt is open, that a physical proof is present, and that every path is in the product folder of bucket `verification` and exists. It then inserts the attempt and its evidence and sets the product to `in_review`. The owner can no longer set `in_review` with a plain `UPDATE` (L2).
- S4. "the admin lock on the verification record" (#651): `locked_by` and `locked_at` live on the open attempt. `fn_lock_product`, `fn_unlock_product` and `fn_resolve_product_verdict` keep their signatures and results (L2).
- S5. `fn_resolve_product_verdict` closes the open attempt with the decision, the reviewer and the notes, sets the product status, and keeps its audit log (with `verification_id`) and seller notification.
- S6. "`category` as a foreign key" (#651): `products.category` references `category_configurations(category_name)` with `ON UPDATE CASCADE ON DELETE RESTRICT`. The value stays the category name (L2).
- S7. "Done when every submission and decision is kept" (#651): `products` loses `verification_data`, `rejection_reason`, `verified_at`, `locked_by` and `locked_at`. No backfill. Remote products already in `in_review` stay as they are (L2).
- S8. The app reads the latest attempt (rejection reason, previous proofs) and submits through S3. Admin-web keeps its screens and behavior and reads the new records, with a Playwright spec for the verification screen (L2).
- S9. Retention class for #450: both tables are kept forever as verification evidence. At the design target (100k listings) they grow by a few rows per listing and submission.

## Tasks

- [ ] T1 docs: this document, `reports-data-model.md` L10.
- [ ] T2 (S6) SQL: `category` foreign key, migration, pgTAP, types. Own commit.
- [ ] T3 (S1-S5, S9) SQL: enums, both tables, RLS and grants, submit RPC, lock and verdict on the attempt, `admin_product_queue_view`, seed, pgTAP, types. Own commit.
- [ ] T4 (S3-S5) Bruno requests for the submit RPC, the lock and the queue view.
- [ ] T5 (S8) app: verification screen reads the latest attempt and submits through the RPC; publish and preview drop the old columns.
- [ ] T6 (S8) admin-web: queue, detail and product management read the new records; Playwright spec.
- [ ] T7 (S3, S7) SQL: drop the five `products` columns and the owner's `in_review` update path, migration, pgTAP, types. Own commit.
- [ ] T8 independent verify, docs, PR closes #651.

## Log

- L1 (2026-11-25, maintainer): "Sigamos con el roadmap #644 (modelo de datos para la meta de diseño), ítem 9 (#651), pero solo la parte que no toca dinero: historial de verificación de cada anuncio. [...] Alcance: #651 mezcla dos cosas. El historial de verificación (un registro por intento con sus evidencias, el lock del admin en ese registro, `category` como FK) no toca dinero. Separar `product_status` en tres estados SÍ lo toca: `reserved`, `sold` e `in_dispute` los escriben `fn_reserve_products`, `fn_create_shipments_from_single_payment` y `fn_set_product_in_dispute`. Esa mitad espera a #646. [...] Admin-web: no lo quiero tocar por ahora; otra sesión lo va a auditar y decidir qué entra en la v1. Si el cambio obliga a tocar las pantallas de verificación de admin-web, decímelo en la propuesta y lo decidimos. [...] Las filas existentes son datos de prueba: sin backfills."
- L2 (2026-11-25): Agent proposal. The seller submits with a plain `UPDATE products` (`use-verification-logic.ts`) that sets `in_review`, writes `verification_data` and clears `rejection_reason`, and `products_update_owner_or_admin` allows it, so a history the client writes proves nothing: submission moves to a server RPC. Admin-web has no checklist, so "what was checked" waits for #578. The private note stays in `admin_user_notes` and the attempt points at it. `category` keeps the name as key: the four remote values already match and `generate-shipping-label`, search and the types use the string. Moving the lock forces admin-web changes (`use-pending-products.ts`, `verification-detail.tsx`, `use-admin-product.ts`, `product-management-screen.tsx`, a test fixture). `admin_product_queue_view` is unused and filters `pending_verification`; it is rewritten over open attempts. Remote: 159 products, 17 in verification, 137 with `verification_data`, 6 locked. Maintainer answers: admin-web "Adaptarlo al mínimo en este PR (recomendado)"; remote `in_review` products "Dejarlos como están"; the rest "Aprobado".

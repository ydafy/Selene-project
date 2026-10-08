# Feature: Seller package screen (`prepare/[id]`)

**Change type:** UI/UX redesign of one screen + its copy contract.
**Target:** `apps/frontend/app/profile/orders/prepare/[id].tsx`
**Status:** round 2 applied (uncommitted). The *Screen layout* section below is superseded by
**Round 2 — applied**; T6–T10 remain deferred.
**Scope boundary:** this screen only. No buyer-side flow, no disputes module, no report/return screens, no insurance fund, no state-machine changes.

## Goal

The seller opens this screen to prepare a package and generate the shipping label. It must
teach, in one screen and with minimal scrolling, **how to pack** and **what to prove**, and
then gate label generation on that proof.

Design rule agreed with the maintainer: **everything visible, nothing explained twice, detail
one tap away.** No stepper (the screen is single-purpose; a stepper spends a row orienting the
user in a process where they control only one step). The orientation value it provided is
replaced by a one-line context header plus a "what happens next" line under the button.

## Decisions already settled (do not re-litigate)

1. **The gate stays before label generation.** Verified in code: after the label exists the
   seller has no platform action left (`'shipped'` is set by carrier tracking, not by the
   seller). So all required evidence must be captured pre-label; this adds **no new states**.
2. **Photos stay.** Their honest purpose is (a) input for a carrier claim and (b) a
   pre-shipment condition record. They must never be presented as insurance coverage.
3. **Evidence set = 3 slots, non-redundant** (see the slots table below). Rejected the
   "3 box angles" set: angles prove the same fact three times and skip the two facts that
   matter. The interior photo is not there to prove content — it is there to prove the
   **packaging was adequate**, which is the exclusion that voids a carrier claim.
4. **No editable package data.** Dimensions/weight come from the product's packaging preset.
   The screen shows the recommendation plus a warning that a much larger box can attract
   carrier surcharges. Do not add editable dimension/weight inputs.
5. **No video in v1.0.** Supabase Free allows 1 GB of file storage; a ~15 MB seller video per
   order caps out at roughly 66 orders. The buyer's unboxing video is unaffected (it is
   uploaded only on a dispute, so its volume is low). The evidence block must be structured so
   a video slot can be added later without redesign.
6. **No insurance copy.** Never promise coverage, reimbursement, or a "seguro".
7. **v1.0 ships used goods only**, so the original retail box is never required: a rigid
   cardboard box + bubble wrap/foam + no movement + arrows is compliant.

## Content contract (from primary sources)

Packaging requirements shown on screen come from carrier/provider documents, not invention:

- Paquetexpress, *Política de aceptación de mercancía*, "Línea blanca / Equipos e instrumentos":
  used goods require a cardboard box with polybubble or foam inside, plus up arrows.
- Envia, *Guía de embalaje* / *Packaging sealing*: pick a sturdy box with no empty space, pad
  the contents, fill the gaps, and seal with the "H" method (centre joint + both edges) using
  polypropylene/PVC tape at least 5 cm wide.
- Inadequate packaging excludes coverage (Paquetexpress cláusula SEXTA; Envia T&C 3.7.5).
  The in-screen consequence line reflects exactly that.
- Supplementary guidance (guide modal only): keep the outer box opaque and free of brand/model
  markings, because a stolen parcel is a total loss.

## Tasks

### T1 — i18n contract (en + es, parity enforced)
Add the new `prepare.*` keys to `core/i18n/locales/en/orders.json` and
`core/i18n/locales/es/orders.json`, **including the currently missing `prepare.securityReason`**
(used today by the biometric prompt and absent from both locales — a live bug).
English is the key/source language; Spanish is the user-facing copy and must follow the
existing locale convention: neutral Mexican Spanish, second person "tú".
Leave the obsolete evidence keys (`evidenceTitle`, `evidenceSubtitle`, `photoHardware`,
`photoProtection`, `photoSealed`, `requirements.*`) in place — removing them is T10.

New keys:

- `contextLine` — one-line orientation, takes the order reference.
- `yourPackage`, `shipsTo`, `boxRecommendation`, `boxSurchargeWarning`.
- `packTitle`, `packBox`, `packPadding`, `packNoMovement`, `packSealing`, `packConsequence`,
  `packFullGuide`.
- `guideTitle`, `guideSteps` (ordered list), `guideAntiTheft`.
- `evidenceTitle` (repointed to the packaging-proof wording), `whyLabel`, `whyTitle`,
  `whyBullet1`, `whyBullet2`, `whyBullet3`, `whyClose`.
- `slotProduct`, `slotBox`, `slotSealing`.
- `progressMissingPhotos`, `progressMissingOrigin`, `progressNotReady`, `progressReady`.
- `costNote`, `nextSteps`.
- `connectTitle`, `connectBody`, `connectCta` (replaces the hardcoded Spanish Stripe block).
- `securityReason` (currently missing in both locales).

Reused unchanged: `headerTitle`, `originLabel`, `originPlaceholder`, `summaryTitle`,
`totalSale`, `disclaimer`, `confirmBtn`, `successTitle`, `successMsg`.

### T2 — `PackagingGuideCard` component
New reusable component rendering the "pack it like this" block: four requirement rows
(icon + label), one consequence line, and a "full guide" affordance opening a modal with the
extended guide. Uses only Restyle tokens and existing UI primitives.

### T3 — `LabelWithHelp`: optional `confirmLabel`
The shared component hardcodes `confirmLabel="Entendido"`, so its modal button cannot be
translated. Add an optional `confirmLabel?: string` prop that defaults to today's behaviour.
Additive and backward compatible — `LabelWithHelp` is used elsewhere.

### T4 — Screen rewrite
Restructure `prepare/[id].tsx` to the agreed layout (see below), move every string to i18n
(including the currently hardcoded Spanish Stripe Connect block), pass `slotsConfig` to
`EvidenceUploadSection`, add the progress line and the "what happens next" line, and remove
the three leftover `[DEBUG ...]` `console.log` calls that dump order and shipment payloads.

### T5 — Verification
Focused i18n parity test, lint, and typecheck on the touched surface. Report commands and
observed output.

### Deferred (explicitly out of the template)

- **T6** Server-side enforcement of the evidence rule in `generate-shipping-label`
  (minimum count, ownership of the storage folder, duplicate rejection). Today the rule is
  client-only and trivially bypassed. Separate work unit.
- **T7** Gallery fallback in `EvidenceUploadSection` (opt-in prop; `pickImage` already exists
  in `useImageUpload`). Deferred because that component is shared with `report` and `return`.
- **T8** Show the real preset dimensions/weight (needs data plumbing) and replace the generic
  declared content `"Hardware: <orderId8>"` with the real product description server-side.
- **T9** Optional seller video slot, gated on a product-value threshold and on storage budget.
- **T10** Remove the obsolete `prepare` evidence keys once verified unused by grep.

## Screen layout (agreed)

```
1. GlobalHeader + ScreenHeader   →  title + one-line context ("Order #X · not shipped yet")
2. Shipment selector             →  only when the seller owns more than one shipment
3. Card "Your package"           →  product, destination, origin (AddressSection), box note
4. PackagingGuideCard            →  4 requirements + consequence + full guide
5. Evidence block                →  "Packaging proof" + LabelWithHelp ("why?")
                                    + 3 labelled slots via slotsConfig
6. Earnings summary              →  kept, compact
7. Error box / Stripe gate       →  kept, translated
8. Progress line + primary button + "what happens next" line
```

Evidence slots:

| # | Label (en / es) | Icon intent | What it proves |
| - | --------------- | ----------- | -------------- |
| 1 | Product and packaging / Producto y empaque | open package | The padding was adequate |
| 2 | Closed box / Caja cerrada | closed package | It left whole, arrows visible |
| 3 | Sealing / Sellado | tape/close-up | How the "H" seal was applied |

The "why" modal content, in three bullets, honest:
1. If the buyer claims something else arrived, these are your backup.
2. They are what lets us claim against the carrier.
3. They do **not** prove the contents — the buyer's unboxing video does.

Progress line states: missing photos (`{{count}}` left), missing origin, shipment not ready,
all set. The primary button is disabled until every condition holds, and the disabled reason is
always visible — never a dead button with no explanation.

## Evidence

| Task | Evidence |
| ---- | -------- |
| T1–T4 | Files: `prepare/[id].tsx` (+291/-… rewrite), `en/orders.json`, `es/orders.json`, new `PackagingGuideCard.tsx`, `LabelWithHelp.tsx` (+5, additive prop). Both debug `console.log` dumps removed. No commit (repository policy forbids committing unrequested; working tree also carries unrelated uncommitted work). |
| T5 | `bun test tests/orders/__tests__/i18nOrdersParity.test.ts` → 3 pass, 0 fail, 57 expect() calls. `bunx eslint` on the three touched component/screen paths → exit 0, clean. `bunx tsc --noEmit -p tsconfig.json` → 51 errors, all in unrelated pre-existing files, none in the touched paths (baseline from existing uncommitted work, not fixed). |

## Round 2 — applied

Maintainer review feedback, implemented on top of T1–T5:

1. **"Your box" card** rebuilt: product caption + name, then the packing preset the seller chose
   (`useSystemConfig` → `package_presets` looked up by `product.package_preset`, already in the order
   payload — no new query), then the warning about oversized/different boxes and extra charges. The
   destination row and the origin picker were removed from this card.
2. **New "Your shipping address" section** with `originLabel` repointed to "De dónde envías".
3. **`PackagingGuideCard` became an accordion**: six rows, all titles always visible, exactly one
   expanded (row 1 by default), one 16:9 image per expanded step, and row 6 = "¿Dónde consigo el
   material?" with the material list and a swappable marketplace search link. The "full guide" modal
   was removed: instructions must be explicit on screen, never behind a button.
4. **Evidence block wrapped in a card** (the floating-card pattern was broken) and each slot now opens
   a `ConfirmDialog` with its own example image and description before the camera, on **every** tap.
   `EvidenceUploadSection` gained only optional props, so `report` and `return` are unaffected.
5. **One status card above the button** replaces the loose texts: missing-photo count while incomplete,
   and the cost/irreversibility warning exactly when the button becomes enabled. The earnings summary
   card was deleted (it showed the sale total mislabelled as earnings, and the seller is not charged
   on this screen).

### Round 2b — illustration sizing and renderer fix

The maintainer reported the illustrations rendered far too large, with dead space above and below.
Root cause: both places rendered React Native's core `Image` with `width: '100%'` and **no height**, so
the image inherited its intrinsic height at the full card width.

Fixed by giving every illustration a bounded stage instead of a stretch:

- Accordion: full-width stage of **120 pt** tall, centred; image at `height: '100%'` + `aspectRatio: 5/3`
  ⇒ a centred **200 × 120 pt** illustration, then the centred hint below it.
- Evidence dialog: the same treatment at **110 pt** tall ⇒ ~163 × 110 pt. `resizeMode="cover"` was
  replaced because it crops a transparent source.
- Bonus fix: the "where do I get the materials" row rendered an empty wrapper with a bottom margin,
  leaving a dead gap; the wrapper is now rendered only when there is an image or a hint.

**Renderer constraint discovered:** React Native's core `Image` cannot be relied on for WebP (Android
requires extra Fresco modules; iOS core does not decode it). Both illustrations now render through the
repo's existing `AppImage` (`expo-image`), which decodes WebP on both platforms. This also means that
when the real `.webp` files land, the `require()` paths must change from `.png` to `.webp`.

**Regression caught in review:** the same edit that added the image/hint guard **replaced** the
accordion's own `expanded === row.index` guard instead of combining with it, so every row with an
illustration rendered permanently — all rows looked open and taps appeared to do nothing. The two
conditions must stay combined: `expanded === row.index && (row.image || row.hint)`. Lesson for this
file: when adding a condition to a block that is already conditionally rendered, combine it, never
substitute it.

### Assets

`apps/frontend/assets/images/packaging/` holds eight **placeholder** PNGs plus a `README.md`
documenting names, aspect ratios and size budget. Replacing an image means overwriting the file —
no code change. Five are 16:9 packing steps (screenshot from the Envia guide); three are 1:1
`evidencia-*.png` for the slot dialogs, which must be our own photos.

### Round 2 evidence

- `bun test tests/orders/__tests__/i18nOrdersParity.test.ts` → 3 pass, 0 fail; `en` and `es` each
  expose 55 `prepare` keys with zero asymmetry.
- `bunx eslint` over the four touched code files → exit 0, clean (static `require()` carries the repo's
  existing per-line disable comment, as in `BenchmarkGuideModal`).
- `bunx tsc --noEmit -p tsconfig.json` → 51 errors, identical to the round-1 pre-existing baseline,
  none referencing the touched files.
- Spanish copy normalized to the locale's **tú** register (the voseo strings were the author's error,
  caught in review) and the dormant `prepare.statusReady` key removed from both locales.

## Open items after round 2

- **Replace the eight placeholder images** with the real artwork; the layout is already correct for the
  final assets.
- **`prepare/[id].tsx` is 568 lines**, above the ~400 readability target. Splitting it needs a new file,
  which was outside the delegated surfaces; decide whether to allow one.
- The preset card was implemented against the live `system_settings` shape but **has not been seen with
  real data** — verify on device that the label, dimensions and weight render as expected for a real
  product, including the `boxUnavailable` fallback path.
- The three `evidencia-*.png` dialogs need a real photo set before they are meaningful.

## Final review

Independent review of the round-2 screen, fixes applied (uncommitted, per repository policy):

1. **F1** Added the missing `errors.title` key to `en/common.json` and `es/common.json`
   (wording matches `states.errorTitle` per locale), so `ErrorState` no longer renders the
   raw key `errors.title`.
2. **F2** The status card above the primary button now renders in **all four** states, in
   priority order: photos missing (`statusMissingPhotos`, info), origin missing (new
   `statusMissingOrigin`, info), shipment not `paid` (new `statusNotReady`, info), all met
   (`generateWarning`, warning). Both new keys added to `en` and `es`. Gate conditions and
   the button's `disabled` expression are unchanged — no dead button without explanation.
3. **F3** Evidence slot 2/3 copy reconciled across locales: en `slotBox` "Closed box" /
   `slotSealing` "Whole box"; es `slotBox` "Caja cerrada" / `slotSealing` "Caja completa".
   `slotBoxDesc` (es) recovered the "up arrows visible" fact; `slotSealingDesc` now describes
   the whole box from another angle with the tape visible in both locales. Renamed
   `evidencia-3-sellado.webp` → `evidencia-3-caja-completa.webp` and updated its `require()`.
4. **F4** Accessibility: evidence slot `TouchableOpacity` exposes `accessibilityRole="button"`,
   a label combining the slot label with its photo state, and
   `accessibilityState={{ selected }}`; accordion rows expose `accessibilityRole="button"` and
   `accessibilityState={{ expanded }}`, with `minHeight: 44` on the inner row container.
5. **F5** Removed the dead `prepare.*` keys (`subtitle`, `packagingGuidance`,
   `evidenceSubtitle`, `photoHardware`, `photoProtection`, `photoSealed`, `uploading`,
   `errorUpload`, and the whole `requirements.*` subtree) from both locales after a
   repository-wide grep confirmed zero code references. `evidenceSubtitle` mattered most:
   its text promised claim protection, which this product must never promise.
6. **F6** Deleted the four unreferenced placeholder PNGs (`paso-5-etiqueta.png`,
   `evidencia-1-producto.png`, `evidencia-2-caja.png`, `evidencia-3-sellado.png`); all
   `.webp` files kept. `assets/images/packaging/README.md` rewritten to match reality:
   `.webp` files only, slot 3 is `evidencia-3-caja-completa.webp`, canvas 600 × 360 (5:3),
   delivered sizes 18–53 KB.
7. **F7** `tests/orders/__tests__/i18nOrdersParity.test.ts` now asserts the `prepare` block
   has an identical (recursive) key set in `en` and `es` — this would have caught the F3
   divergence automatically.

### Outstanding issues surfaced by this review (need maintainer decisions / deferred work)

- The evidence dialog illustration stage is **180 pt** in code
  (`EvidenceUploadSection.tsx`), while this contract (Round 2b) and the asset README
  specify **110 pt**. Needs a maintainer decision: change the code or the contract.
- `components/ui/LabelWithHelp.tsx` keeps a sub-44 pt help icon touch target; the file was
  outside this task's allowed edit surfaces, so it was left untouched.
- T6 (server-side evidence enforcement in `generate-shipping-label`), T7 (gallery fallback)
  and the `EVIDENCE_MIN_PHOTOS` reduction to two photos remain open.

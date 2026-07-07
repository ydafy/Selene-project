# Dashboard Bug Fixes Specification

## Purpose

Fix 4 known bugs in the Selene admin dashboard: broken images from raw `<img>` with storage paths, infinite skeleton spinners on media error states, "No data" flash when data is undefined, and stale form state in InputModal on reopen.

## Requirements

### Requirement: Secure Media Error Handling

SecureImage and SecureVideo components MUST show an inline fallback instead of an infinite skeleton when signed URL generation fails, the media element errors, or the path is empty.

| Rule | Behavior |
|------|----------|
| Empty path | Set error state, render fallback |
| `createSignedUrl` returns no data | Set error state, render fallback |
| `<img>` / `<video>` fires `onError` | Set error state, render fallback |
| Valid URL resolved | Render media normally |
| Error state | Sticky per mount; no auto-retry |

#### Scenario: Empty path renders fallback

- GIVEN a `SecureImage` or `SecureVideo` with an empty `path` prop
- WHEN the component mounts
- THEN it renders an inline fallback (not a skeleton)

#### Scenario: Signed URL failure renders fallback

- GIVEN a valid `path` prop
- WHEN `createSignedUrl` returns no data or an error
- THEN the component renders an inline fallback (not a skeleton)

#### Scenario: Media element error renders fallback

- GIVEN a valid signed URL was obtained
- WHEN the `<img>` or `<video>` element fires an `onError` event
- THEN the component renders an inline fallback (not a skeleton)

#### Scenario: Valid URL renders media normally

- GIVEN a valid `path` prop
- WHEN `createSignedUrl` returns a valid signed URL
- THEN the component renders the image or video normally

#### Scenario: Error state is sticky

- GIVEN the component has entered an error state
- WHEN the component remains mounted
- THEN it does NOT retry the signed URL request automatically

### Requirement: SecureImage Usage in Dashboard Tables

All product image thumbnails in InventoryTable, PurchasesTable, and EvidenceViewer MUST use the `SecureImage` component instead of raw `<img>` tags with storage paths.

| Rule | Behavior |
|------|----------|
| Image source | Use `SecureImage` with `path` prop, not raw `<img src>` |
| Undefined image | Pass `?? ''` to prevent undefined path |
| Bucket | Default `verification` bucket (no explicit prop needed) |
| Styling | Preserve existing `className` dimensions |

#### Scenario: InventoryTable thumbnails render via signed URL

- GIVEN a product with an image path in `images?.[0]`
- WHEN InventoryTable renders the product row
- THEN the thumbnail uses `SecureImage` with `path={images?.[0] ?? ''}`

#### Scenario: PurchasesTable thumbnails render via signed URL

- GIVEN a purchase with a product image path in `product?.images?.[0]`
- WHEN PurchasesTable renders the purchase row
- THEN the thumbnail uses `SecureImage` with `path={product?.images?.[0] ?? ''}`

#### Scenario: EvidenceViewer gallery images render via signed URL

- GIVEN evidence images in the gallery array
- WHEN EvidenceViewer renders the gallery
- THEN each image uses `SecureImage` with the raw path

#### Scenario: EvidenceViewer zoom behavior preserved

- GIVEN a gallery image in EvidenceViewer
- WHEN the user clicks the zoom button
- THEN `onImageClick` is called with the raw image path (original behavior)

### Requirement: DataTable Loading Guard

DataTable MUST treat `undefined` data as a loading state, rendering skeleton rows instead of the "No data" empty message.

| Rule | Behavior |
|------|----------|
| `data === undefined` | Render skeleton rows |
| `isLoading === true` | Render skeleton rows |
| `data === []` (empty array) | Render "No data" message |
| `data` has items | Render table rows |

#### Scenario: Undefined data shows skeleton

- GIVEN `data` prop is `undefined` and `isLoading` is not passed
- WHEN DataTable renders
- THEN it displays skeleton rows (not "No data")

#### Scenario: Empty array shows no data message

- GIVEN `data` prop is an empty array `[]`
- WHEN DataTable renders
- THEN it displays the "No data" empty message

#### Scenario: Populated data shows rows

- GIVEN `data` prop contains one or more items
- WHEN DataTable renders
- THEN it displays the table rows with data

#### Scenario: isLoading flag shows skeleton

- GIVEN `isLoading` prop is `true`
- WHEN DataTable renders
- THEN it displays skeleton rows

### Requirement: InputModal Value Reset on Close

InputModal MUST reset its form `value` to empty string whenever the modal closes, regardless of the close mechanism.

| Rule | Behavior |
|------|----------|
| `isOpen` becomes `false` | Reset `value` to `''` |
| Cancel button clicked | Modal closes, value resets |
| Confirm button clicked | `onConfirm` fires, value resets |
| Reopen after close | Value starts empty |

#### Scenario: Cancel resets value

- GIVEN the modal is open with text entered in the input
- WHEN the user clicks "Cancelar"
- THEN the modal closes and `value` resets to `''`

#### Scenario: Reopen shows empty value

- GIVEN the modal was previously closed with stale text
- WHEN the modal is reopened
- THEN the input field is empty

#### Scenario: Confirm resets value

- GIVEN the modal is open with text entered
- WHEN the user clicks "Confirmar"
- THEN `onConfirm` fires and `value` resets to `''`

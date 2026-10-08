# Packaging images

Real delivered artwork for the "pack it like this" accordion and the evidence slot
intro dialogs. All files are WebP and render through the repo's `AppImage`
(`expo-image`), which decodes WebP on both platforms — React Native's core `Image`
does not decode it on iOS and needs extra Fresco modules on Android.

## Asset contract

- Every file is authored on the **same canvas: 600 × 360 px (5:3)**, which is 3×
  the rendered accordion illustration (200 × 120 pt). One canvas means the layout code
  never branches per image.
- Illustrations are centred inside the canvas so `contentFit="contain"` never clips
  an edge or crops a transparent region.
- Image content carries **no baked-in text**: all labels and instructions are rendered
  by the app so they stay translatable.

| File | Used by | Aspect ratio | Canvas | Size |
| ---- | ------- | ------------ | ------ | ---- |
| `paso-1-caja.webp` | Packing accordion, step 1 (choose the box) | 5:3 | 600 × 360 | 18 KB |
| `paso-2-proteccion.webp` | Step 2 (protect the product) | 5:3 | 600 × 360 | 22 KB |
| `paso-3-relleno.webp` | Step 3 (fill the gaps) | 5:3 | 600 × 360 | 23 KB |
| `paso-4-sellado.webp` | Step 4 (seal the box — the "H" taping graphic) | 5:3 | 600 × 360 | 23 KB |
| `paso-5-etiqueta.webp` | Step 5 (attach the label on top) | 5:3 | 600 × 360 | 23 KB |
| `evidencia-1-producto.webp` | Evidence slot 1 intro dialog | 5:3 | 600 × 360 | 52 KB |
| `evidencia-2-caja.webp` | Evidence slot 2 intro dialog | 5:3 | 600 × 360 | 40 KB |
| `evidencia-3-caja-completa.webp` | Evidence slot 3 intro dialog | 5:3 | 600 × 360 | 40 KB |

The three `evidencia-*` files are our own photos of a real box: the product inside with
its padding (slot 1), the closed box (slot 2), and the same box from another angle with
the tape visible (slot 3). They match the per-slot dialog copy in
`core/i18n/locales/*/orders.json` (`slotProduct*`, `slotBox*`, `slotSealing*`).

## Rules

- Keep the file names and extensions exactly as listed; the app references them statically.
- Keep the canvas and ratio: the containers are fixed, so a different ratio gets
  letterboxed by `contain`.
- Target **under 60 KB** per image. These are bundled with the app, so every KB ships to
  every user.
- After replacing a file, run the app and confirm each image reads clearly on a phone
  screen at the rendered size (the accordion illustration renders at 200 × 120 pt).

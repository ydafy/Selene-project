# DESIGN.md

How Selene should look and feel, for anyone (human or agent) building UI in `apps/frontend` (Expo app) or `apps/admin-web` (admin dashboard). Read it before UI work. Token values live in code; this file explains intent. When a value here disagrees with code, the code wins and this file gets fixed.

- App tokens: `apps/frontend/core/theme/index.ts` (Restyle, React Native Paper, navigation themes).
- Admin tokens: `apps/admin-web/src/index.css` (Tailwind v4 `@theme`).

## Product and people

Selene is a peer-to-peer marketplace in Mexico for used PC hardware. Its product is trust: every listing is technically verified, and the buyer's money is held until the shipment is completed. The UI has to make that trust visible.

- **Buyers** fear paying for broken or fake hardware. Show verification status, protected payment ("Seguro Selene"), and order state before anything else.
- **Sellers** need to know what to do next and when they get paid.
- **Admin users** are the Selene partners. They are not technical and judge the dashboard by whether they understand it at first sight. Design every admin screen for them.

## Personality

The maintainer's words: "minimalista, tech-futurista, elegante-premium".

- **Minimalist:** few elements, generous space, one clear action per area. Remove before adding.
- **Tech-futuristic:** precise and engineered. Dark layered surfaces, exact alignment, tabular numbers, crisp hairline borders. Futuristic through precision, not through effects.
- **Elegant-premium:** the gold accent is rare and deliberate; typography and spacing carry the quality.

## Never

Selene must never look like:

- **A generic marketplace:** banners everywhere, crowded grids, every element shouting for attention.
- **A crypto app:** neon, glowing charts, speculative "number goes up" energy.
- **An RGB gamer store:** rainbow lights, aggressive display fonts, stacked effects.
- **A generic AI template:** decorative soft gradients, rows of identical icon cards, icons in tinted squares, a label above every heading, invented vanity metrics.

## Principles

1. **Trust first.** Verification, protected payment, and money amounts are the most legible things on their screens. Never hide them behind a tap.
2. **One accent.** `lion` gold (`#bd9f65`) marks the primary action, selection, and key figures. If gold appears in many places on one screen, none of them stands out.
3. **Layered dark.** `night` background, `state-gray` cards, hairline separators. Depth comes from surface steps and borders, not heavy shadows.
4. **Status speaks in words and color.** Order and shipment states always pair the status color with its label; never color alone.
5. **Quiet motion.** Short fades and small translations that explain a change. Respect reduced motion (the admin already does in `index.css`).
6. **Plain language.** Copy says what happened and what to do next, through i18n in Spanish and English. Technical references (ids, Stripe objects) are secondary and copyable, never the headline.
7. **Gradients only as scrims.** A gradient may fade content into the background (the existing app usage). Never as decoration.

## Shared foundation

Both apps use the same palette and typeface. Names differ by platform.

| Role               | Value     | App (Restyle)                   | Admin (Tailwind)  |
| ------------------ | --------- | ------------------------------- | ----------------- |
| Background         | `#121212` | `background` (`night`)          | `night`           |
| Card / surface     | `#1e1e1e` | `cardBackground` (`stateGray`)  | `state-gray`      |
| Primary text       | `#e4e4e4` | `textPrimary` (`platinum`)      | `platinum`        |
| Secondary text     | `#6f839f` | `textSecondary` (`blueLight`)   | `blue-light`      |
| Accent             | `#bd9f65` | `primary` (`lion`)              | `lion`            |
| Success            | `#28a745` | `success` (`forest`)            | `forest`          |
| Error              | `#dc3545` | `error` (`fire`)                | `fire`            |
| Warning            | `#f59e0b` | `warning` (`amber`)             | (none)            |
| Error panel        | `#dc35451a` | `errorSubtle` (`fireSubtle`)  | (none)            |

- `warning` is for caution icons, borders, and status dots. `errorSubtle` is the background of an error panel, always with an `error` border or text.
- App only: `shadow` (`#000000`) for `shadowColor`, `mediaBackground` (`#000000`) behind full-screen photos and video.
- App only, translucent: `surfaceSubtle` (white 3%) for inactive cards and chips; `primarySubtle` (gold 15%) for a selected fill with a `primary` border; `glassSurface` (card gray 30%) under a `BlurView`; `scrimLight`, `scrim`, `scrimStrong` (black 20%, 60%, 70%) for overlays on photos; `backdrop` (black 40%) behind menus and modals; `backgroundFade` (background 80%) to end a fade-out gradient; `skeleton` and `skeletonShimmer` for loading placeholders. Borders use `separator` (white 10%).

Order and shipment states, identical in both apps:

| State     | Value     | State     | Value     |
| --------- | --------- | --------- | --------- |
| pending   | `#a9924c` | completed | `#319b5b` |
| paid      | `#5c85ad` | cancelled | `#6a3939` |
| preparing | `#7866a3` | refunded  | `#6a4d39` |
| shipped   | `#336084` | dispute   | `#782b2b` |
| delivered | `#478560` |           |           |

- `cancelled`, `refunded`, and `dispute` are too dark for small text on a dark background (about 2:1). In app status badges their color goes on the border, side bar, and dot, and the label uses `textPrimary` (`getOrderStatusTextColor` in `apps/frontend/core/utils/order-status.ts`).
- **Type:** Montserrat only (Regular, Medium, Bold; Italic is loaded). Medium for headings, Regular for body. Use tabular figures for money and counts.
- **Theme:** dark only. There is no light mode; do not add one without a product decision.
- **Spacing (app):** `xs 4`, `s 8`, `m 16`, `l 24`, `xl 40`. **Radii (app):** `s 8`, `m 16`, `l 24`, `xl 40`, `full`. React Native Paper `roundness` is `s`; Paper multiplies it per component (Dialog x7, Chip x2), so set an explicit radius when a Paper component needs an exact one.

## Mobile app (`apps/frontend`)

- Use Restyle tokens and `textVariants` (`header-2xl` once per screen, `subheader-*` for sections, `body-*`, `caption-*` for secondary text). No hardcoded colors or font sizes in components. Tokens live in `core/theme/tokens.ts`; outside a component that has `useTheme`, import `colors` from there. `core/theme/__tests__/noHardcodedColors.test.ts` fails on hex and `rgb`/`rgba`/`hsl` literals outside the theme; the only exceptions are third-party brand colors (logos in `components/icons/`, Stripe, 3DMark).
- Follow native conventions (load the `expo-native-ui` skill); tokens and component variants follow `expo-design-system` within this file's palette.
- Icons: `@expo/vector-icons`, one family per screen.
- Blur (`blurBackground`) is for overlays on top of content, not for cards.

## Admin dashboard (`apps/admin-web`)

Clarity and the same premium identity count equally. The partners must understand a screen without explanation, and it must feel like the same product as the app.

- **Surfaces:** `bg-night` page, `bg-state-gray` panels, borders `border-white/5` to `border-white/10`. Radii: `rounded-xl` / `rounded-2xl` for panels and cards, `rounded-full` for pills.
- **Accent:** `text-lion` for key figures and active states, `bg-lion` only for the main action, `bg-lion/10` + `border-lion/20` for selected or highlighted areas.
- **Text:** `text-xs` / `text-sm` for dense data, larger sizes only for page titles and the main figure of a panel.
- **Every state has a label**, every action says what it does ("Liberar", "Confirmar reintento"), and money actions show the exact total before confirming.
- **Reference screens:** the Payments workbench (`apps/admin-web/docs/payments-workbench.md`) is the approved pattern: content-sized tabs, full-width cards, a shared modal for details, page numbers instead of internal scroll. Reuse it; do not redesign approved screens unless asked.
- Icons: `lucide-react`.
- Charts and KPIs: load the `kpi-dashboard-design` skill; use real data only, never decorative numbers.

## Known gaps

Recorded, not fixed. Fix them in their own change.

- The admin has no `warning` or `errorSubtle` equivalent; add them to `index.css` when an admin screen needs one.

## For agents

- Read this file before UI work. Design skills (`frontend-design`, `expo-design-system`, `expo-native-ui`, `expo-ui`, `expo-animation`, `kpi-dashboard-design`, `accessibility`) apply inside these rules; when a skill suggests a different palette, typeface, or style, this file wins.
- Need a new token? Propose it in the theme file instead of hardcoding a value.
- Design explorations (mockups and alternative directions before code) live in `design/<slug>/` as self-contained HTML artboards, made with the Gentle Design skill. `design/system.md` is the token catalog they use, synced from the theme files; re-sync it when a theme file changes. An artboard is a proposal, not a spec: the chosen one is implemented with the app's real tokens and components.
- When a change is mostly visual, ask the maintainer for a quick look and say exactly what to check (see `AGENTS.md`, "Verifying a change").

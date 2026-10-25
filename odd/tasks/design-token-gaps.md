# Design token gaps

Fix the four "Known gaps" recorded in `DESIGN.md` for the app theme (`apps/frontend/core/theme`), then update that section.
Visual-only change; no money, SQL, or auth.

## Specs

- S1: "La paleta de la app define `pending`, pero el tema de Restyle no tiene el color `pending` (el admin sí tiene `status-pending`)." — the Restyle theme exposes `pending`.
- S2: "El token `warning` de la app en realidad es un rojo translúcido (`#dc35451a`), no un color de advertencia." Decision (L2): "Separar: errorSubtle + warning ámbar" — the translucent red becomes `errorSubtle` (error panel backgrounds, no visual change); `warning` becomes amber `#f59e0b` for caution icons, borders, and status dots.
- S3: "Hay componentes de la app con colores hardcodeados (por ejemplo `#D2232A`, `#f59e0b`, `#FFFFFF`) en lugar de tokens." Decision (L2): "Lo anterior + tokens de sombra y media" — replace hex literals in components with tokens, add `shadow` and `mediaBackground` tokens; brand colors (logos, Stripe, 3DMark) stay as documented exceptions.
- S4: "React Native Paper usa `roundness: 12`, que no está en la escala de radios de la app." Decision (L2): "s = 8".
- S5: "Al terminar, actualizá la sección "Known gaps" del DESIGN.md."
- S6: "COrre el skill opara refrescar las skills." — run the skill-registry skill.

## Tasks

- [x] T1 (S1, S2, S4): tokens module, `pending`, `warning`/`errorSubtle`, `shadow`, `mediaBackground`, roundness 8; call sites of `warning` re-pointed. Commit e801207.
- [x] T2 (S3): replace hex literals in components; source-scan guard test. Also `getOrderStatusColor("pending")` -> `pending` (S1); unused `getOrderStatusBgColor` and `core/constants/Colors.ts` removed. Commit 82c6d7e.
- [x] T3 (S5, S6): DESIGN.md token table and Known gaps; skill registry refresh. Registry: 46 skills, `.atl/skill-registry.md` (gitignored), Engram `skill-registry` updated.

## Log

- L1: "master, sigamos con lo que quedó pendiente del DESIGN.md. En la sección "Known gaps" anotamos 4 cosas para arreglar en un cambio aparte: 1. La paleta de la app define `pending`, pero el tema de Restyle no tiene el color `pending` (el admin sí tiene `status-pending`). 2. El token `warning` de la app en realidad es un rojo translúcido (`#dc35451a`), no un color de advertencia. 3. Hay componentes de la app con colores hardcodeados (por ejemplo `#D2232A`, `#f59e0b`, `#FFFFFF`) en lugar de tokens. 4. React Native Paper usa `roundness: 12`, que no está en la escala de radios de la app. Los tokens están en `apps/frontend/core/theme/index.ts` y en `apps/admin-web/src/index.css`. Leé el DESIGN.md y el AGENTS.md antes de arrancar. Si para alguno tengo que decidir algo de producto o de diseño (por ejemplo, qué hacemos con `warning`), preguntame antes de cambiarlo. Al terminar, actualizá la sección "Known gaps" del DESIGN.md. COrre el skill opara refrescar las skills."
- L2: Maintainer answers: warning "Separar: errorSubtle + warning ámbar (Recomendado)"; roundness "s = 8 (Recomendado)"; hardcoded "Lo anterior + tokens de sombra y media".
- L3: Findings. `#D2232A` is the Kingston/XPG logo red inside brand SVG icons (legitimate). `warning` had two uses: soft error panel background (`backgroundColor="warning"` + `borderColor="error"`) and caution foreground (alert icons, Connect border, status dot for PENDING_VERIFICATION/RESERVED/IN_REVIEW/IN_DISPUTE), where 10% red was nearly invisible. `getOrderStatusBgColor` and `core/constants/Colors.ts` are unused. Importing `core/theme/index.ts` under `bun test` fails (react-native), so tokens move to a pure `tokens.ts`.
- L4: T2 mapping: shadows -> `shadow`; image viewers -> `mediaBackground`; `#121212` -> `background`; toasts: info `#2196F3` -> `textSecondary`, warning -> `warning`; `#EF4444` -> `error`; `#666` -> `textSecondary`; `#2a2a2a` map placeholder -> `cardBackground`; PrimaryButton loading `#FFFFFF` and WalletBalanceCard `#000` text on gold -> `background`. Found but not decided: `getOrderStatusColor` maps cancelled/refunded/dispute to `error` instead of their state colors; recorded in Known gaps. Typecheck: 74 errors before and after, identical set. Lint on changed files: 1 pre-existing error (`ProductSnapCard.tsx` unused `styles`).
- L5: `gentle-ai skill-registry refresh --force` -> "Skill registry refreshed (46 skills)". `vercel-composition-patterns` indexes with an empty description: its multi-line YAML `description` is not read by the refresh parser (vendor skill, not edited). New since the last list: `sentry-react-native-sdk`.
- L6: Native review approved (lineage review-92b9d0131b47b7ea, base f27ddea; the default base 014f0ac exceeded the reviewer budget). Advisory findings: R3 PrimaryButton loading contrast with a custom `buttonColor`; R2 duplicate loading branch; R2 `palette.shadow` vs `colors.shadow` name collision; R3 no guard on warning/errorSubtle call sites.
- L7: "OKEY APLICA EL 1 Y 3, SOBRE EL color del texto del boton, me gusta como se ve actualmente. Metelo eso y commit y actualiza main y me haces resumen de loq ue hiciste y que propones que hagamos depues". Clarified: loading text on gold stays dark ("Oscuro (#121212), como en la rama ahora"). Applied: a loading button with a custom `buttonColor` gets `textPrimary` (helpers moved to `components/ui/primaryButtonColors.ts` so `bun test` can cover them); `palette.shadow` renamed `palette.scrim`.

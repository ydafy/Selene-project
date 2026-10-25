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

- [x] T1 (S1, S2, S4): tokens module, `pending`, `warning`/`errorSubtle`, `shadow`, `mediaBackground`, roundness 8; call sites of `warning` re-pointed. Commit: see git log (T1).
- [ ] T2 (S3): replace hex literals in components; source-scan guard test.
- [ ] T3 (S5, S6): DESIGN.md token table and Known gaps; skill registry refresh.

## Log

- L1: "master, sigamos con lo que quedó pendiente del DESIGN.md. En la sección "Known gaps" anotamos 4 cosas para arreglar en un cambio aparte: 1. La paleta de la app define `pending`, pero el tema de Restyle no tiene el color `pending` (el admin sí tiene `status-pending`). 2. El token `warning` de la app en realidad es un rojo translúcido (`#dc35451a`), no un color de advertencia. 3. Hay componentes de la app con colores hardcodeados (por ejemplo `#D2232A`, `#f59e0b`, `#FFFFFF`) en lugar de tokens. 4. React Native Paper usa `roundness: 12`, que no está en la escala de radios de la app. Los tokens están en `apps/frontend/core/theme/index.ts` y en `apps/admin-web/src/index.css`. Leé el DESIGN.md y el AGENTS.md antes de arrancar. Si para alguno tengo que decidir algo de producto o de diseño (por ejemplo, qué hacemos con `warning`), preguntame antes de cambiarlo. Al terminar, actualizá la sección "Known gaps" del DESIGN.md. COrre el skill opara refrescar las skills."
- L2: Maintainer answers: warning "Separar: errorSubtle + warning ámbar (Recomendado)"; roundness "s = 8 (Recomendado)"; hardcoded "Lo anterior + tokens de sombra y media".
- L3: Findings. `#D2232A` is the Kingston/XPG logo red inside brand SVG icons (legitimate). `warning` had two uses: soft error panel background (`backgroundColor="warning"` + `borderColor="error"`) and caution foreground (alert icons, Connect border, status dot for PENDING_VERIFICATION/RESERVED/IN_REVIEW/IN_DISPUTE), where 10% red was nearly invisible. `getOrderStatusBgColor` and `core/constants/Colors.ts` are unused. Importing `core/theme/index.ts` under `bun test` fails (react-native), so tokens move to a pure `tokens.ts`.

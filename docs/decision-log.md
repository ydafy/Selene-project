# Decision Log

## 2025-10-18: Development Environment Setup

**Decision:** The project MUST reside outside of any cloud-synced folders (OneDrive, Dropbox, etc.).

**Context:** After extensive debugging of Metro errors (`Failed to get SHA-1`), it was determined that the root cause was interference between OneDrive's file sync system and the Metro watcher.

**Consequence:** Moving the project to a simple path like `C:\dev\` resolved all Metro resolution issues. This is a non-negotiable rule for developing this project on Windows.

## 2025-10-18: Instalación de Dependencias de Expo en Monorepo

**Decisión:** Todos los comandos `expo install` (o `bun expo install`) DEBEN ejecutarse desde dentro del directorio del workspace de la aplicación (ej. `apps/frontend`), no desde la raíz del Monorepo.

**Contexto:** Se observó que al ejecutar `bun expo install <package>` desde la raíz, el paquete se añadía incorrectamente al `package.json` de la raíz en lugar del `package.json` del workspace del frontend. Esto causaba fallos en el "autolinking" nativo durante el `prebuild` de EAS, resultando en errores de "Cannot find native module".

**Consecuencia:** El flujo de trabajo estándar para añadir una dependencia de Expo al frontend será:

1. `cd apps/frontend`
2. `bun expo install <nombre-del-paquete>`
3. `cd ../..`
4. `bun install` (para actualizar el lockfile de la raíz)

## 2025-11-09: Ubicación de Dependencias del Workspace

**Decisión:** Las dependencias compartidas y del frontend (`zustand`, `react-query`, etc.) se mantendrán en el `package.json` de la raíz del monorepo.

**Contexto:** Aunque la práctica ideal es aislar las dependencias por workspace, la configuración actual es estable después de una compleja configuración inicial. Para priorizar la estabilidad del entorno de desarrollo, se decide no mover estas dependencias en este momento.

**Consecuencia:** Esto simplifica la gestión de versiones por ahora. Se revisará esta decisión en el futuro si se añade un nuevo workspace (ej. una app web) que no comparta estas dependencias.

## 2026-01-27: Inestabilidad con Bun, Expo y EAS en monorepo

**Contexto**
Monorepo con Bun como package manager, Expo para frontend y EAS Build para Android.
El proyecto funcionaba correctamente con:

- Node `22.13.1`
- Bun `1.3.0`
- Expo SDK `~54.0.13`

---

**Problema**

De forma inesperada:

- `bun run frontend` dejó de funcionar.
- `bun install` fallaba por un `postinstall` de **Supabase**.
- Expo no detectaba la versión del SDK (`expo` aparentemente no instalado).
- EAS Build fallaba con:
  bun install --frozen-lockfile exited with code 127
  bunx: command not found

- Bun se actualizó automáticamente a otra versión, causando diferencias entre local y CI.

---

**Causas**

- Desalineación de versiones (Bun local ≠ Bun en EAS).
- Bun bloqueando scripts `postinstall` (Supabase).
- Script `prepare` ejecutando `bunx husky` en CI.
- Comportamiento distinto entre entorno local y EAS.

---

**Decisiones**

- Fijar versiones:
- Node `22.13.1`
- Bun `1.3.0`
- Mantener Bun como package manager (no migrar a npm/yarn).
- Evitar ejecutar Husky en CI.
- Alinear entorno local con `eas.json`.

---

**Resultado**

- `bun install` vuelve a ser estable.
- `bun run frontend` funciona correctamente.
- EAS Build deja de fallar en la fase de dependencias.
- Entorno local y CI quedan sincronizados.

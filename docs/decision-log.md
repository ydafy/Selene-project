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

# Guía de Pruebas — Admin Dashboard

Después de las 6 fases de refactor, esto es lo que hay que verificar:

## 1. Build & TypeScript

```bash
cd apps/admin-web
bun run build        # Debe compilar sin errores
bunx tsc -b          # Debe pasar sin errores
```

## 2. Type Safety (Fase 2)

- [ ] No hay `eslint-disable @typescript-eslint/no-explicit-any` en `src/`:
  ```bash
  grep -r 'eslint-disable.*no-explicit-any' src/ --include='*.ts' --include='*.tsx'
  # → 0 resultados
  ```

## 3. Tablas con DataTable (Fase 2)

Abrir cada página y verificar que las tablas renderizan:

- **Disputas** → tabla de 6 columnas con sorting, paginación, botón "Ver Detalle"
- **Usuarios** → tabla de usuarios con búsqueda
- **Detalle de Usuario** → Inventory, Purchases, Transactions, Payouts tablas
- **Verificación** → lista de productos a la izquierda

Probar en cada tabla:
- [ ] Click en header para ordenar (asc/desc)
- [ ] Paginación (Previous/Next)
- [ ] Loading state (skeleton rows)
- [ ] Empty state (si no hay datos)
- [ ] Responsive: scroll horizontal en mobile

## 4. Dashboard KPIs (Fase 4)

- [ ] Las 4 cards operativas muestran trend arrows (↑/↓/→)
- [ ] 3 nuevas cards estratégicas: Usuarios, Productos Verificados, Total Productos
- [ ] Los trends muestran % de cambio vs período anterior
- [ ] ActivityFeed muestra error state con retry si falla

## 5. Layout Responsive (Fase 3)

Abrir DevTools y probar:

- **Desktop (>1024px)**: sidebar completa, todo normal
- **Tablet/Móvil (<1024px)**: 
  - [ ] Sidebar colapsa, hamburger button aparece arriba a la izquierda
  - [ ] Click hamburger → sidebar se desliza con overlay oscuro
  - [ ] Click overlay → sidebar se cierra
  - [ ] El contenido principal ocupa full width

- **DisputeDetailPage**: el bottom bar se reposiciona correctamente

## 6. VerificationPage (Fase 3)

- [ ] La página carga y muestra la lista de productos a la izquierda
- [ ] Select un producto → detalle se muestra a la derecha
- [ ] Search funciona (filtra productos)
- [ ] Category filter funciona (GPU, CPU, RAM, etc.)
- [ ] Approve/Reject abre ConfirmModal
- [ ] Internal notes se guardan
- [ ] ImageModal abre con las imágenes del producto
- [ ] Error state: si falla la query, muestra ErrorState con retry

## 7. Error Boundaries (Fase 5)

Probar forzando un error en cualquier página:
- [ ] No crashea toda la app
- [ ] Muestra "Algo salió mal" con mensaje y botón "Reintentar"
- [ ] Click "Reintentar" recupera el estado

## 8. Skeleton Loading (Fase 5)

Hacer hard refresh en cada página:
- [ ] UsersPage: 8 skeleton cards mientras carga
- [ ] UserDetailPage: skeleton layout (header, cards, panels)
- [ ] DisputeDetailPage: skeleton layout
- [ ] DashboardHome: StatCard skeletons + ActivityFeed skeletons

## 9. Aesthetic Polish (Fase 6)

- [ ] Hover en StatCards: borde cambia, sombra sutil
- [ ] Hover en filas de DataTable: bg cambia
- [ ] Transición fadeIn al navegar entre páginas
- [ ] Focus rings visibles al tabular (keyboard navigation)
- [ ] Todos los botones tienen cursor-pointer
- [ ] StatusBadge "active" tiene pulse animation

## 10. Reduced Motion

En settings del SO, activar "Reducir movimiento":
- [ ] Todas las animaciones se desactivan
- [ ] No hay transitions ni pulse animations

## Checklist Rápido por Página

| Página | Items a Probar |
|--------|----------------|
| `/` (Dashboard) | 7 KPIs con trends, gráfica actividad, ActivityFeed |
| `/verify` | Lista, detalle, approve/reject, notas, imágenes |
| `/users` | Tabla con search, paginación, sorting |
| `/users/:id` | 5 tabs con tablas, skeletons, cards |
| `/disputes` | Tabla con sorting, action button |
| `/disputes/:id` | Detalle, bottom bar responsive |
| `/login` | Login flow |

## Notas

- Los 48 errores pre-existentes de `tsc` están resueltos — **0 errores de type-check**
- El chunk size warning de Vite es normal para dashboards con muchas librerías
- No hay cambios en el backend, API, o base de datos — solo frontend

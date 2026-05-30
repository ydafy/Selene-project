# Dashboard V2 — Backlog

Nice-to-haves y mejoras diferidas del audit de admin dashboard. No son blockers, son mejoras progresivas.

---

## Charts & Visualization

Prioridad alta para la próxima iteración del dashboard.

- [ ] Reemplazar "Resumen de Actividad" (texto) con bar/line chart real (recharts o nivo)
- [ ] Monthly sales trend chart (datos existentes en `monthlySalesCount`)
- [ ] Product verification funnel (pending → verified/rejected)
- [ ] Referencia: skill `kpi-dashboard-design` para patrones de implementación

## Key Alerts Section

Alertas ejecutivas entre KPIs y ActivityFeed. Effort: ~40 líneas.

- [ ] "X productos pendientes >48h"
- [ ] "Y disputas activas"
- [ ] "Z ventas este mes"
- [ ] Datos ya disponibles en `useAdminStats`

## Dashboard Evolution

Mejoras de UX progresivas.

- [ ] Date range filter para KPIs
- [ ] Tooltips de metodología de cálculo en las tarjetas
- [ ] Mover ActivityFeed de `components/features/verify/` a `components/features/dashboard/`
- [ ] Toggle light/dark mode
- [ ] Keyboard shortcuts en VerificationPage (A=approve, R=reject)

## DataTable Power-ups

Mejoras para todas las tablas del admin.

- [ ] Column visibility toggle (mostrar/ocultar columnas)
- [ ] "Mostrando X de Y" en paginación
- [ ] Mobile card views para tablas responsive
- [ ] Export a CSV

## Infrastructure

Fundamentos para escalar.

- [ ] i18n / localization (strings hardcoded en español)
- [ ] Tests unitarios para hooks críticos (`useAdminStats`, `useDisputeActions`, `usePendingProducts`)
- [ ] Navigation guard para formularios con datos sin guardar
- [ ] Bulk actions en VerificationPage (batch approve/reject)

## Known Bugs (non-critical)

Bugs visuales/no-críticos detectados durante el audit.

- [ ] InventoryTable/PurchasesTable: imágenes rotas (storage path crudo en vez de signed URL)
- [ ] SecureImage/SecureVideo: skeleton infinito cuando falla la carga
- [ ] DataTable: flash de "No data" antes del primer fetch
- [ ] InputModal: form state persiste entre open/close
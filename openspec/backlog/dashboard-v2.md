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

#### 1. Evitar el Doble Gasto del Vendedor (Wallet Lock on Request)

- _El Riesgo:_ Si un vendedor tiene $10,000 MXN en su `available_balance` e ingresa una solicitud de retiro (`payout_requests`), y el sistema no descuenta el dinero de su billetera inmediatamente:
  - El vendedor solicita el retiro de $10,000 MXN (el estado se queda en `'pending'`).
  - Mientras tú descargas el CSV y lo subes a BBVA (proceso que toma horas), el vendedor abre la app móvil y compra un GPU de $10,000 MXN usando su saldo disponible.
  - El sistema procesa la compra. El disponible del vendedor baja a $0.
  - Tú subes el archivo a BBVA y el banco le transfiere $10,000 MXN reales a su cuenta de débito.
  - _El desastre:_ El vendedor duplicó su saldo y tu plataforma absorbe una pérdida neta de $10,000 MXN.
- _La Solución Contable:_ En cuanto el vendedor crea un `payout_request`, el sistema **debe debitar inmediatamente** los fondos de su `available_balance` y colocarlos en un estado de retención. Si el admin rechaza el pago (por CLABE inválida), el dinero se le reembolsa a su saldo disponible con una transacción tipo `'payout_refund'`; si el admin lo aprueba subiendo el CSV, el pago pasa a `'completed'` de forma definitiva.

#### 2. Sanitización Estricta del CSV para BBVA (Vulnerabilidad de caracteres)

- _El Riesgo:_ El portal de empresas de BBVA Bancomer es extremadamente arcaico y estricto con los caracteres permitidos en sus Lay-outs de transferencia masiva. Si el nombre de un vendedor contiene acentos (como `á, é, í, ó, ú`) o caracteres especiales (como `ñ, ü, &, @`), **el validador de BBVA rechazará el archivo CSV completo**, impidiéndote dispersar fondos a ninguno de tus 50 vendedores.
- _La Solución:_ La Edge Function o el componente de React del Dashboard que genera el CSV debe **sanitizar de forma obligatoria todos los textos**:
  - Reemplazar acentos (`á` -> `a`, `é` -> `e`, etc.).
  - Convertir la `ñ` a `n` o `N`.
  - Eliminar cualquier carácter especial no alfanumérico.
  - Forzar que la CLABE tenga exactamente 18 dígitos numéricos.

**Opciones Técnicas:**

- **Auditoría del Generador de CSV en Vite:** Diseñar un descargador de archivos en React que procese los registros de solicitudes de retiro pendientes (`'pending'`) y compile el archivo plano sanitizado bajo las especificaciones exactas del Lay-out de BBVA.

**Recomendaciónes:**
El módulo de dispersión masiva por BBVA es una de las pantallas que más tiempo te ahorrará como administrador. Otorgo prioridad máxima a auditar este flujo.

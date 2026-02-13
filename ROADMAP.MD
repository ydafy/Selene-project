# 🗺️ SELENE: ULTIMATE ROADMAP - MÓDULO DE ÓRDENES (V1.1)

**Objetivo:** Gestionar el ciclo de vida post-pago, automatizar la logística con Envia.com y administrar las finanzas mediante un sistema de Billetera Interna con Dispersión Masiva.

---

## FASE 1: INFRAESTRUCTURA DE DATOS Y AUDITORÍA (SQL)
*Meta: Crear el motor de base de datos que soporte el flujo de dinero y estados.*

1.  **Sincronización de Estados (`OrderStatus`):**
    *   Implementar un tipo `ENUM` en Postgres con los estados: `PAID` (Pagado), `PREPARING` (Guía generada), `SHIPPED` (En tránsito), `DELIVERED` (Entregado), `COMPLETED` (48h sin disputa, fondos liberados), `DISPUTE` (Venta congelada), `CANCELLED` (Cancelada), `REFUNDED` (Dinero devuelto).
2.  **Sistema de Billetera (Ledger Interno):**
    *   **Tabla `wallets`:** Almacena `pending_balance` (dinero en tránsito) y `available_balance` (dinero listo para retirar).
    *   **Tabla `wallet_transactions`:** **Audit Trail Crítico**. Cada movimiento de dinero debe registrar: `type` (SALE, PAYOUT, FEE, RELEASE), `amount`, y `balance_after` (el saldo resultante tras la operación para evitar auditorías manuales).
3.  **Seguridad RLS:**
    *   Políticas estrictas: El vendedor solo tiene acceso de lectura al snapshot de la dirección del comprador en la tabla `orders` si el estado es `PAID` o superior.

## FASE 2: VISUALIZACIÓN Y GESTIÓN (FRONTEND)
*Meta: UI para que el usuario controle sus compras, ventas y dinero.*

1.  **Pantalla "Mis Pedidos" (`OrdersList`):**
    *   Uso de Tabs para separar "Compras" y "Ventas".
    *   Tarjetas con badges de estado dinámicos (colores según el `OrderStatus`).
2.  **Pantalla "Detalle de Orden" (`OrderDetail`):**
    *   **Timeline Visual:** Componente vertical que muestra el progreso real del paquete.
    *   **Acciones Contextuales:** Botón "Generar Guía" (Vendedor), "Rastrear" (Ambos), "Tuve un problema" (Comprador).
3.  **Pantalla "Mi Billetera" (`WalletScreen`):**
    *   Desglose de saldo y lista de transacciones históricas.
    *   Formulario de retiro con **Validación de CLABE (18 dígitos)**.

## FASE 3: LOGÍSTICA SEMI-AUTOMÁTICA (ENVIA.COM)
*Meta: Generación de guías eficiente sin intervención del staff de Selene.*

1.  **Estrategia "Confirmación de Disponibilidad":**
    *   La guía NO se genera sola al comprar. El vendedor debe presionar "Generar Guía" para confirmar que tiene el paquete listo. Esto evita gastos en guías que no se usarán.
2.  **Edge Function `generate-shipping-label`:**
    *   **Regla Anti-Fraude:** Vendedores novatos (<3 ventas) tienen un límite de **2 envíos activos** simultáneos. No pueden generar una 3ra guía hasta que una llegue a su destino.
    *   Llamada a API Envia.com (Estafeta), obtención de PDF y actualización de `tracking_number` en la DB.
3.  **Notificación:** Envío automático del PDF de la guía al correo del vendedor mediante **Resend**.

## FASE 4: AUTOMATIZACIÓN DEL ESCROW (EL RELOJ)
*Meta: Liberación de fondos y auto-cancelaciones sin intervención manual.*

1.  **Cron de Tracking (Cada 6 horas):**
    *   Edge Function programada que consulta a Envia.com. Si el paquete dice "Entregado", cambia el estado en Selene a `DELIVERED`.
2.  **Cron de Liberación (Escrow de 48h):**
    *   Si una orden lleva 48h en `DELIVERED` y no hay una `DISPUTE` abierta, el sistema mueve automáticamente el dinero de `pending_balance` a `available_balance` y crea el registro en `wallet_transactions`.
3.  **Cron de Auto-Cancelación:**
    *   Si el vendedor no genera la guía en **72 horas** tras el pago, el sistema cancela la orden y dispara un `Refund` automático en Stripe.

## FASE 5: DISPERSIÓN MASIVA (ADMIN OPS)
*Meta: Operación escalable para el equipo de Selene.*

1.  **Generador de Archivo de Pagos:**
    *   En el panel de Admin, un botón para exportar todas las solicitudes de retiro `PENDING` a un archivo **CSV/TXT** con el formato exacto que pide el banco (BBVA/Banamex/etc).
2.  **Conciliación:**
    *   Una vez subido el archivo al banco, el admin marca el lote como "Pagado" y el sistema notifica a todos los vendedores involucrados.

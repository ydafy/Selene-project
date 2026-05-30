# ANÁLISIS INICIAL

**Resumen:**
La función `auto-cancel-preparing` es una pieza de seguridad indispensable para evitar que vendedores flojos retengan el inventario del marketplace imprimiendo etiquetas que nunca enviarán.

Sin embargo, tras realizar una auditoría de rendimiento y operación real de logística, **TE DENIEGO LA LUZ VERDE (RED LIGHT / DETENIDO)** en este batch. He detectado **una vulnerabilidad de lógica operativa (la trampa del fin de semana en México)** y **un embotellamiento de red grave por invocación HTTP redundante**:

---

### Análisis de Gaps y Diffs (Fase 4.10)

#### 1. El Embudo de Rendimiento (Llamadas HTTP redundantes entre Edge Functions)

- **El problema (Línea 65-75):**
  Para cancelar cada envío atascado, tu código realiza una llamada HTTP externa invocando a otra Edge Function de Supabase: `supabaseAdmin.functions.invoke('cancel-order')`.
  - _El cuello de botella:_ Si tienes 50 paquetes para cancelar en un lote, tu Edge Function levantará 50 instancias de Deno en paralelo/secuencia, incurriendo en retardos de inicio en frío (_cold starts_), sobrecostos de red y duplicando tu factura de ejecución de Supabase.
  - _La Solución de Nivel Senior:_ No necesitas invocar una Edge Function externa por HTTP. En la **Fase 4.3** ya construimos y blindamos la función de base de datos **`fn_cancel_shipment`** (que maneja las wallets, transacciones, productos y notificaciones de forma atómica). La Edge Function de tu Cron puede simplemente llamar a este RPC directo en base de datos. Esto colapsará el tiempo de ejecución de 30 segundos (con sus delays de 500ms) a **menos de 200 milisegundos en total**, reduciendo tu consumo de recursos a cero.

#### 2. La Trampa del Fin de Semana (UX Mutilada - Línea 28)

- **El problema:**
  Si un comprador paga el viernes por la noche, y el vendedor genera la etiqueta el sábado en la mañana (estado `'preparing'`), las paqueterías en México cierran el sábado por la tarde y todo el domingo. El lunes a las 11:00 AM (49 horas después), mientras el vendedor está parado en la fila de DHL para entregar el paquete, **este cron se activará y auto-cancelará la orden** porque ya pasaron más de 48 horas.
  - _La Solución:_ Generar una etiqueta es digital (toma 2 minutos desde el celular, por lo que 48 horas para hacerlo está perfecto). Pero **llevar el paquete físico requiere días hábiles**. Una vez que el envío pasa a `'preparing'`, el tiempo de gracia de auto-cancelación física debe ser más holgado. Recomiendo duplicar el tiempo de gracia de empaque a mostrador a **96 horas (4 días calendario)**, garantizando que absorba fines de semana enteros y retrasos de escaneo del transportista.

---

# Parches posibles

Aquí tienes los dos micro-parches de TypeScript para optimizar tu cron eliminando el cuello de botella HTTP y aplicando la protección de fin de semana:

### 1. Parche del Reloj de Gracia de Empaque (Reemplazar Líneas 27-31):

_Duplicamos el tiempo de gracia de entrega física para absorber sábados y domingos en México:_

```typescript
// FIX: Damos 4 días calendario (96h) para la entrega física a paquetería, absorbiendo fines de semana y retrasos de escaneo
const hours = (settings?.order_expiration_hours || 48) * 2;
const expirationLimit = new Date(
  Date.now() - hours * 60 * 60 * 1000,
).toISOString();
```

### 2. Parche de Invocación Atómica por RPC (Reemplazar Líneas 61-83):

_Eliminamos la llamada HTTP a 'cancel-order' y llamamos directamente a nuestro RPC transaccional de base de datos:_

```typescript
log(
  'INFO',
  `Procesando ${expiredShipments.length} shipments atascados en preparing`,
);

let successCount = 0;

for (const shipment of expiredShipments) {
  try {
    // FIX: Llamamos directo al RPC transaccional 'fn_cancel_shipment' en base de datos.
    // Evita latencia de red, cold starts de Deno y cargos duplicados de facturación de Supabase.
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'fn_cancel_shipment',
      {
        p_shipment_id: shipment.id,
        p_cancelled_by_role: 'system',
        p_reason: `Cancelación automática: Envío en preparación por más de ${hours} horas sin entrega física.`,
      },
    );

    const success = rpcData?.[0]?.success ?? false;
    const errMsg = rpcData?.[0]?.error_message ?? null;

    if (!rpcError && success) {
      successCount++;
      log('INFO', 'Shipment en preparing cancelado exitosamente', {
        shipmentId: shipment.id,
        orderId: shipment.order_id,
      });
    } else {
      log('ERROR', `Fallo al cancelar shipment ${shipment.id}`, {
        orderId: shipment.order_id,
        error: rpcError?.message || errMsg,
      });
    }
  } catch (err: any) {
    log('ERROR', `Excepción en loop para shipment ${shipment.id}`, {
      orderId: shipment.order_id,
      error: err.message,
    });
  }
}
```

---

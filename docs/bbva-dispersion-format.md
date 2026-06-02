# BBVA Net Cash — Dispersión Masiva vía SPEI

> Fuente principal: `review.md` (raíz del repo). Movido aquí como documentación permanente.
> Última actualización: 2026-06-01

## Formato de Archivo

- **Extensión:** `.txt` o `.csv`
- **Delimitador:** Coma (`,`)
- **Encoding:** UTF-8 sin BOM
- **Saltos de línea:** Un registro por línea (LF o CRLF)

## Estructura por Línea

```
BANCO_DESTINO,CUENTA_CLABE,IMPORTE,BENEFICIARIO,REFERENCIA
```

| # | Campo            | Tipo         | Formato / Restricciones                                           | Ejemplo                         |
|---|------------------|--------------|-------------------------------------------------------------------|---------------------------------|
| 1 | Banco Destino    | Numérico     | 3 dígitos. Ceros a la izquierda obligatorios.                     | `012` (BBVA), `002` (Banorte)  |
| 2 | Cuenta / CLABE  | Numérico     | 11 o 18 dígitos. Sin guiones ni espacios. Ceros a la izq. intactos. | `012345678901234567`           |
| 3 | Importe          | Decimal      | Hasta 2 decimales. Punto `.` como separador decimal. Sin `$` ni `,`. | `15500.50`                     |
| 4 | Beneficiario     | Texto        | MAYÚSCULAS. Sin acentos (á→A), sin ñ (Ñ→N), sin caracteres especiales (#$&ü). | `JUAN PEREZ LOPEZ`            |
| 5 | Referencia       | Alfanumérico | Libre. Concepto de pago o ID del colaborador.                     | `NOM001`                        |

## Reglas de Validación Críticas

1. **Ceros a la izquierda:** Bancos (`012`, `002`) y cuentas/CLABE NO deben perder los ceros iniciales al exportar.
2. **Una línea por registro:** Cada pago = una línea. No hay header ni footer.
3. **Sin caracteres especiales:** El sistema RECHAZA archivos con `á, é, í, ó, ú, ñ, ü, #, $, &`. Solo letras A-Z (sin Ñ), números, espacios y punto decimal.
4. **Importe exacto:** El monto debe coincidir con el saldo a dispersar. Un error en el monto genera depósitos incorrectos.
5. **Beneficiario sanitizado:** Nombres en MAYÚSCULAS, sin acentos, Ñ→N. Ej: `MUÑOZ` → `MUNOZ`, `GARCÍA` → `GARCIA`.

## Códigos de Banco (SPEI - 3 dígitos)

Lista de códigos SPEI para los bancos más comunes en México:

| Código | Banco                        |
|--------|------------------------------|
| 001    | Banco Nacional de México (Banamex) |
| 002    | BBVA México (Banco del Bicentenario) |
| 006    | Banco Nacional de Comercio Exterior (Bancomext) |
| 012    | BBVA México                  |
| 014    | Santander México             |
| 019    | Banco Azteca                 |
| 021    | HSBC México                  |
| 030    | Banco del Bajío              |
| 036    | Inbursa                      |
| 042    | Mifel                        |
| 044    | Scotiaban                    |
| 058    | American Express             |
| 059    | Banco Inbursa                |
| 072    | Banco Mumulti                |
| 072    | Banorte / IXE                |
| 102    | The Royal Bank of Scotland   |
| 103    | American Express Bank        |
| 112    | Banco Multiva                |
| 127    | Kiwi Bank                    |
| 133    | Caja Populares               |
| 134    | Bancoppel                    |
| 135    | Azteca                       |
| 166    | Banco Paga                   |
| 600    | STP (Sistema de Transferencias y Pagos) |
| 901    | CLS                           |

> **Nota:** Los códigos oficiales están publicados por Banxico / SPEI. La tabla arriba es referencial — validar contra la lista oficial de Banxico antes de producción.
> **Clave:** Si el usuario seleccionó "CLABE STP" o un banco específico desde la app, el primer dígito de la CLABE ya codifica el banco destino. Aun así, BBVA Net Cash exige la columna de banco destino explícita.

## Flujo de Dispersión (Admin Dashboard)

```
1. Admin ve solicitudes de retiro pendientes (payout_requests.status = 'pending')
2. Admin selecciona cuáles dispersar (o todas)
3. Sistema genera archivo BBVA con formato especificado arriba
4. Admin descarga el archivo .txt
5. Admin sube el archivo a BBVA Net Cash (manual, fuera de nuestra app)
6. BBVA procesa las transferencias SPEI
7. Admin marca las solicitudes como 'processing' → luego 'completed' al confirmar
8. Sistema actualiza wallet_transactions y wallets
```

## Checklist Pre-Export

- [ ] Montos coinciden con saldos disponibles (no dispersar más del `available_balance`)
- [ ] CLABE tiene 18 dígitos y dígito verificador válido
- [ ] Nombre del beneficiario sanitizado (mayúsculas, sin acentos, sin Ñ)
- [ ] Código de banco destino correcto (3 dígitos con ceros a la izquierda)
- [ ] No hay registros duplicados en el lote
- [ ] Archivo codificado en UTF-8 sin BOM
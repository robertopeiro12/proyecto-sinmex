# T-32 · Flujo de Efectivo (Portal, solo lectura) — Diseño

**Issue:** [#32](https://github.com/robertopeiro12/proyecto-sinmex/issues/32) (depende de T-17, T-21, T-29 — hechos — y T-31, de Mario, pendiente).
**Fecha:** 2026-10-19 · **Estado:** aprobado en conversación por Roberto
**Base:** `Flujo de Efectivo.md`, `Tesorería.md`, `Cobranza-Abono.md` y `Status de venta.md` del vault; T-29
(`tesoreria/cobranza-tesoreria.repository.ts`, `TesoreriaService.vista`); T-49 (Reporte de Ventas, atajos de rango);
T-15 (`apps/portal/src/lib/excel/`).

## 1. Para qué

Fuente (`Sistema Jawa (fuente)`, *Flujo de Efectivo*): *"Es el resultado diario, o de un periodo de tiempo, entre los
ingresos y egresos que muestra el balance final así como la tesorería del negocio. Esta sección es meramente
informativa, no se podrá modificar […] Se debe mostrar el flujo de acuerdo a un rango de fechas […] Debe mostrar los
comentarios (en un recuadro) de los ingresos como egresos"*. Reemplaza la pestaña **Flujo Diario** del Excel.

Issue #32:
- [ ] Ventas Totales, Cobradas (repartidor + oficinas), % de Cobro.
- [ ] Gastos por tipo y utilidades (bruta, operación, neta) y Total Tesorería.
- [ ] Recuadro de comentarios de ingresos/egresos; solo lectura.

**Reparto:** Portal = Roberto. No se toca `apps/tablet`. Los **gastos** los trae T-30/T-31 (Mario); T-32 deja las filas
listas en $0.

## 2. Decisiones (Roberto, 2026-10-19)

| Tema | Decisión |
|---|---|
| Gastos (aún no existen) | **Pantalla completa ya**, gastos en $0 con la etiqueta "sin gastos registrados todavía (llegan con Compras y Egresos)"; al llegar T-31 solo se conecta la fuente |
| Repartidor vs oficina | **Por quién cobró**: con vendedor = repartidor; sin vendedor (Oficina) o venta de mostrador = oficina |
| Abonos parciales | **Por lo abonado** (el dinero que entró) |
| Fechas | Ventas Totales por **fecha de la venta**; Ventas Cobradas por **fecha del pago** (igual que la Tesorería) |
| Permiso | Nuevo `flujo_efectivo.ver`, grupo **Finanzas** |
| Menú | *Finanzas → Flujo de Efectivo* (`/finanzas/flujo-efectivo`) |

## 3. Reglas

- **Ventas Totales** = Σ `venta_nota.monto_total` de ventas **vivas** con `fecha` en `[desde, hasta]`, de **cualquier**
  status; sucursal = **la de la venta** (como T-49).
- **Ventas Cobradas** = la **misma** cobranza que lee la Tesorería (T-29 §3.2), con `fecha_pago` en el rango:
  - `cobro` vivo de origen `cobro` (monto completo; sucursal **del cliente**). **Repartidor** si `cobro.vendedor_id` no
    es nulo; **Oficina** si es nulo.
  - `cobranza_abono` vivo de origen `venta_contado` de una `venta_nota` viva (sucursal **de la venta**). **Repartidor**
    si `venta_nota.vendedor_id` no es nulo; **Oficina** si es nulo (venta de mostrador).
  - **Nunca** `saldo_favor`. Un cobro borrado (T-34) o una venta editada/eliminada (T-17) dejan de contar solos.
- **% de Cobro** = Ventas Cobradas ÷ Ventas Totales × 100, con **1 decimal**; `null` ("—") si Ventas Totales = 0. Puede
  pasar de 100 % (se cobran notas de días anteriores).
- **Gastos** de Producción / Operación / Financieros = 0 con `gastosDisponibles: false` hasta T-31.
- **Utilidad Bruta** = Cobradas − Gastos de Producción; **de Operación** = Bruta − Operativos; **Neta** = Operación −
  Financieros.
- **Total Tesorería** = `total.saldoFinalCentavos` de `TesoreriaService.vista(desde, hasta, sucursal)` (mismo alcance),
  con `cuentasConSaldo`/`cuentas` para el aviso "N de M cuentas con saldo". No se duplica el cálculo.
- **Desglose por día** (cada fecha del rango con algo): ventas, cobrado repartidor, cobrado oficina, % de cobro del día.
- **Comentarios** del rango:
  - **Ingresos**: ventas vivas con `comentarios` no vacío (fecha, folio, cliente, comentario).
  - **Egresos**: comentarios de **retiros** y **traspasos** de Tesorería del rango (fecha, cuenta(s), monto, comentario).
    Los de compras llegan con T-31.
- **Alcance:** `resolverAlcance`; con una sucursal, todo se filtra por ella (ventas por la de la venta, cobros por la del
  cliente, contado por la de la venta). Rango ≤ 366 días (`validarRango`). Todo en **centavos enteros**.

## 4. Backend (`modules/flujo-efectivo/`)

- Migración `20261019140000_permiso_flujo_efectivo.sql`: `insert into permiso … ('flujo_efectivo.ver', 'Finanzas',
  'Ver Flujo de Efectivo') on conflict do nothing`. Sin pre-flight.
- `TesoreriaModule` exporta `TesoreriaService`; `FlujoEfectivoModule` lo importa.
- `GET /flujo-efectivo?desde=&hasta=&sucursal=` con `@RequierePermiso('flujo_efectivo.ver')`:

```json
{
  "desde": "…", "hasta": "…",
  "ventasTotalesCentavos": 0, "cobradoRepartidorCentavos": 0, "cobradoOficinaCentavos": 0,
  "ventasCobradasCentavos": 0, "porcentajeCobro": 87.5,
  "gastosDisponibles": false,
  "gastosProduccionCentavos": 0, "gastosOperacionCentavos": 0, "gastosFinancierosCentavos": 0,
  "utilidadBrutaCentavos": 0, "utilidadOperacionCentavos": 0, "utilidadNetaCentavos": 0,
  "totalTesoreriaCentavos": 0, "tesoreriaCuentasConSaldo": 3, "tesoreriaCuentas": 4,
  "dias": [{ "fecha": "…", "ventasCentavos": 0, "cobradoRepartidorCentavos": 0, "cobradoOficinaCentavos": 0, "porcentajeCobro": null }],
  "comentarios": {
    "ingresos": [{ "fecha": "…", "folio": "…", "cliente": "…", "comentario": "…" }],
    "egresos": [{ "fecha": "…", "concepto": "Retiro", "cuenta": "…", "montoCentavos": 0, "comentario": "…" }]
  }
}
```

- Reglas puras en `reglas-flujo.ts` (porcentaje, utilidades, armado de días).
- Pruebas: unitarias de fórmulas (0 ventas → null, >100 %, utilidades encadenadas, redondeo a 1 decimal); e2e con
  fechas propias (2018) — repartidor vs oficina (cobro con/sin vendedor, contado de vendedor / de mostrador), abono
  parcial por lo abonado, saldo a favor no cuenta, cobro borrado no cuenta, comentarios de ventas, `totalTesoreria`
  igual al de `GET /tesoreria`, 403 sin permiso, alcance TJ.

## 5. Portal

- Pantalla `components/flujo-efectivo/pantalla-flujo-efectivo.tsx` (patrón de Reporte de Ventas): rango con atajos
  (Hoy, Ayer, Esta semana, Este mes), por defecto hoy, consulta al abrir; **cuadro resumen** en el orden del cliente;
  gastos con la etiqueta cuando `gastosDisponibles` es false; negativos en rojo; aviso de cuentas sin saldo bajo Total
  Tesorería; **desglose por día**; **recuadro de comentarios** en dos columnas; **Exportar a Excel** (una hoja: resumen,
  días, comentarios). Sin permiso: el aviso de siempre.
- Cabe desde 1366 px. Pruebas de pantalla y revisión en navegador.

## 6. Vault (al terminar)

`Flujo de Efectivo.md` (dudas resueltas: abonos por lo abonado, fechas, repartidor/oficina; gastos pendientes de
T-31), `Estado del proyecto.md`, bitácora; bloque corto en `CLAUDE.md`.

## 7. Fuera de alcance

Gastos reales (T-30/T-31); flujo "teórico vs validado"; editar cualquier cifra desde aquí.

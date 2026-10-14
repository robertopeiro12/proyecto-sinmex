# T-49 · Reporte de Ventas (Portal) — Diseño

**Issue:** [#49](https://github.com/robertopeiro12/proyecto-sinmex/issues/49) (depende de T-17 y T-15, mergeados).
**Fecha:** 2026-10-14 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Estadísticas y Reportes.md`, `Venta-Nota.md` y `Status de venta.md` del vault; T-50 (`modules/estadisticas/`,
`validarRango`, pantalla de Kilometraje); T-15 (`apps/portal/src/lib/excel/`); T-17 (`venta_nota`, `venta_nota_detalle`);
T-19 (`factura`); T-09 (`resolverAlcance`); permiso `reporte_ventas.ver` (sembrado en T-05).

## 1. Para qué

Fuente del cliente (vault, `Estadísticas y Reportes.md`):

> **Mostrar Ventas** muestra las ventas por un **rango de fechas**; por default viene la fecha actual. Botones:
> **Mostrar**, **Exportar a Excel** y **Salir**. Columnas: Fecha · Cliente · Cantidad · Monto · # Nota · Status ·
> Semana · Repartidor · Factura. Con fila de **TOTAL** (suma de Cantidad y Monto).

Issue #49: "Como administrador, quiero un reporte de ventas por rango con columnas (fecha, cliente, cantidad, monto,
# nota, status, semana, repartidor, factura), total y exportación a Excel." Criterios:

- [ ] Mostrar por rango con fila TOTAL (cantidad + monto).
- [ ] Exportar a Excel; filtro por sucursal.
- [ ] Corrige bugs v2.0 (suma de monto; quitar inventario de resultados por día).

El tercer criterio habla de errores del **sistema viejo** del cliente ("Resultados por día"): en el nuevo se cumple con
sumar el monto de **todas** las ventas, incluidas las del portal, y no mostrar inventario.

La fuente más reciente del cliente (`Nuevo Sistema Jawa Sinmex Julio 2027`, módulo de Operación) lo resume así:

> **Reporte de Ventas:** resultados **por vendedor y por día** (filtros por fecha, vendedor).

Por eso el reporte trae **subtotales por día** y además un **resumen por repartidor** del rango.

Mario (2026-09-17): los reportes van **por fechas** ("de tal día a tal día… por día, semana y mes"). Se resuelve con
**atajos de rango** que solo llenan las fechas, más **subtotales por día**.

**Reparto:** Portal = Roberto. **No se toca `apps/tablet`** ni el contrato de sincronización. **Sin migración.**

## 2. Decisiones de producto (Roberto, 2026-10-14)

| Tema | Decisión |
|---|---|
| Cantidad | **Dos columnas**: "Cantidad" (piezas vendidas) y "Promo" (piezas regaladas), cada una con su total |
| Ubicación y permiso | **Operación → Reporte de Ventas** (la página reservada), con `reporte_ventas.ver` |
| Filtros extra | **Atajos de rango** (Hoy / Esta semana / Este mes), **subtotales por día** y **filtro por repartidor** (incluye "Oficina") |
| Resultados por vendedor | **Resumen por repartidor** del rango (agregado al revisar la fuente de julio: "resultados por vendedor y por día"; Roberto pidió "lo mejor para el proyecto y alineado a lo que ha dicho el cliente") |
| Tabla | **Bien alineada y ordenada** (pedido explícito): una sola tabla, columnas de ancho fijo, números a la derecha, espacio entre columnas |
| Lo que no entra | Filtro por status, gráficas, agrupar por semana o mes |

## 3. Reglas

- **Universo:** `venta_nota` viva (`deleted_at is null`) con `fecha between desde and hasta`, **cualquier status**
  (pagada, pendiente, abonado, cuenta perdida, promoción). Es un reporte de lo vendido, no de lo cobrado.
- **Sucursal = la de la venta** (`venta_nota.sucursal_id`), igual que la pantalla Ventas (T-17). Alcance con
  `resolverAlcance(usuario.codigo, normalizarSucursalPedida(q.sucursal))`.
- **Rango obligatorio**, máximo 366 días: `validarRango` de T-50 (`estadisticas/reglas-kilometraje.ts`), mismos mensajes.
- **Cantidad** = `sum(cantidad)` y **Promo** = `sum(cantidad_promocion)` de las líneas **vivas** de
  `venta_nota_detalle` (`deleted_at is null`). Una venta sin líneas vivas da 0 y 0.
- **Monto** = `venta_nota.monto_total` en **centavos enteros** con `aCentavos`. Una promoción suma $0.
- **Repartidor** = `vendedor.nombre`; venta sin vendedor (mostrador, `origen = 'portal'`) → `null` y la pantalla dice
  **"Oficina"**.
- **Factura**: `venta_nota.factura` `N/A` → "N/A"; `pendiente` → "Pendiente"; `facturada` → el número (`factura.numero`).
- **Semana** = `venta_nota.semana` (semana ISO que ya guarda cada venta).
- **Filtro de repartidor:** `repartidor=<uuid>` → solo las ventas de ese vendedor; `repartidor=oficina` → solo
  `vendedor_id is null`; sin el parámetro → todas. Cualquier otro valor → 400.
- **Agrupado:** por `fecha` ascendente; dentro del día por `folio` ascendente. Cada día lleva su subtotal (cantidad,
  promo, monto y número de ventas). Los días sin ventas no aparecen. Al final, el **TOTAL** del rango.
- **Resumen por repartidor:** una fila por repartidor que tenga ventas en el resultado (Oficina incluida, como `null`),
  con ventas, cantidad, promo y monto. Orden: monto desc, luego nombre ("Oficina" al final en empate). Respeta los
  mismos filtros (si se filtró un repartidor, el resumen tiene una sola fila). La suma del resumen = TOTAL.

## 4. Backend

### 4.1 Endpoint

`GET /reportes/ventas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&sucursal=<codigo|todas>&repartidor=<uuid|oficina>` en
`modules/estadisticas/` (el mismo `ReportesController` de T-50, nuevo handler), con
`@RequierePermiso('reporte_ventas.ver')`. Solo lee. Archivos nuevos: `reporte-ventas.service.ts`,
`reporte-ventas.repository.ts`, `reglas-reporte-ventas.ts` (+ `.spec.ts`), `dto/reporte-ventas.dto.ts`.

```ts
type ReporteVentas = {
  desde: string; hasta: string;
  dias: DiaDeVentas[];
  porRepartidor: RepartidorEnReporte[];
  total: TotalVentas;
};
type RepartidorEnReporte = { vendedorId: string | null; repartidor: string | null } & TotalVentas; // null = Oficina
type DiaDeVentas = { fecha: string; ventas: VentaEnReporte[]; subtotal: TotalVentas };
type TotalVentas = { ventas: number; cantidad: number; promocion: number; montoCentavos: number };
type VentaEnReporte = {
  id: string; fecha: string; folio: string; cliente: string; numNota: string | null;
  repartidor: string | null;      // null = Oficina
  status: 'pagada' | 'pendiente' | 'abonado' | 'cuenta_perdida' | 'promocion';
  factura: string;                // 'N/A' | 'Pendiente' | número
  semana: number;
  cantidad: number; promocion: number; montoCentavos: number;
};
```

- **Repositorio:** una consulta con las ventas planas del rango (piezas sumadas en un `left join lateral` sobre
  líneas vivas, factura con `left join factura`), filtradas por alcance y repartidor.
- **Reglas puras** (`reglas-reporte-ventas.ts`): agrupar por día, ordenar, sumar y armar el resumen por repartidor.
  Sin base de datos. (La fila plana del repositorio trae `vendedorId` para agrupar; `VentaEnReporte` no lo expone.)
- **DTO:** `desde`/`hasta` con el mismo formato que Kilometraje; `sucursal` opcional; `repartidor` opcional, `IsUUID` o
  `'oficina'`.

### 4.2 Pruebas

- Unitarias de las reglas: agrupado por día, orden por folio, subtotales, total, resumen por repartidor (Oficina,
  orden, suma = total), lista vacía.
- e2e contra Postgres local (sucursal propia de la suite, como T-22, para totales exactos):
  - todos los status entran; una venta eliminada no;
  - una línea borrada no suma piezas; una venta sin líneas vivas da 0;
  - venta de mostrador con `repartidor: null`; filtro por vendedor y por `oficina`; `repartidor` inválido → 400;
  - factura `N/A`, `Pendiente` y con número;
  - días fuera del rango no entran; rango > 366 días → 400; fechas invertidas → 400;
  - alcance: usuario atado a una sucursal no ve otra; pedir otra → 403;
  - sin `reporte_ventas.ver` → 403; con la excepción en `usuario_permiso` → 200; sin sesión → 401.

## 5. Portal

### 5.1 Ruta

`/operacion/reporte-de-ventas` (hoy `Placeholder`): server component delgado con `key={sucursal}` +
`PantallaReporteVentas`. Cliente HTTP y Excel en `apps/portal/src/lib/reporte-ventas.ts`.

### 5.2 Filtros (una fila)

- **Desde / Hasta** (`type="date"`), por defecto hoy en Tijuana (`hoyEnTijuana`).
- **Atajos**: "Hoy" (hoy–hoy), "Esta semana" (lunes a domingo de la semana de hoy), "Este mes" (día 1 al último día
  del mes). Solo llenan las fechas; no consultan.
- **Repartidor**: "Todos", "Oficina" y los vendedores de `GET /vendedores?sucursal=` (activos e inactivos; los
  inactivos con " (inactivo)"). Si la lista no carga, el filtro queda en "Todos" y el reporte sigue sirviendo.
- **Mostrar** y **Exportar a Excel** (deshabilitado sin resultados o mientras carga).
- Nada se consulta al abrir. Si "Desde" > "Hasta": "La fecha inicial no puede ser posterior a la final." y no consulta.

### 5.3 Tabla (bien alineada y ordenada)

- **Una sola `<table>`** para todo el rango (nunca una tabla por día), `table-fixed` con un ancho por columna, para que
  las columnas queden alineadas en todos los días.
- **Columnas y orden:** Fecha · Folio · Cliente · # nota · Repartidor · Status · Factura · Semana · Cantidad · Promo ·
  Monto.
- **Alineación:** texto a la izquierda; Semana, Cantidad, Promo y Monto a la derecha con `tabular-nums`. Todas las
  celdas con el mismo relleno horizontal para que ninguna columna quede pegada a otra.
- **Cabe en laptops (enmienda al implementar, 2026-10-14):** el portal se usa en computadora, así que la tabla debe
  caber sin desplazarse desde **1366 px** de ventana. Quedó con letra de 13 px, `px-2`, anchos de columna medidos
  sobre el texto real en el navegador y `min-w-[60rem]` (Cliente ≥ ~150 px); en ventanas más angostas se desplaza
  dentro de su propia caja, nunca la página. Medido: 1366 cabe, 1280 se desplaza 34 px.
- **Fila de subtotal por día** ("Total 13/10/2026"), en negrita con borde arriba: cantidad, promo y monto bajo sus
  columnas. **Fila TOTAL** al final, más marcada (borde doble o fondo).
- **Encabezado fijo** (`sticky top-0`) al hacer scroll.
- **Cliente** largo: `truncate` con el nombre completo en `title`.
- **Resumen** arriba de la tabla: "N ventas · X piezas · Y promo · $Z".
- **Resumen por repartidor**, entre el resumen y la tabla de ventas: una tabla chica con las mismas reglas de
  alineación (Repartidor · Ventas · Cantidad · Promo · Monto), "Oficina" para `null`.
- Fechas `dd/mm/aaaa`; Repartidor `null` → "Oficina"; # nota `null` → "—".

### 5.4 Estados

- Sesión cargando → "Cargando…". Sin `reporte_ventas.ver` → "No tienes permiso para ver el reporte de ventas" (y no
  pide nada, ni vendedores).
- Sin ventas → "No hay ventas en ese rango."
- Error → el mensaje del servidor (`mensajeDe`) en `role="alert"`.
- Al volver a consultar con resultados en pantalla → "Actualizando…" y tabla atenuada (`aria-busy`).
- Solo la última consulta escribe (una lenta que llega tarde no pisa a la nueva).

### 5.5 Excel

`exportarExcel` de T-15 con lo **consultado** (no lo que esté escrito en los filtros ahora):

- Título "Reporte de Ventas"; filtros: Rango (dd/mm/aaaa a dd/mm/aaaa), Sucursal (`etiquetaSucursal`), Repartidor
  ("Todos", "Oficina" o el nombre).
- Las mismas 11 columnas; Fecha tipo `fecha`, Monto tipo `pesos`, Semana/Cantidad/Promo tipo `numero`.
- Filas de venta; fila `subtotal` por día ("Total dd/mm/aaaa"); fila `total` ("TOTAL").
- Después del TOTAL, una fila vacía, una fila `grupo` "Resumen por repartidor" y una fila por repartidor: en la columna
  Cliente "<repartidor> (N ventas)" (u "Oficina (N ventas)"), y Cantidad, Promo y Monto en sus columnas, para que
  cuadren con el TOTAL y se puedan sumar en Excel.
- Archivo `reporte-ventas_<desde>_a_<hasta>`.

### 5.6 Pruebas de pantalla (T-65)

- Atajos: "Esta semana" empieza en lunes (incluido un domingo y un cambio de mes), "Este mes" termina en el último día
  (incluido febrero).
- Fechas invertidas → aviso y sin consulta.
- Pinta ventas, subtotal por día, TOTAL y resumen por repartidor; "Oficina" y "—".
- Repartidor elegido viaja en la consulta (`oficina` y uuid).
- Respuesta vieja no pisa a la nueva; "Actualizando…" al reconsultar.
- Excel recibe la definición de lo consultado.
- Sin permiso → mensaje y ninguna petición; sesión cargando → "Cargando…".

### 5.7 Prueba a mano

En navegador contra la base **local**, con capturas, revisando a propósito la alineación de la tabla (varios días,
nombres largos, montos de distintos tamaños, venta de mostrador, factura con número).

## 6. Vault (al terminar)

- `Estadísticas y Reportes.md`: callout de T-49 (reglas de §3) y cerrar la duda "por día, semana y mes" (atajos +
  subtotal por día); las dos advertencias del sistema viejo quedan resueltas.
- `Estado del proyecto.md`: fila T-49. Bitácora del día. Sin ADR.

## 7. Fuera de alcance

- Filtro por status, gráficas, agrupar por semana o mes, comparar contra otro periodo, ventas por producto (la fuente
  de la app lo menciona como idea: "por producto").
- **Merma y promociones por producto y día** (sección del reporte viejo "Resultados por día"): la merma aún no existe
  en el sistema (T-35). Cuando exista, se evalúa agregarla aquí mostrando solo productos con registro (petición v2.0).
- Reporte de Clientes nuevos (#51), Análisis Cliente (#52), consolidación v2.0 del filtro (#59).

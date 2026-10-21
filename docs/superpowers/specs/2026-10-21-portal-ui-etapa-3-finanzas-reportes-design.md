# Portal · UI parejo, Etapa 3 (Finanzas e informes) — Diseño

**Fecha:** 2026-10-21 · **Estado:** aprobado en conversación por Roberto
**Base:** [Etapa 1](2026-10-20-portal-ui-etapa-1-design.md) (PR #144) y [Etapa 2](2026-10-21-portal-ui-etapa-2-catalogos-design.md)
(PR #145): piezas comunes de `components/ui/` (incluidas `Ventana` y `Ayuda`), regla de formularios y movimiento. Sin
ticket de GitHub.

## 1. Para qué y alcance

Pasar las pantallas de finanzas e informes a las piezas comunes, como ya están Ventas, Cobranza y los catálogos:

- **Tesorería** (`components/tesoreria/`, pestañas Tesorería · Movimientos · Cuentas · Saldos) y sus 3 `window.confirm`.
- **Flujo de Efectivo** (`components/flujo-efectivo/`).
- **Cuentas por Cobrar** (`components/cuentas-por-cobrar/`).
- **Reporte de Ventas** (`components/reporte-ventas/`).
- **Reportes** (la lista, `reportes/lista-reportes.tsx`) y **Clientes nuevos** (`reportes/pantalla-clientes-nuevos.tsx`,
  `reportes/tabla-clientes-nuevos.tsx`). Kilometraje ya se pasó en la Etapa 1.

La Etapa 4 (Registrar venta, Promociones, Ruta diaria) es otro PR. Recarga y Gastos son de Mario y no se tocan.

**Qué no cambia:** ningún cálculo ni número, ningún endpoint, el backend, la base, la app, lo que exporta cada Excel
(`lib/excel/`) y los textos de negocio (etiquetas de campos, validaciones, mensajes del servidor, textos de "vacío").

## 2. Decisiones (Roberto, 2026-10-21)

| Tema | Decisión |
|---|---|
| Partición | Un solo PR con las 5 pantallas. |
| Formularios de Tesorería | Regla de la Etapa 2: **alta y edición de Cuentas en `Ventana`**. |
| Movimientos | **"Registrar operación" se queda fijo arriba** (para capturar varios seguidos); **"Editar" abre una `Ventana`**, así el formulario de arriba ya no cambia de papel. |
| Saldos | La rejilla de saldos del día se sigue editando en su lugar (guarda en lote); solo cambia el marco. |
| Destinos de la cobranza | Se quedan como están (una lista por renglón con su "Guardar"); solo cambia el marco. |

## 3. Reglas que aplican a todas

- **`Pantalla` > `EncabezadoPantalla`** (título + línea de §3.1 + botones a la derecha). Se quitan `Card`/`CardHeader`.
- **Estados con `EstadoPantalla`** (cargando, sin permiso, elige sucursal) con el texto común; errores con
  `Aviso tono="error"` y avisos de éxito con `Aviso tono="exito"`.
- **Filtros de fechas con `FiltroFechas`** (Desde, Hasta, atajos Hoy · Ayer · Esta semana · Este mes, botón **Mostrar**,
  validación común "La fecha inicial no puede ser posterior a la final."). Si la pantalla tenía su propio tope de días o
  su propio mensaje, se conserva.
- **Excel con `BotonExcel`** ("Exportar a Excel" / "Exportando…"), con la misma definición de hoy.
- **Tablas con `CajaTabla` + `Tabla`/`Th`/`Td`/`TdMonto`/`Fila`/`FilaVacia`/`FilaTotal`/`FilaGrupo`.** Montos a la
  derecha con `TdMonto` o `Monto` (negativos en rojo); fechas con `Fecha`/`formatearFecha`. Donde una tabla ya tiene
  anchos medidos para 1366 px (Reporte de Ventas, `table-fixed` + `colgroup`), se conservan.
- **Confirmar con `useConfirmar()`**, nunca `window.confirm`.
- **Campos con `Campo` + controles comunes**, ids y etiquetas iguales; "(opcional)" solo donde el campo ya lo es.

### 3.1 Líneas de descripción

Revisables por Roberto en el PR. Describen lo que la pantalla ya hace.

| Pantalla | Descripción |
|---|---|
| Tesorería | Las cuentas del negocio con su saldo, sus depósitos, retiros y traspasos, y la cobranza que entra sola. |
| Flujo de Efectivo | Ventas, cobranza, gastos y utilidades de un rango de fechas. |
| Cuentas por Cobrar | Cuánto debe cada cliente, con sus notas pendientes y vencidas. |
| Reporte de Ventas | Las ventas de un rango, por día y por vendedor. |
| Reportes | Los reportes del negocio que se pueden consultar y exportar a Excel. |
| Clientes nuevos | Los clientes dados de alta en un rango y quién los dio de alta. |

## 4. Tesorería

- Encabezado común; las pestañas hechas a mano pasan a **`Pestanas`** (base-ui `Tabs`), conservando: solo las que el
  usuario puede ver, la pestaña en `?vista=` de la URL y que la vista principal no se desmonte (para no perder su rango).
- **Tesorería (vista):** `FiltroFechas` para su rango; las tablas "Tesorería por cuenta" y "Movimientos del rango" a la
  tabla común con montos alineados y "Sin saldo inicial" donde hoy lo dice.
- **Movimientos:** "Registrar operación" fijo arriba con campos comunes (solo registra). "Editar" en cada renglón abre
  `Ventana` con el mismo formulario en modo edición (título de hoy: "Editar depósito", etc.). Filtro de fechas común;
  tabla común. "Eliminar" con `useConfirmar` (texto de hoy repartido en título y línea, botón "Eliminar movimiento").
- **Cuentas:** como un catálogo de la Etapa 2: tabla común, "Nueva cuenta"/"Editar" en `Ventana`, "Eliminar" con
  `useConfirmar` ("¿Eliminar la cuenta "X"?" / "Su historia se conserva, pero ya no aparecerá en la Tesorería." /
  "Eliminar cuenta"). Puede usar `PantallaCatalogo` si encaja sin forzarla; si no, las mismas piezas a mano.
- **Saldos:** su campo de fecha con `Campo`; las tablas "Saldos del día" y "Saldos fijados" a la tabla común, la
  rejilla sigue editable en su lugar. "Eliminar" un saldo con `useConfirmar` ("¿Eliminar el saldo de "X" del
  dd/mm/aaaa?" / "La Tesorería volverá a usar el anterior." / "Eliminar saldo").
- **Destinos de la cobranza:** tabla común; sus listas con `Lista`.

## 5. Flujo de Efectivo, Cuentas por Cobrar, Reporte de Ventas, Reportes y Clientes nuevos

- **Flujo de Efectivo:** `FiltroFechas` + `BotonExcel`; sus 4 tablas (resumen "Flujo de Efectivo", "Desglose por día",
  "Comentarios de ingresos", "Comentarios de egresos") a la tabla común con sus `aria-label` de hoy; los subtítulos `h3`
  se quedan.
- **Cuentas por Cobrar:** encabezado, su filtro con `Campo`, `BotonExcel`; la tabla y su detalle desplegable a la tabla
  común (`Fila interactiva` en la fila que se despliega).
- **Reporte de Ventas:** `FiltroFechas` con la lista de repartidor a su lado (`Campo` + `Lista`), `BotonExcel`; las dos
  tablas a la tabla común conservando `table-fixed`, `colgroup` y `min-w` medidos en T-49.
- **Reportes:** encabezado común; cada reporte como un renglón o tarjeta sencilla con su nombre (enlace) y su
  explicación de hoy.
- **Clientes nuevos:** `FiltroFechas` + `BotonExcel`; tabla común.

## 6. Pruebas y revisión

- Las pruebas de pantalla existentes siguen pasando; donde cambia algo a propósito (botón "Consultar"/"Buscar" →
  **Mostrar**, `window.confirm` → `alertdialog`, editar movimiento en `dialog`) se ajustan en el mismo commit.
- Pruebas nuevas: editar un movimiento abre la ventana y "Registrar operación" no cambia de papel; las 3 confirmaciones
  de Tesorería (confirmar y cancelar); las pestañas comunes conservan `?vista=` y solo muestran las permitidas.
- `npm test --workspace=apps/portal`, `tsc --noEmit`, lint y `next build` limpios.
- Navegador a **1366 y 1920 px** contra la base **local** (usuarios `revision` y `revision-tj`), sin desplazamiento
  horizontal de la página; Reporte de Ventas y Tesorería con datos.
- Al terminar: CLAUDE.md (quitar estas pantallas de "Siguen con el estilo de antes") y el vault ([[Portal Web]] y
  bitácora).

## 7. Fuera de alcance

Cambiar cálculos, columnas o lo que exporta un Excel; gráficas o tarjetas de indicadores nuevas; la Etapa 4.

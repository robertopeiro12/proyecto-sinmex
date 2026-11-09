# Dashboard y Flujo diario — diseño

Fecha: 2026-11-09 · Autor: Claude con Roberto · Estado: revisado por un constructor; para aprobación de Roberto

Maquetas aprobadas por Roberto (ábrelas en el navegador):

- [`maqueta-dashboard.html`](2026-11-09-dashboard-flujo-diario/maqueta-dashboard.html)
- [`maqueta-flujo-diario.html`](2026-11-09-dashboard-flujo-diario/maqueta-flujo-diario.html)

Fuentes en el vault: `10-Dominio/Sistema viejo del cliente.md` (qué muestra hoy el sistema del cliente, revisado
pantalla por pantalla el 2026-11-07 y 2026-11-09), `00-Inicio/Estado del proyecto.md` (sección "Replanteamiento
noviembre 2026", pieza 1) y `ADR-0015`.

---

## 1. Para qué y por qué

El tío de Roberto administra a los vendedores con dos pantallas de su sistema actual (`sistema.jawa.mx`):

1. **En la mañana** abre el *Reporte de Ventas*, se va al **día anterior** y revisa "qué hicieron estos vendedores".
2. **Durante el día** vive en el *Dashboard*: lo que lleva cada vendedor **hoy**, en vivo.

Las dos tienen datos que les sirven, pero el sistema viejo es lento, tiene fallas (la pestaña "Resultados por día"
no carga sola, botones escondidos cuando el valor es 0, columnas que se cortan) y no maneja varias sucursales con un
solo usuario. El portal nuevo necesita esas dos pantallas, **separadas** (para que se sientan familiares), con **los
mismos datos y la misma estructura**, pero con **el diseño de nuestro portal** y funcionando bien.

Es la pieza 1 del MVP de mediados de diciembre de 2026.

## 2. Metas, no-metas y anti-metas

**Metas**

- Pantalla **Dashboard** (`/operacion`): hoy, en vivo, un renglón por vendedor, detalle al picar.
- Pantalla **Flujo diario** (reemplaza a *Reporte de Ventas*, `/operacion/reporte-de-ventas`): días pasados, abre en
  **ayer**, pestañas *Por vendedor* y *Por día*, detalle al picar.
- Los mismos datos y la misma organización que el sistema viejo (sección 5), con las mejoras acordadas.

**No-metas (fuera de esta pieza)**

- Inventario: la columna existe y dice "Pronto". Todo lo de inventario espera el documento del tío (TBC).
- Recargas: fuera del Dashboard (decisión del cliente).
- Buscar vendedor y la campana de notificaciones: fuera por ahora.
- Exportar a Excel: **no** va en estas pantallas; "los Excel van en el otro apartado" (Información › Reportes,
  pieza 4).
- Notas asignadas (la oficina le asigna al vendedor notas por cobrar): es la pieza 6, toca la app de Mario. Aquí se
  deja el lugar (sección 6).
- Mermas, cambios y consumos: no existen todavía en la base (no hay tabla; la operación `merma` del push no se
  proyecta). Aquí se deja el lugar (sección 6).
- Chatbot de reportes, SIG (eliminado), Análisis Cliente.

**Anti-metas (sería un fracaso aunque funcione)**

- Que se vea como el sistema viejo (iconos, ventanas modales oscuras, encabezados negros). Roberto fue claro: del viejo
  se toman **datos y estructura**, nunca el aspecto.
- Que "hoy" o "ayer" salgan mal por la zona horaria (ver sección 3).
- Que los totales de una pantalla no cuadren con su detalle, o que Tesorería del Dashboard y del Flujo diario den
  distinto para el mismo vendedor y día.

## 3. Restricciones

- **Fechas en Tijuana, siempre.** "Hoy" del Dashboard y "Ayer" del Flujo diario se calculan con `hoyEnTijuana()` y
  `diaAnterior()` (`apps/portal/src/lib/ventas.ts`, `lib/fechas.ts`), nunca con la hora del navegador ni con UTC. La
  Mac de Roberto está en hora de Europa: de 0:00 a 9:00 de su hora, en Tijuana todavía es el día anterior. Los datos se
  filtran por `fecha` / `fecha_pago` / `fecha_operacion` (fecha de Tijuana que calcula la tablet), nunca re-derivando
  de `created_at`. El backend usa su `hoyEnTijuana()` cuando necesite "hoy". Debe haber pruebas con una hora en la que
  Tijuana y UTC (y Europa) caen en días distintos.
- **Sucursal: la de la barra lateral** (`?sucursal=`; el servidor decide el alcance). Sin filtro propio.
- **Diseño del portal**: `components/ui/` (`EncabezadoPantalla`, `FiltroFechas`, `Pestanas`, `Tabla`/`Th`/`Td`/
  `CajaTabla`/`FilaTotal`/`FilaGrupo`, `Etiqueta`, `Monto`, `Fecha`, `Aviso`, `EstadoPantalla`), colores y letra de
  `globals.css`. Ver la regla "Portal UI" de `CLAUDE.md`.
- **Ancho**: las tablas tienen muchas columnas. Roberto aceptó que se desplacen a la derecha dentro de su caja
  (`CajaTabla`) en vez de quitar o partir columnas. Probar a 1366 px y 1920 px.
- **Datos vivos**: toda lectura filtra `deleted_at is null` en ventas, líneas, abonos, cobros, gastos, visitas y
  jornadas (regla de T-17/T-34 en `CLAUDE.md`). Un cobro de origen `saldo_favor` **no** es dinero nuevo y no cuenta en
  Cobranza ni Tesorería.
- **Solo lectura**, salvo lo que diga la sección 6 (revisión de notas, pieza 6).
- Portal = Roberto; nada de esta pieza toca `apps/tablet`.

## 4. Lo que decidió Roberto (con el tío)

Pantallas y forma

1. Dos pantallas separadas: **Dashboard** (hoy) y **Flujo diario** (días anteriores; el renombre de "Reporte de
   Ventas"). Mismo diseño entre ellas.
2. Del viejo, **solo datos y estructura**; el diseño es el del portal. Maquetas aprobadas: las de arriba.
3. El detalle se abre **debajo del renglón**, en pestañas (una por cada "ventanita" del viejo), al picar el vendedor o
   un número.
4. **"Todas" las sucursales** en la barra lateral: la tabla se parte en **un bloque por sucursal** con su subtotal, y
   un total general al final (opción B). En el Dashboard, además, un cuadro de totales por sucursal arriba. Con una
   sola sucursal, sin bloques.
5. Columnas separadas: en el Dashboard **Vendedor | Ruta asignada | Vehículo**; en el Flujo diario **Fecha | Vendedor
   | Ruta asignada** (sin vehículo).
6. Sin Excel, sin Buscar vendedor, sin campana, sin Recargas. Inventario: columna con "Pronto".
7. **Venta general** se abre con un selector **Por producto | Por cliente**: por producto agrupado por presentación con
   una barrita proporcional; por cliente con cliente, folio, piezas, total y contado/crédito, y la nota se abre a sus
   productos.

Cobranza, Liquidada y Corte (respuesta del tío, 2026-11-09: "tal cual, pero que funcione")

8. En la tabla, **Cobranza** es un solo total. El detalle la divide en **Ventas de contado** y **Notas de días
   anteriores**, cada folio con su columna **Liquidada**.
9. **Liquidada**: "**Sí**" si ese pago dejó la nota en cero; "**Abonado** · resta $X" si quedó saldo. `$X` es el saldo
   **que quedó después de ese pago** (`cobranza_abono.saldo_pendiente`), no el de hoy, para que un día pasado no cambie.
10. **Corte** (Dashboard, solo cuando el vendedor terminó su ruta): Ventas de contado + Notas de días anteriores − Gasto
    = **Tesorería**. Sin capturar lo entregado ni diferencias (Roberto aprobó la maqueta así).
11. Pagar el mismo día una nota de crédito de hoy "es muy raro"; si pasa, ese pago cae en **Notas de días anteriores**.
12. La cobranza de *Por vendedor* es la de los vendedores; la de *Por día* **suma también la de la oficina** (cobros sin
    vendedor), igual que el viejo. Un aviso lo explica en pantalla.

## 5. Las pantallas, dato por dato

Notación: **[viejo]** = así lo muestra el sistema actual; **(decisión de Claude)** = no lo dijo Roberto, es mi
propuesta y él la revisa al leer.

### 5.1 Definiciones comunes (un vendedor, un día)

| Dato | De dónde sale |
|---|---|
| Ventas del día | `venta_nota` vivas con `vendedor_id` = vendedor y `fecha` = día (cualquier status). |
| **Venta general (piezas)** | Suma de `venta_nota_detalle.cantidad` de líneas vivas de esas ventas. **Sin** piezas de promoción (igual que T-49). |
| **Monto** | Suma de `venta_nota.monto_total` de esas ventas. |
| **Ventas de contado** (cobranza) | Abonos vivos de origen `venta_contado` de las ventas del día. |
| **Notas de días anteriores** (cobranza) | Abonos vivos de origen `cobro` (con su `cobro` vivo) cobrados por el vendedor con `fecha_pago` = día, que no son de origen `saldo_favor`. Incluye pagos a notas de hoy a crédito (punto 11). |
| **Quedó a favor del cliente** | Si un cobro trae más de lo que debían las notas, el sobrante va a `saldo_favor_movimiento` y no tiene abono. El vendedor sí trajo ese dinero, así que **cuenta** en Cobranza y Tesorería y sale en el detalle de Cobranza como su propio renglón (cliente, monto), para que el detalle sume el total. En la práctica: Notas de días anteriores + a favor = suma de `cobro.monto` vivos de origen `cobro` del vendedor ese día, la misma cifra que lee hoy `tesoreria/cobranza-tesoreria.repository.ts`. (decisión de Claude) |
| **Cobranza** | Ventas de contado + Notas de días anteriores + Quedó a favor. **Todos los métodos de pago** (efectivo, transferencia, cheque), como el viejo (Roberto, 2026-11-09). En el detalle, cada pago dice su método con una `Etiqueta` para que se distinga una transferencia. |
| **Gasto** | `gasto` vivos del vendedor con `fecha` = día. |
| **Tesorería** | Cobranza − Gasto (todos los métodos). |
| **Liquidada** | Por abono: `saldo_pendiente = 0` → "Sí"; si no, "Abonado" con `saldo_pendiente`. (Un cobro que reparte en varias notas da un renglón por nota.) |
| **Visitas** | Clientes con venta (vendió: Sí; hora = `sync_operacion.ocurrido_en` de esa venta) + `visita` (vendió: No; hora `visitada_en`, motivo, atendió, comentario = `observaciones`). Columnas [viejo]: Cliente · Vendió · Hora · Motivo · Atendió · Comentario. |
| **Ruta (x / y)** | x = clientes de su ruta diaria (`ruta` viva, `tipo = 'diaria'`, esa fecha) atendidos (venta o visita); y = clientes en esa ruta. (decisión de Claude: los atendidos fuera de ruta se ven en Visitas pero no suben x.) |
| **Ruta asignada** | Nuestra ruta diaria no tiene nombre. Por ahora: "Ruta del día · N clientes" (N = clientes de su ruta diaria; "Sin ruta" si no tiene). El nombre ("Ruta 4 Insurgentes") llegará con Rutas semanales, que es de donde sale en el viejo (Roberto, 2026-11-09). Sin migración. |
| **Vehículo** | En este orden: (1) el vehículo que la oficina le asigne en Ruta diaria, **si** se agrega esa asignación (pendiente: Roberto lo está aclarando; en el viejo se asignaba ahí); (2) `jornada.vehiculo_id` del día, que llega al cerrar; (3) "—". Esta pieza no agrega la asignación ni toca la app; solo deja la lectura lista para (1). |
| **Promociones** | `venta_nota_promocion` (y `cantidad_promocion` de las líneas) de las ventas del día, por cliente. |

Montos en centavos enteros en la API, como el resto del portal.

### 5.2 Dashboard (`/operacion`)

- `EncabezadoPantalla` "Dashboard" + una línea: "Lo que llevan hoy los vendedores en ruta…". A la derecha, "Hoy,
  lunes 9 de noviembre · se actualiza solo · hace N min".
- **Se actualiza solo** cada 60 s mientras la pestaña está visible (decisión de Claude), sin perder el renglón ni la
  pestaña de detalle abiertos.
- **Resumen** (una fila de cifras): Venta general (pzs), Monto, Cobranza, Gasto, **Tesorería**, Vendedores (cuántos y
  "3 en ruta · 1 terminó · 1 sin salir"). Con "Todas": un resumen por sucursal y uno total.
- **Quiénes salen** [viejo: "Vendedores en ruta"]: vendedores activos de la sucursal con ruta diaria hoy **o** con
  cualquier movimiento hoy (venta, cobro, visita, gasto, jornada) (decisión de Claude). Sin ninguno: `EstadoPantalla`
  / "No hay vendedores en ruta hoy".
- **Columnas** (en este orden): Vendedor · Ruta asignada · Vehículo · Inventario ("Pronto") · Mermas, cambios, promos
  (botón "Ver") · Venta general (número que se pica) · Cobranza · Gasto · Notas de venta ("Ver") · Notas ant.
  asignadas (número) · Ruta (x / y con barrita) · Estatus · Corte ("Ver" si terminó; "—" si no).
- **Estatus** (`Etiqueta`): *Terminó* (éxito) si tiene `jornada` del día; *En ruta* (información) si tiene algún
  movimiento hoy y no ha cerrado; *No ha salido* (advertencia) si no tiene ninguno. (decisión de Claude: la jornada
  abierta no llega al servidor hasta T-43, así que "En ruta" se deduce de los movimientos.)
- **Pestañas del detalle**: Venta general · Cobranza · Gastos · Notas de venta · Visitas · Mermas, cambios y
  promociones · Corte · Inventario (pronto, deshabilitada).
- **Notas de venta**: ver sección 6.

### 5.3 Flujo diario (`/operacion/reporte-de-ventas`, renombrado)

- En el menú: "Flujo diario" en lugar de "Reporte de Ventas" (misma dirección o una nueva con redirección: lo decide el
  constructor; el título de la pestaña del navegador cambia).
- `EncabezadoPantalla` "Flujo diario" + "Qué hizo cada vendedor en días pasados…".
- `FiltroFechas` (Desde, Hasta, Hoy · Ayer · Esta semana · Este mes, Mostrar) + selector **Vendedor** (Todos / uno).
  Abre en **Ayer** (de Tijuana) y consulta sola al entrar.
- **Resumen** del periodo: Venta general, Monto, Cobranza, Gasto, Tesorería, Visitas (x / y y número de rutas).
- **Pestaña "Por vendedor"** — un renglón por vendedor y día; columnas: Fecha · Vendedor · Ruta asignada · Venta
  general · Monto · Cobranza · Gasto · Tesorería · Notas de venta · Ruta ("Ver") · Mermas, cambios, promos ("Ver") ·
  Inventario ("Pronto"). Renglón de total. Detalle: las mismas pestañas del Dashboard **sin** Corte y con Notas de
  venta solo de consulta.
- **Pestaña "Por día"** — un renglón por día (con "Todas": por día dentro de cada bloque de sucursal); columnas [viejo]:
  Fecha · Rutas · Ventas (piezas) · Monto · Cobranza · Gastos · Tesorería · Mermas ("Ver") · Promociones ("Ver") ·
  Visitas / ruta · Inventario. Renglón de total. Detalle:
  - **Ventas** con selector Por presentación | Por producto | Por vendedor (vendedor + presentación) | Por cliente
    (cliente + presentación) [viejo].
  - **Cobranza**: Cobrador · Cliente · Folio · Importe · Liquidada; la oficina sale como "Oficina" [viejo].
  - **Gastos**: Vendedor · Descripción · Gasto. **Visitas**: Vendedor · Cliente · Vendió · Hora · Motivo · Comentario.
    **Mermas**, **Promociones**: Producto · Cantidad.
- **# Rutas** = vendedores con movimiento ese día (decisión de Claude; el viejo contaba rutas abiertas).
- **La oficina en "Por día"** (decisión de Claude): solo su **cobranza** se suma (cobros sin vendedor, por sucursal del cliente), como el viejo; Tesorería del día = cobranza de vendedores + oficina − gastos de los vendedores. Las ventas de mostrador (`vendedor_id` nulo) y los gastos de oficina **no** entran al Flujo diario: se ven en *Ventas* y *Finanzas › Gastos*. El selector de vendedor ya no tiene la opción "Oficina" que tenía T-49.
- El rango máximo es el mismo de T-49 (366 días).

## 6. Lo que depende de otras piezas

- **Notas de venta / Notas ant. asignadas (pieza 6).** El viejo muestra 5 listas: asignadas cobradas, nuevas por
  entregar, asignadas por entregar (las dos con casilla **Entregada** y **Guardar**), asignadas NO entregadas y nuevas
  NO entregadas. Hoy no existen ni las notas asignadas ni el registro de "entregada".
  **Propuesta (decisión de Claude):** en esta pieza la pestaña muestra las notas **nuevas a crédito del día** (folio,
  cliente, monto, pendiente) y la columna "Notas ant. asignadas" dice "—"; las listas de asignadas, la casilla
  Entregada y su guardado llegan con la pieza 6, que ya tiene el diseño de la maqueta.
- **Mermas, cambios y consumos (pieza 5, espera el documento del tío).** La pestaña muestra hoy las **promociones**
  por cliente (lo único que existe) con el diseño de la maqueta (un bloque por cliente; "Cambios / Cambios recibidos" y
  "Producto cambiado / Mermas recibidas" lado a lado; "Mermas de almacén" arriba; el consumo como "Cliente nuevo:
  Consumo"). Las secciones de merma y cambio aparecen cuando existan esos datos.
- **Inventario**: "Pronto" en columna y pestaña.

## 7. Respuestas de la revisión (2026-11-09)

Un constructor leyó este documento y preguntó cinco cosas:

1. **Tesorería y métodos de pago** → Roberto: **todo lo cobrado**, como el viejo.
2. **Ruta asignada** → Roberto: por ahora el número de clientes; el nombre con Rutas semanales.
3. **Vehículo antes de cerrar** → Roberto cree que se asigna en Ruta diaria o semanal y lo está aclarando; mientras,
   la regla de la sección 5.1.
4. **Pago de más (saldo a favor)** → decisión de Claude: cuenta, con su renglón en el detalle.
5. **La oficina en "Por día"** → decisión de Claude: solo su cobranza (sección 5.3).

**Pendiente de Roberto** (no bloquea el plan): si el vehículo se asigna en Ruta diaria.

## 8. Lo que se deja al constructor

- Endpoints, forma de la API y si se reutiliza o se reemplaza `GET /reportes/ventas` (T-49) y
  `estadisticas/reglas-reporte-ventas.ts`. Las reglas de cálculo van en funciones puras con pruebas, como el resto
  del backend.
- Permiso del Dashboard: propongo uno nuevo, `dashboard.ver` (grupo General), y que el Flujo diario conserve
  `reporte_ventas.ver` (decisión de Claude). Los permisos los asigna el cliente; no se tocan perfiles.
- Cómo se actualiza solo el Dashboard (consulta cada 60 s está bien; no hace falta tiempo real).
- Anchos de columna, orden de los renglones (propuesta: por nombre de vendedor; en el Dashboard, quizá por estatus).
- Rendimiento: el viejo tardaba mucho. Una consulta por pantalla y rango, sin N+1; el detalle puede pedirse al abrirlo.
- Después: actualizar en el vault la nota de dominio afectada y `Estado del proyecto`, y `CLAUDE.md` (bloque Reportes).

# Inventario por vendedor — diseño

Fecha: 2026-11-24 · Rama: `feature/inventario-por-vendedor` (sale de `feature/corte-por-tamano`, PR #163) · Solo portal
+ backend (Roberto). La tablet no cambia.

Fuentes (vault, `90-Fuentes/`):
- **Módulo de Producción e Inventarios 2026-11-16 (fuente)**, sección "Submódulo: Info de inventario x vendedor" con sus
  tablas "INVENTARIO" y "MERMA".
- **Respuestas del cliente 2026-11-18 Inventarios y Producción (fuente)** (la venta de la oficina a nombre del vendedor
  sí cuenta).

Se apoya en el corte por tamaño (`2026-11-18-corte-por-tamano-y-merma-design.md`): **misma cuenta**, mismos tamaños.

## Para qué

Segundo paso del módulo de Producción e Inventarios. El cliente quiere ver, de un día pasado o de hoy, qué pasó con el
inventario de cada vendedor: qué le cargaron, qué vendió, qué merma registró, qué debía regresar y qué regresó de verdad.
Hoy en el portal no existe: en el Dashboard y el Flujo diario la columna "Inventario" dice "Pronto" y la pestaña
"Inventario · pronto" del detalle del vendedor está apagada.

## Lo que dice el cliente (no se cambia sin preguntarle)

- **C1.** La misma información sale en el **Dashboard**, el **Flujo diario** y su propio submódulo de Producción.
- **C2.** Se elige la **fecha** y si es **general por sucursal** o **un vendedor**.
- **C3.** Se desglosan todos los productos, **separados por presentación** (tamaño).
- **C4.** Tres pestañas: **Inventario**, **Recargas** y **Merma** (nueva).
- **C5. Inventario** (su tabla "INVENTARIO"): Producto · *Operación del vendedor*: Piezas cargadas · Ventas · Merma
  registrada en sistema · Cambio físico entregado al cliente · Cambio físico recibido del cliente · Promoción · Consumo ·
  *Validación por almacén*: Piezas teóricas por regresar · Piezas reales retornadas · Resultado. "Merma registrada en
  sistema" = merma entregada al cliente + merma de almacén. Resultado positivo en rojo (se descuenta); negativo = error
  humano, sin restricción.
- **C6. Recargas** "tal cual se muestra hoy": Producto · Usuario recarga/respuesta · Piezas cargadas · Hora de recarga ·
  Estado.
- **C7. Merma** (su tabla "MERMA"), por presentación: *Operación del vendedor*: Merma recibida del cliente · Merma de
  almacén · *Validación por almacén*: Merma teórica por regresar · Merma real validada · Resultado. Teórica = recibida +
  almacén. Mismo criterio de resultado que el inventario.

## Decisiones de Roberto (2026-11-24)

- **R1. Cualquier fecha** (hasta hoy de Tijuana), abre en **hoy**, con atajos Hoy y Ayer.
- **R2.** En la pestaña Merma **se quita** la columna "Merma registrada en sistema" de la tabla del cliente: daba el mismo
  número que la merma teórica y su nombre significa otra cosa en la pestaña Inventario. En Inventario se queda, con un ⓘ
  que dice qué suma.
- **R3.** La columna "Inventario" del Dashboard y del Flujo diario muestra la **pastilla del corte** ("Sin corte",
  "Corte hecho", "Falta 1 · 1 de merma" en rojo, la misma de Producción → Corte). Al picarla abre la pestaña Inventario
  del detalle del vendedor.

## Decisiones mías (se pueden cambiar)

- **D1. Una sola cuenta.** Todo sale de `movimientosDelDia` + `armarCorte` (`produccion/reglas-corte.ts`): teórica,
  merma teórica, resultados, faltantes del día y tamaños. Nada se recalcula aparte. Ventas = todas las del vendedor ese
  día (app y portal a su nombre), como el corte.
- **D2. Dónde va.** *Producción → Inventario por vendedor* (`/produccion/inventario-vendedor`), entre Corte y Producción
  del día en el menú. Permiso **`inventario.ver`** ("Información de inventario", ya existe en la tabla `permiso`; sin
  migración).
- **D3. "Todos los vendedores"** = la suma, por presentación, de todos los vendedores de la sucursal con movimiento ese
  día. *Operación del vendedor* (cargadas, ventas, promoción, merma, consumo, cambios) suma a **todos**; la *Validación
  por almacén* (teóricas, reales y resultado) suma **solo a los vendedores con corte hecho**, para que teóricas − reales =
  resultado siempre cuadre (decisión de Roberto, 2026-11-24). Con **un solo vendedor** la teórica sale aunque no tenga
  corte, como en Producción → Corte. El pie "Faltantes del día" con "Todos" = suma de los faltantes (piezas y merma) del
  corte de **cada** vendedor con corte hecho (como `faltantesDeCortes` del Flujo diario): lo que sobra a uno no compensa lo
  que falta a otro (decisión de Roberto, 2026-11-24); `null` si ninguno tiene corte. Con "Todas" las sucursales se pide
  elegir una (como Corte con un usuario sin sucursal): la suma entre sucursales no tiene sentido para el almacenista.
- **D4. Resultados con corte sin hacer:** "Piezas reales retornadas", "Merma real validada" y los dos Resultado salen
  **vacíos** (no 0) si el corte de ese vendedor no está hecho, igual que en el corte. Con "Todos", un vendedor sin corte
  no aporta a la validación por almacén (ni teóricas, ni reales, ni resultado): esas celdas son `null` si ninguno con corte
  tuvo la presentación, y la tabla avisa "N vendedores sin corte: no entran en la validación por almacén.".
- **D5. Recargas:** una fila por línea de carga (presentación) de ese día, **todas** las cargas vivas (pendientes,
  aceptadas y rechazadas, con su estado; solo las aceptadas cuentan en Inventario). "Usuario recarga/respuesta" = quien la
  capturó; "Hora de recarga" = hora de captura (Tijuana, `hh:mm a. m./p. m.`); "Estado" = Pendiente / Aceptada /
  Rechazada (con el motivo debajo si se rechazó). Con "Todos", una columna más con el vendedor. Orden: hora, vendedor,
  producto.
- **D6. Dashboard y Flujo diario:** la pestaña "Inventario" del detalle del vendedor deja de estar apagada y muestra las
  mismas tres sub-pestañas para ese vendedor y día, pidiendo los datos al endpoint de esta pantalla. Sin el permiso
  `inventario.ver` la pestaña dice "No tienes permiso" (como cualquier pantalla). La columna del Flujo diario *Por día*
  (renglón = día de toda la sucursal) muestra la suma de los faltantes de ese día ("Faltan N · M de merma") sin abrir
  nada; vacía si no hay cortes hechos.
- **D7. Ancho:** la tabla de Inventario tiene 11 columnas; tiene que caber desde 1366 px (≈1012 px de caja) con
  `table-fixed` + `colgroup`, encabezado de dos niveles (*Operación del vendedor* / *Validación por almacén*) y la misma
  línea separadora entre bloques que el corte. Medir en navegador.
- **D8. Cambios físicos** salen en 0 hasta que la app los registre (T-33), con un ⓘ que lo dice.

## Contrato

`GET /inventario-vendedor?fecha=AAAA-MM-DD&sucursal=<código>&vendedor=<id|todos>` (permiso `inventario.ver`).
- Alcance como el corte: sucursal ajena = 403; vendedor ajeno o dado de baja = 404; fecha futura = 400 con
  `hoyEnTijuana`; fecha inválida = 400.
- Respuesta: `{ fecha, hoy, sucursal, vendedor: {id, nombre} | null, lineas: LineaInventario[], totales, recargas:
  RecargaInventario[], vendedoresSinCorte: number, corte: { estado, piezasFaltantes, mermaFaltante } | null }`.
  `LineaInventario` = los campos de `LineaCortePantalla` del corte (producto, volumen, cargadas, vendidas, regaladas,
  mermaEntregada, mermaRecibida, mermaAlmacen, consumo, cambios, deberiaRegresar, buenas, faltante, merma, mermaTeorica,
  resultadoMerma). `corte` solo con un vendedor (con "todos", `null`).
- `FilaVendedorDia` (Dashboard y Flujo diario) agrega `corte: { estado, piezasFaltantes, mermaFaltante }` con la regla
  de `CortesService.lista`; la fila por día del Flujo agrega `faltantesCorte: { piezas, merma } | null`.
- Tipos duplicados en el portal (`lib/inventario-vendedor.ts`, `lib/flujo-diario.ts`) en el mismo commit.

## Fuera de alcance

Registro de Operación, Procesos, los inventarios de PT, Información de Producción, motivos de merma (T-81) y cambios
físicos en la app. No se toca la pestaña "Mermas/Cambios/Promociones" existente.

## Pruebas

- Reglas puras de la suma "Todos" (D3, D4) y del texto de la hora/estado de recargas.
- e2e: un vendedor; "todos" suma y respeta D4; recargas con los tres estados y el motivo; alcance 403/404; fecha futura;
  `FilaVendedorDia.corte` en Dashboard y Flujo diario.
- Portal: las tres pestañas, encabezados exactos, ⓘ, separador, vacío sin corte, pastilla en la columna Inventario que
  abre la pestaña, "No tienes permiso".
- Navegador a 1366 y 1920 px con datos de la base local.

# Corte de mercancía — diseño

Fecha: 2026-11-12 · Portal (Roberto) + backend · Sin cambios en la tablet. Pieza 3 del MVP ("corte de devolución").

## 1. Para qué

En la tarde, cuando el vendedor regresa a la planta, el almacenista (o Administración si están ocupados) cuenta lo que
trae de vuelta: piezas **buenas** (se venden al día siguiente) y **merma**. Hoy lo anotan en papel (formato de
entradas/salidas de almacén), firman los dos y, según el tío, lo pasan al portal viejo en *Producción → Corte*. El
sistema compara lo que **debería regresar** contra lo que **se contó** y marca en rojo lo que falta; Administración se lo
descuenta al vendedor por fuera.

Fuentes:
- Respuestas del tío: vault `90-Fuentes/Respuestas del cliente 2026-11-12 Corte de mercancía (fuente).md` (R-1 a R-5).
- Cómo lo hace el viejo: vault `10-Dominio/Sistema viejo del cliente.md`, sección "Corte de mercancía y petición de
  retorno". En 3 semanas de TJ hubo **0 cortes guardados**: el viejo es guía, no plano.
- Lo que ya existe: *Producción → Retorno* (spec `2026-10-22-retorno-del-vendedor-design.md`): tabla `retorno` con las
  piezas buenas por día, vendedor y presentación, `GET`/`PUT /retornos`, permiso `retorno.gestionar`.

## 2. Decisiones

De Roberto (2026-11-12, en chat):
- **D1.** Se llena la pantalla *Producción → Corte* (hoy `pronto: true`) y **absorbe a Retorno**: Retorno sale del menú;
  lo ya capturado en `retorno` se ve en el Corte, no se pierde. "Que se parezca al viejo con mejoras sutiles", con las
  piezas comunes del portal.
- **D2.** El **dinero entregado (R-5) queda pendiente**: fuera de alcance de este diseño.

Del tío:
- **D3 (R-2).** Opción b: **solo cuenta el almacenista**; el vendedor no captura nada en la tablet. Se compara "debería
  regresar" contra lo contado. La "petición de retorno" del viejo no se hace.
- **D4 (R-3).** El sistema **solo informa** el faltante, en rojo. Nadie autoriza. El descuento es de Administración, fuera.
- **D5 (R-4).** Se cuentan aparte **buenas** y **merma**; las dos se validan.
- **D6 (R-3).** Todo **por presentación** (355 ml, 500 ml, litro, 600 ml…).

Del agente (Roberto las aprobó como suposición en chat):
- **D7.** Debería regresar = **cargadas − vendidas − regaladas**, por presentación. Cargadas = piezas de cargas
  **aceptadas** de ese vendedor ese día (la misma suma que ya usa Retorno). Vendidas = `cantidad` y regaladas =
  `cantidad_promocion` de líneas **vivas** de ventas **vivas** de ese vendedor con esa `fecha` (tablet y portal; las de
  mostrador sin vendedor no cuentan). Merma, cambios y consumo de la tablet aún no existen (T-33, Mario): cuando
  existan se restan en la **misma** regla pura sin cambiar la pantalla.
- **D8.** La merma contada se guarda pero **todavía no se compara** con nada (falta la merma teórica de T-33). La pantalla
  no inventa una merma teórica.
- **D9.** Faltante = debería regresar − buenas contadas. > 0 en rojo ("faltan"); < 0 se muestra como sobrante (sin rojo);
  0 nada. Solo se calcula cuando el corte está **hecho** (§3): antes, lo no capturado no es un faltante.
- **D10.** Se puede capturar y corregir cualquier día **hasta hoy** (Tijuana); futuro = 400. Igual que Retorno hoy.
- **D11.** En la lista del día salen los vendedores **con carga aceptada, venta o algo contado** ese día (ver D13).
- **D12.** Sin cambios en la tablet ni en el contrato de sincronización.

- **D13 (revisión del diseño, decisiones del agente):**
  - Los días que **ya tienen filas en `retorno`** reciben su encabezado en la migración (relleno: `hecho_por_usuario_id`
    = `capturo_usuario_id` de la fila más antigua, `hecho_en` = su `created_at`): lo ya capturado cuenta como corte hecho.
  - Guardar con **todo en 0 o vacío** sí crea el encabezado (el vendedor vendió todo), pero el portal pregunta antes
    con `useConfirmar` ("¿El vendedor no regresó ninguna pieza?"). Vacío = 0. **No hay "deshacer corte"**: se corrige
    editando.
  - "Vendidas" se lee **en vivo**: si después se edita o elimina una venta (T-17), el teórico del corte cambia. Se
    cuentan ventas vivas de **cualquier status** (la mercancía salió igual).
  - `deberiaRegresar` **no se recorta a 0**: un negativo (vendió más de lo cargado: carga sin aceptar o no capturada) se
    muestra tal cual y la fila lleva el aviso "Vendió más de lo cargado". Faltante negativo = sobrante.
  - Un vendedor **con ventas pero sin carga aceptada** también sale en la lista del día, con la etiqueta "Sin carga".
  - El corte permite **agregar una presentación** sin movimiento ese día (selector de presentaciones vivas), para contar
    algo que no se esperaba.
  - `GET`/`PUT /retornos` **se quitan** en este PR (ni la tablet ni otra pantalla los usan); la ruta `/produccion/retorno`
    del portal redirige a `/produccion/corte`.
  - Alcance como Retorno: un usuario General guarda cortes de cualquier sucursal; uno atado, solo de la suya (otro
    vendedor = 404).

## 3. Datos

Una migración nueva (timestamp único, revisar `ls supabase/migrations`):
- `retorno.piezas_merma integer not null default 0`, con `piezas >= 0`, `piezas_merma >= 0` y `piezas + piezas_merma > 0`
  (reemplaza el `check (piezas > 0)`): una fila guarda buenas y merma de una presentación; ambas en 0 = sin fila (baja
  lógica, como hoy). Las filas existentes cumplen (piezas > 0, merma 0).
- **Encabezado del corte** `corte_mercancia`: `fecha`, `vendedor_id`, `sucursal_id` (la del vendedor),
  `hecho_por_usuario_id`, `hecho_en`, `actualizado_por_usuario_id`, tiempos y `deleted_at`; **uno vivo por vendedor y
  fecha** (único parcial). Existe para distinguir "no se ha hecho el corte" de "se hizo y regresó 0 piezas" (un vendedor
  que vendió todo no deja filas en `retorno`). Se crea al primer guardado y se actualiza en los siguientes.
- Permiso: `retorno.gestionar` (ya existe) para ver y guardar el Corte. Se actualiza su descripción a "Corte de
  mercancía: capturar lo que regresa el vendedor" si la tabla de permisos la guarda (la asigna el cliente; no se tocan
  perfiles).

## 4. Backend (`modules/produccion/`)

- `GET /cortes?fecha&sucursal` → lista del día: por vendedor (D11) `vendedor`, `sucursal`, `estado`
  (`sin_corte` / `hecho` / `con_faltante`), `piezasFaltantes` (suma de faltantes > 0, solo si hecho), `hechoEn`.
  Alcance de sucursal como en Retorno (usuario atado: la suya; "Todas" agrupa por sucursal).
- `GET /cortes/vendedor?fecha&vendedor` → el corte de un vendedor: por presentación `presentacionId`, nombre (producto +
  tamaño), `cargadas`, `vendidas`, `regaladas`, `deberiaRegresar`, `buenas`, `merma`, `faltante` (null si no está hecho);
  totales; `hecho` (`hechoEn`, quién). Presentaciones = las que tienen carga, venta o conteo ese día (una desactivada con
  datos sigue saliendo). Vendedor de otra sucursal = 404.
- `PUT /cortes/vendedor` `{ fecha, vendedor, lineas: { presentacionId, buenas, merma }[] }` → reemplaza el día (misma
  semántica que el `PUT /retornos`: ambas en 0 da de baja), crea/actualiza el encabezado, todo en una transacción con la
  fila del vendedor bloqueada `for no key update` (como Retorno). Fecha futura = 400 con `hoyEnTijuana`. Responde el
  corte completo.
- **Regla pura** `reglas-corte.ts`: `deberiaRegresar`, `faltante`, `estadoCorte`, con pruebas. Única fuente de la cuenta.
- `GET`/`PUT /retornos` se quitan (D13).

## 5. Portal (*Producción → Corte*, `/produccion/corte`)

Como el viejo: **lista de vendedores del día → corte de cada uno**. Piezas de `components/ui/`.
- `EncabezadoPantalla` "Corte" + una línea ("Compara lo que debería regresar cada vendedor contra lo que contó el
  almacén."). Selector de día (un solo día; atajos Hoy · Ayer) y de sucursal según el alcance.
- Tabla de vendedores: nombre, piezas cargadas, estado (`Etiqueta`: "Sin corte" gris, "Corte hecho", "Faltan N" rojo),
  botón "Hacer corte" / "Ver corte".
- El corte del vendedor (pantalla completa con "← Volver a Corte", como editar una venta): tabla por presentación con
  Cargadas · Vendidas · Regaladas · Debería regresar · **Buenas** (campo) · **Merma** (campo) · Faltante (rojo si > 0).
  Fila de totales. Los campos vienen con lo ya guardado (vacío si no hay; **no** prellenados con el teórico, para que
  sea un conteo real y no un "aceptar"). "Guardar corte" / "Cancelar"; salir con cambios pregunta con `useConfirmar`.
- Leyenda corta bajo la tabla: "Debería regresar = cargadas − vendidas − regaladas. La merma, los cambios y el consumo de
  la tablet se restarán cuando la app los registre."
- Tiene que caber a 1366 px (`table-fixed` + `colgroup`; medir en el navegador).
- Menú: "Corte" pierde `pronto`; "Retorno" sale del menú (su página redirige a `/produccion/corte`).

## 6. Fuera de alcance

Dinero entregado (D2/R-5); merma teórica, cambios y consumo (T-33, tablet); petición de retorno de la app; inventario
por almacén (T-24/T-63, espera el documento del tío); imprimir el formato "Corte"; la tablet.

## 7. Nube

La migración se sube a `sinmex dev` después del merge con el protocolo de push. Pre-flight: el check nuevo de `retorno`
→ `select count(*) from retorno where piezas <= 0` debe dar 0 (las filas viejas tienen piezas > 0);
tabla nueva; el relleno de encabezados crea uno por cada `(fecha, vendedor_id)` con filas vivas en `retorno`
(`select count(distinct (fecha, vendedor_id)) from retorno where deleted_at is null` = cuántos, para el comentario del PR).

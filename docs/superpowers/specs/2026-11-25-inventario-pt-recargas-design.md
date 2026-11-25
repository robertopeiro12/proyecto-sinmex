# Inventario de PT con Recargas — diseño

Fecha: 2026-11-25 · Rama: `feature/inventario-pt-recargas` · Backend + portal (Roberto). La tablet no cambia.

## Cambios del tío (2026-11-25, noche) — mandan sobre lo de abajo
Contestó las 3 casillas del Word ("Así quedó el Inventario de PT con Recargas") por WhatsApp:
- **Es una fotografía a grandes rasgos**, no el inventario real ("el exacto es el Inventario de PT con Ventas"; también el
  Inventario por vendedor es real). Solo el día de hoy, nada de otros días.
- **Fórmula:** `Inventario inicial − Recargas − Envíos + Producción/Compras = Inventario actual`. **Se quitan Merma, Consumo
  y Descuentos** (columnas, "a quién" de descuentos y el parámetro `columna` del detalle).
- **Inicial** = el Final real del día anterior (PT con Ventas). Se conserva: si hoy hay un ajuste capturado en PT con
  Ventas, manda ese (es el conteo real de arranque de hoy).
- **Recargas: solo cuando el vendedor acepta** (renglón aceptado de una carga `aceptada`). La pendiente **ya no resta**
  (cambia R1). El "a quién" ya no lleva Estado.
- **Sin botón "Ajustar inventario"**: el ajuste se hace sobre el inventario real (PT con Ventas). El aviso "Sin inventario
  inicial" manda a capturarlo allá.
- Envíos restan (confirma el "error de dedo").

## Para qué
La "fotografía" de lo que hay **hoy** en el almacén (CF + almacén general) una vez que los vendedores salieron a ruta con
sus recargas y se mandó mercancía a otra sucursal. Su gemelo, *Inventario de PT con Ventas*, dice con cuánto **terminó**
un día; este dice cuánto **hay ahorita**.

## Fuentes (vault `90-Fuentes/`)
- **Módulo de Producción e Inventarios 2026-11-16**, submódulo *Inventario de PT con Recargas*: general o por sucursal;
  por presentación y por producto ("por default todos los productos con todas las presentaciones"); **solo la información
  del día** ("si quieres saber con cuánto terminamos el almacén, para eso sería el siguiente submódulo"); información
  inicial para arrancar (administrador general o jefe de producción). Excel de ejemplo, por tamaño: Fecha · Inventario
  Inicial · Recargas a Vendedores · Envíos a Sucursal · Entrada/Compras · Merma · Consumo Propio · Descuentos · Inventario
  ACTUAL. Cada columna sale de su pestaña del **Registro de Operación**; Consumo y Descuentos son solo de producción y
  administración ("ventas se llevará en otro apartado"). "NO se considera los retornos… por eso se llama Inventario ACTUAL
  y no final."
- **Respuestas del cliente 2026-11-18**: (2) el "+ Envíos" de la fórmula fue error de dedo: los envíos **restan** en quien
  manda y entran como Entrada en quien recibe; (4) una recarga aceptada no se edita; (6) "borrón y cuenta nueva" con un
  conteo físico en el inventario inicial del día.
- Recargas **por renglón** (#171 de Mario, `carga_detalle.aceptada`): el vendedor acepta o rechaza cada renglón.

## Decisiones de Roberto (2026-11-25)
- **R1. Qué recargas restan:** cada renglón de las recargas vivas de **hoy** que esté **pendiente o aceptado**; solo un
  renglón rechazado no resta. (Lo pendiente ya salió en la camioneta.) **Va marcado para que el tío lo confirme.**
- **R2. Permiso propio:** `inventario_pt_recargas.ver` (no el de PT con Ventas), para que el tío decida por separado.

## Diseño
- **D1. Pantalla** *Producción → Inventario de PT con Recargas* (`/produccion/inventario-pt-recargas`), en el menú
  **antes** de *Inventario de PT con Ventas* (el orden del tío). Mismo estilo que PT con Ventas: sucursal del menú lateral
  (**Todas** = general), `SelectorSegmentado` **Por presentación | Por producto**, tabla agrupada por tamaño
  (`claveTamano`/`compararTamano`) con total por tamaño; con *Por producto*, un renglón por producto. **Sin campo de
  fecha**: siempre hoy de Tijuana, con el día escrito y la hora de la consulta ("Hoy, miércoles 25 de noviembre · a las
  10:32") y un botón **Actualizar** que vuelve a pedir los datos. Columnas en el orden del Excel: Producto · Inicial ·
  Recargas · Envíos · Entradas/Compras · Merma · Consumo · Descuentos · **Actual**. Todas las presentaciones vivas (aunque
  estén en 0). Cabe a 1366 px.
- **D2. De dónde sale cada número** (por sucursal y presentación, **hoy**; todo **vivo**):
  - **Recargas**: `carga_detalle.piezas` de cargas vivas de hoy de la sucursal (`carga.sucursal_id`), con la carga `pendiente`, o
    `aceptada` y el renglón aceptado (`coalesce(aceptada, true)`, la misma regla que el Corte). Rechazada = no cuenta.
  - **Envíos**: Registro `envio` de esta sucursal (salen).
  - **Entradas/Compras**: Registro `entrada` + **envíos recibidos** (los `envio` con destino esta sucursal).
  - **Merma**, **Consumo**, **Descuentos**: solo Registro de Operación (`merma`, `consumo`, `descuento`). Lo de los
    vendedores, la app y Procesos **no** entra aquí (sí en PT con Ventas).
  - `Actual = Inicial − Recargas − Envíos + Entradas − Merma − Consumo − Descuentos`
  - **Inicial** = el del **ajuste de hoy** si lo hay; si no, el **Final de ayer de Inventario de PT con Ventas** (misma
    cuenta, `reglas-inventario-pt.ts`; no se duplica). Así las dos pantallas arrancan del mismo número.
- **D3. Sin inventario inicial.** Si PT con Ventas no tiene Final de ayer (sin ajuste previo) y hoy no hay ajuste:
  Inicial y Actual vacíos (no 0), movimientos visibles, y el aviso "Sin inventario inicial" de PT con Ventas. **Todas**
  sigue la regla de PT con Ventas (`sumarSucursales`): una sucursal sin ajuste pero con movimiento deja el total vacío;
  sin ajuste ni movimiento aporta 0. La marca **"Ajustado"** sale en el Inicial cuando hoy hay ajuste (solo por
  presentación, como allá).
- **D4. Ajustar.** Con `inventario_pt.ajustar` y una sucursal elegida, botón **"Ajustar inventario"** que abre **la misma
  pantalla de ajustes** de PT con Ventas fija en **hoy** (mismos endpoints y tabla `inventario_pt_ajuste`; nada nuevo).
  Al volver, se recarga. Con Todas, deshabilitado como allá. Esa pantalla solo usa `GET|PUT|DELETE /inventario-pt/ajustes`
  (permiso `inventario_pt.ajustar`, no pide `inventario_pt.ver`) y precarga el **Inicial** que el sistema usaría hoy (el
  Final de ayer), no el Actual. Es **la misma** tabla de ajustes: ajustar hoy aquí cambia también el Inicial de hoy en PT
  con Ventas (a propósito: un solo conteo físico para las dos).
- **Por qué el Final de ayer sirve de Inicial** (aunque PT con Ventas no resta recargas): lo que el vendedor no vendió
  regresa en el corte, así que `Inicial − Ventas` de ayer ya es lo que físicamente quedó en el almacén (lo que faltó lo
  cuadra el descuento de Procesos). Hoy se restan las recargas que salieron.
- **Mis decisiones (Claude):** una recarga cuenta en la sucursal **de la carga** (`carga.sucursal_id`), también si el vendedor
  ya está dado de baja; se muestran las presentaciones vivas y además las desactivadas o dadas de baja **con
  movimiento hoy** (como el Corte).
- **D5. Detalle al picar.** Un número de **Recargas** ≠ 0 abre una ventana "A quién": vendedor, n.º de carga, estado
  (Pendiente / Aceptada) y piezas, con total. Un número de **Descuentos** ≠ 0 abre "A quién" con trabajador y piezas
  (los del Registro: "Nómina"). Por producto, suman las presentaciones del producto.
- **D6. Permiso nuevo** `inventario_pt_recargas.ver` (grupo `Produccion/Almacen`, con su ⓘ en
  `lib/explicacion-permisos.ts`). Alcance de sucursal como PT con Ventas (atado a otra = 403; `todas` solo para General).
  Ajustar usa el `inventario_pt.ajustar` que ya existe.
- **D7. Endpoints** (`modules/produccion/`, junto a PT con Ventas, sin duplicar sus consultas):
  `GET /inventario-pt/recargas?sucursal&vista=presentacion|producto` → `{ fecha, hoyEnTijuana, consultadoEn, renglones }`
  y `GET /inventario-pt/recargas/detalle?(presentacion|producto)&sucursal&columna=recargas|descuentos`. Fecha = hoy del
  servidor (Tijuana), nunca del navegador.

## Fuera de alcance
- Días anteriores, historial y retornos (eso es PT con Ventas).
- Almacenes (T-63) y cambios de la app (T-33).

## Nube
Una migración: el permiso nuevo (insert en `permiso`). Pre-flight: nada que contar. Backend y portal juntos.

## Pruebas
Unit de la regla (Actual con ajuste de hoy, con Final de ayer, sin inicial, Todas, por producto); e2e por columna
(recarga pendiente cuenta, renglón rechazado no, carga eliminada no; envío TJ→MX resta en TJ y suma en MX; merma de la
app o de Procesos **no** entra; ajuste de hoy manda; Inicial = Final de ayer de PT con Ventas; permisos y alcance);
portal: tabla, vistas, aviso sin inicial, a quién de recargas y descuentos, Actualizar, ajustar. Navegador a 1366 px.

## Para el Word del tío (resaltar con casillas)
- R1: la recarga **pendiente** ya resta (¿o hasta que el vendedor la acepte?).
- Merma, Consumo y Descuentos aquí son **solo** los del Registro de Operación; lo de vendedores queda en PT con Ventas.
- La fórmula usa **− Envíos** (su "error de dedo").

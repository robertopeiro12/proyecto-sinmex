# Inventario de PT con Ventas — diseño

Fecha: 2026-11-25 · Rama: `feature/inventario-pt-ventas` · Backend + portal (Roberto). La tablet no cambia.

## Fuentes (vault `90-Fuentes/`)
- **Módulo de Producción e Inventarios 2026-11-16**, submódulo *Inventario de PT con Ventas*: "el inventario real por
  producto y presentación considerando las ventas (No las recargas)… para ver la información de un día anterior";
  general y por sucursal; por presentación o por producto ("por default todos los productos con todas las
  presentaciones"); "se debe seleccionar una fecha"; opción de **ajustes** con su permiso. Excel de ejemplo con columnas
  Fecha · Inventario Inicial · Ventas · Merma · Consumo Propio · Promo · Descuentos · Entradas/Compras · Inventario Final ·
  Merma Acumulada · Retiro Mermas.
  - `Inicial − Ventas + Entradas/Compras − Merma − Consumo − Promo − Descuentos = Final`
  - `Merma acumulada = merma acumulada día anterior + merma del día − retiro de merma`
- **Respuestas del cliente 2026-11-18**: (2) envíos: se restan en quien manda y entran como Entrada en quien recibe;
  (3) al picar Descuentos se ve a quién; (5) la merma que entra es **la que cuenta el almacenista**, y la merma acumulada
  inicial **se captura al arrancar**; (6) con un conteo físico se hace "borrón y cuenta nueva" en inventario inicial y
  merma inicial del día.
- Boceto aprobado por Roberto: `img/2026-11-25-inventario-pt-ventas-boceto.png`. "Que el diseño sea parecido a todo y el
  flujo basado en el de mi tío."

## Decisiones de Roberto (2026-11-25)
- **R1.** Columna **Cambios** (neto por presentación: lo que regresó el cliente suma, lo que se le entregó resta).
- **R2.** Boceto aprobado (columnas, totales por tamaño, historial al picar producto, a quién al picar Descuentos,
  "Ajustar inventario").

## Diseño
- **D1. Pantalla** *Producción → Inventario de PT con Ventas* (`/produccion/inventario-pt-ventas`). Sucursal del menú
  lateral; con **Todas** = general (suma de sucursales; los envíos se compensan solos). Campo **Día** + atajos Hoy · Ayer
  (abre en **ayer**) + día escrito; `SelectorSegmentado` **Por presentación | Por producto**. Tabla agrupada por tamaño
  (`claveTamano`/`compararTamano` de `lib/cortes.ts`) con total por tamaño; con "Por producto", un renglón por producto
  sumando sus presentaciones (sin grupos de tamaño). Columnas: Producto · Inicial · Ventas · Merma · Consumo · Promo ·
  Descuentos · Cambios · Entradas/Compras · Envíos · **Final** · Merma acumulada · Retiro de merma. Cabe a 1366 px.
  Por omisión todas las presentaciones vivas (aunque estén en 0).
- **D2. De dónde sale cada número** (por sucursal, presentación y día; todo **vivo**):
  - **Ventas**: `venta_nota_detalle.cantidad` de ventas de esa sucursal y fecha (app y portal).
  - **Promo**: `cantidad_promocion` de esas ventas + Procesos `promocion` (entregado).
  - **Merma**: Registro de Operación `merma` + merma de los vendedores de la sucursal según su **corte**: la **contada**
    (`retorno.piezas_merma`) si el corte está hecho; si no, la merma teórica del corte (`reglas-corte.ts`) + Procesos
    `merma` **con Oficina** (recibido, de cliente o de almacén). La de Procesos con vendedor ya va dentro de su corte.
  - **Consumo**: Registro `consumo` + consumo de la app (`movimiento_inventario` tipo `consumo`) + Procesos `consumo`.
  - **Descuentos**: Registro `descuento` + Procesos `descuento`.
  - **Cambios**: Procesos `cambio`: recibido suma, entregado resta (los cambios de la app no existen todavía, T-33).
  - **Entradas/Compras**: Registro `entrada` + **envíos recibidos** (los `envio` con destino esta sucursal).
  - **Envíos**: Registro `envio` de esta sucursal (salen).
  - **Retiro de merma**: Registro `retiro_merma` **autorizado** (por su fecha).
  - `Final = Inicial − Ventas − Merma − Consumo − Promo − Descuentos + Cambios + Entradas − Envíos`
  - `Merma acumulada = la del día anterior + Merma − Retiro de merma`
  - **Inicial** = el Final del día anterior, o el del **ajuste** de ese día si lo hay.
  - Limitación aceptada: en una merma de cliente la pieza buena que se le dio puede ser de otro sabor; por presentación
    eso se corrige en el siguiente ajuste (el tío cuenta la merma por lo que llega dañado).
- **D3. Ajustes ("borrón y cuenta nueva").** Tabla nueva `inventario_pt_ajuste`: sucursal, presentación, fecha,
  `inventario_inicial` (≥ 0), `merma_acumulada_inicial` (≥ 0), comentario opcional, quién y cuándo; uno vivo por
  (sucursal, presentación, fecha); se corrige o se da de baja. El ajuste **reemplaza el Inicial y la Merma acumulada de
  arranque de ese día**; de ahí en adelante se calcula. El arranque de cada sucursal es su primer ajuste. Sin ajuste
  anterior a la fecha: la presentación sale "Sin inventario inicial" (celdas de Inicial, Final y Merma acumulada vacías,
  no 0) pero sí muestra los movimientos del día. "Ajustar inventario" abre una pantalla con la rejilla por tamaño y TAB
  (como Registro de Operación): por presentación, Inventario inicial y Merma acumulada, precargados con lo que el sistema
  calcula para ese día; solo se guardan los renglones cambiados. Fecha: hoy o anteriores. Un día ajustado muestra la
  marca "Ajustado" en su Inicial.
- **D4. Detalles al picar.** Producto → ventana con sus días (por omisión los 7 días que terminan en el elegido;
  Desde/Hasta ≤ 62 días): Día · Inicial · Ventas · Merma · Consumo · Promo · Descuentos · Cambios · Entradas · Envíos ·
  Final · Merma acumulada · Retiro, y total. Descuentos → ventana "A quién": nombre (vendedor o trabajador), de dónde
  ("Faltante del corte" de Procesos / "Nómina" del Registro) y piezas.
- **D5. Permisos nuevos** (grupo `Produccion/Almacen`, con su ⓘ): `inventario_pt.ver` (ver) e `inventario_pt.ajustar`
  (ajustes). Alcance de sucursal como el Corte (atado a otra = 403; `todas` solo para General).
- **D6. Cálculo en un solo lugar**: reglas puras en el backend (`modules/produccion/reglas-inventario-pt.ts`) que
  reciben los movimientos por día y los ajustes y devuelven los renglones; el portal no recalcula.

## Nube
Una migración (tabla de ajustes + 2 permisos). Pre-flight: nada que contar. Backend y portal juntos.

## Pruebas
Unit de la regla (encadenado de días, ajuste a media serie, sin ajuste, merma acumulada con retiro, todas = suma,
por producto); e2e por columna con datos de cada fuente (incluido envío entre sucursales y merma contada vs teórica);
portal: tabla, vistas, historial, a quién, ajuste. Navegador a 1366 px.

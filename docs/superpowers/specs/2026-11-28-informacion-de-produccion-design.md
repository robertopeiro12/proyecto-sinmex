# Información de Producción — diseño

Fecha: 2026-11-28 · Rama: `feature/informacion-produccion` · Backend + portal (Roberto). La tablet no cambia.

## Para qué
Un **reporte** de lo que se produjo o se compró: junta las capturas de *Registro de Operación → Entradas/Compras* de un
rango de días. No se captura nada aquí; solo se consulta.

## Fuentes (vault `90-Fuentes/`)
- **Módulo de Producción e Inventarios 2026-11-16**, "Submódulo: Información de Producción": "mostrar todos los registros
  de Entradas/Compras de lo que se capture en Registro de Operaciones Entradas/Compras. Es meramente un reporte, pero
  quisiera tenerlo en el módulo de producción. Características: Mostrar por rango de fechas · Mostrar por presentación y
  por producto."
- El sistema viejo no tenía nada parecido (su "Producción → Información" era el inventario por vendedor).

## Decisiones de Roberto (2026-11-28)
Se construye con las **recomendadas** del Word "Preguntas Información de Producción" (enviado al tío el 2026-11-28, sin
respuesta todavía). **Si el tío elige otra opción, se cambia después** (son cambios chicos sobre esto):
- **P1 → A.** Totales por presentación (o producto) del rango y, al picar, el detalle de las capturas.
- **P2 → A.** Columnas **Producción · Compras · Total**.
- **P3 → A.** Los **envíos recibidos de otra sucursal no cuentan** (no son producción ni compra; ya salen en los
  inventarios).

## Diseño
- **D1. Pantalla** *Producción → Información de Producción* (`/produccion/informacion-produccion`), en el menú **después
  de Inventario de PT con Ventas** (antes de Almacenes). `EncabezadoPantalla` "Información de Producción" + una línea:
  "Lo que se produjo y se compró en un rango de días, según las Entradas/Compras del Registro de Operación." Sucursal del
  menú lateral (**Todas** = suma de las sucursales). `FiltroFechas` (Desde/Hasta, atajos, **Mostrar**), por omisión **este
  mes** (del día 1 a hoy). `SelectorSegmentado` **Por presentación | Por producto**. **Sin Excel**: el tío no lo pidió aquí
  (Roberto, 2026-11-28: el Excel va en la pantalla de Reportes).
  Consulta al entrar y al picar Mostrar; cambiar de vista vuelve a pedir con el rango consultado. Cabe a 1366 px.
- **D2. Tabla.** Columnas **Producto · Producción · Compras · Total**.
  - *Por presentación*: agrupada por tamaño (`agruparPorTamano`), con renglón **Total <tamaño>** y, al final, **Total**
    general.
  - *Por producto*: un renglón por producto (suma de sus presentaciones, sin grupos) y **Total** general.
  - Solo salen las presentaciones/productos **con alguna entrada en el rango** (un reporte, no un inventario: los ceros
    no aportan). Sin nada: "No hubo entradas en esas fechas." *(Decisión de Claude.)*
  - Una presentación desactivada o dada de baja con entradas en el rango **sí sale** (es historia).
- **D3. Fuente** (todo **vivo**): `operacion_almacen` con `tipo = 'entrada'`, `deleted_at is null`, `fecha` en
  `[desde, hasta]`, de la(s) sucursal(es) del ámbito (`sucursal_id`), y sus `operacion_almacen_linea`. `origen =
  'produccion'` suma en Producción y `'compra'` en Compras. **No** entran los `envio` (ni los recibidos), ni ningún otro
  tipo. Una línea borrada no existe (las líneas no tienen baja lógica; la operación sí).
- **D4. Detalle al picar** el nombre del producto (botón, como el historial de PT con Ventas): `Ventana` "<Horchata 500 ml>
  · <del 3 al 7 nov>" con una fila **por captura** (operación) que tocó esa presentación (o, por producto, cualquiera de
  sus presentaciones, sumadas por operación): **Día · Origen · Capturó · Piezas · Comentario**, y con **Todas** además la
  columna **Sucursal**, de la más vieja a la más nueva (`fecha`, hora de captura, id), con renglón **Total**. Usa el rango
  ya consultado (no tiene filtros propios).
- **D5. Permiso nuevo** `informacion_produccion.ver` (grupo `Produccion/Almacen`, con su ⓘ en
  `lib/explicacion-permisos.ts`); los perfiles siguen vacíos (los configura el cliente). Alcance de sucursal como PT con
  Ventas (`InventarioPtService.ambito`: atado a otra = 403; `todas` para General = todas las vivas; código inexistente =
  404). El portal muestra `EstadoPantalla` sin permiso si falta.
- **D6. Fechas.** `desde`/`hasta` obligatorias, `AAAA-MM-DD` reales; `hasta` > hoy de Tijuana = 400 con `hoyEnTijuana`
  (mismo error que PT con Ventas); `desde > hasta` = 400; rango de más de **366 días** = 400 "El rango no puede pasar de un
  año." (el de los demás reportes, `MAX_DIAS_RANGO`).
- **D7. Endpoints** (`modules/produccion/`, archivos `informacion-produccion.*` y reglas puras
  `reglas-informacion-produccion.ts`):
  - `GET /informacion-produccion?desde&hasta&sucursal&vista=presentacion|producto` →
    `{ desde, hasta, hoyEnTijuana, renglones: { presentacionId: string | null; productoId; producto; volumen; produccion;
    compras; total }[] }` (por producto: `presentacionId` null y `volumen` ''). Orden como PT con Ventas
    (`compararPresentaciones`; por producto, alfabético).
  - `GET /informacion-produccion/detalle?(presentacion|producto)&desde&hasta&sucursal` → `{ detalle: { fecha; hora;
    sucursal; origen: 'produccion' | 'compra'; capturo; piezas; comentario: string | null }[] }` (uno de presentación o
    producto, como `objetivo()` de PT con Ventas: ninguno o los dos = 400; inexistente = 404).
  - Una consulta agrupada (sin N+1). Tipos duplicados backend ↔ portal en `apps/portal/src/lib/informacion-produccion.ts`.

## Fuera de alcance
- Envíos recibidos (P3), costos o precios de compra, proveedores, almacenes (T-63).
- Exportar a Excel (va en *Información → Reportes*, no aquí).
- Capturar o corregir entradas (eso es el Registro de Operación).

## Nube
Una migración `20261202120000_permiso_informacion_produccion.sql` (un insert en `permiso`). Pre-flight: **nada que
contar**. Backend y portal juntos.

## Pruebas
Unit de las reglas (suma por origen, por producto, total). e2e: producción y compra en su columna; envío (enviado y
recibido) **no** cuenta; operación borrada no cuenta; otro tipo (merma, consumo) no cuenta; fuera del rango no cuenta;
Todas suma sucursales; presentación dada de baja con entrada sale; detalle por presentación y por producto (suma por
operación, con Capturó y Comentario); validaciones de fecha y rango; permisos (403 sin `informacion_produccion.ver`) y
alcance (atado a otra = 403). Portal: tabla agrupada con totales, Por producto, detalle, sin permiso, vacío. Navegador a 1366 px.

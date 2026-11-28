# Información de Producción — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pantalla *Producción → Información de Producción*: reporte de las Entradas/Compras del Registro de Operación por rango de fechas, por presentación o por producto (Producción · Compras · Total), con el detalle de capturas al picar.

**Architecture:** solo lectura, sin tabla nueva (solo un permiso). Backend en `apps/backend/src/modules/produccion/` junto a PT con Ventas: reglas puras `reglas-informacion-produccion.ts`, repositorio/servicio/controlador `informacion-produccion.*`; el alcance de sucursal, `objetivo()` (presentación|producto) y "hoy" se reutilizan de `InventarioPtService` (ya públicos). Portal en `components/informacion-produccion/` reutilizando `FiltroFechas`, `SelectorSegmentado`, `agruparPorTamano`/`cualDe` de `lib/inventario-pt.ts` y `components/inventario-pt/`.

**Tech Stack:** Postgres/Supabase (migración + pgTAP), NestJS + Kysely + Jest, Next.js + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-informacion-de-produccion-design.md`

## Global Constraints

- Migración `supabase/migrations/20261202120000_permiso_informacion_produccion.sql` (versión única; revisada contra `main` y las ramas remotas el 2026-11-28): `insert into permiso (clave, grupo, descripcion) values ('informacion_produccion.ver', 'Produccion/Almacen', 'Información de producción (entradas y compras): ver') on conflict (clave) do nothing;`.
- Fuente: solo `operacion_almacen` `tipo = 'entrada'` vivas (`deleted_at is null`) con `sucursal_id` en el ámbito y `fecha` entre `desde` y `hasta` (incluidos); `origen = 'produccion'` → Producción, `'compra'` → Compras; `total = produccion + compras`. **Nunca** `envio` (ni enviado ni recibido) ni otro tipo.
- Solo salen presentaciones/productos con alguna entrada en el rango; dadas de baja o desactivadas con entrada **sí** salen.
- Fechas: formato `AAAA-MM-DD` real (`esFechaReal`); `hasta` > hoy de Tijuana = 400 con `{ message: ['La fecha no puede ser posterior a hoy.'], hoyEnTijuana }` (mismo cuerpo que PT con Ventas); `desde > hasta` = 400 'La fecha inicial no puede ser posterior a la final.'; más de **366** días (incluidos) = 400 'El rango no puede pasar de un año.'.
- Alcance: `InventarioPtService.ambito(usuarioId, sucursal)` (atado a otra = 403, `todas` = todas las vivas, código inexistente = 404). Permiso de los dos GET: `@RequierePermiso('informacion_produccion.ver')`.
- **Sin Excel** en esta pantalla (Roberto, 2026-11-28). Sin migración más allá del permiso.
- Diseño "parecido a todo": piezas de `components/ui/` (`EncabezadoPantalla`, `EstadoPantalla`, `FiltroFechas`, `SelectorSegmentado`, `Tabla`/`CajaTabla`/`FilaGrupo`/`FilaTotal`/`FilaVacia`, `Ventana`), tamaños con `agruparPorTamano`; cabe a 1366 px sin scroll horizontal de la página.
- Roberto tiene backend (3010) y portal (3001) prendidos: no apagar, **no `npm run build`**, sin `git stash`, migración solo a la base LOCAL.

## Review Focus

1. Envío TJ→MX del rango: no aparece ni en TJ ni en MX, ni con Todas. → e2e Tarea 2.
2. Una entrada eliminada (baja lógica) después de capturada no cuenta, ni en la tabla ni en el detalle. → e2e Tarea 2.
3. Bordes del rango: una entrada justo en `desde` y otra justo en `hasta` cuentan; una del día anterior a `desde` no. → e2e Tarea 2.
4. Por producto, una operación con dos presentaciones del mismo producto sale en el detalle como **una** fila con la suma. → e2e Tarea 2.
5. Cambiar de vista después de haber movido las fechas sin picar Mostrar consulta con el rango **ya consultado**, no con el escrito. → prueba Tarea 3.

---

### Tarea 1: Migración y pgTAP

**Files:** `supabase/migrations/20261202120000_permiso_informacion_produccion.sql`, `supabase/tests/93_permiso_sucursal_test.sql` (51 → 52, número y mensaje, y el comentario que lista los permisos: "52 informacion_produccion.ver (Información de Producción)"), `supabase/tests/99_informacion_produccion_test.sql` (nuevo, `plan(1)`: el permiso existe con grupo `Produccion/Almacen`).

- [ ] pgTAP rojo → migración (encabezado con el spec y "Pre-flight contra la nube: nada que contar") → `npm run supabase -- migration up --local`, `npm run supabase -- test db` PASS → `npm run db:types --workspace=apps/backend` sin diff → **Commit** `Información de Producción: permiso`.

### Tarea 2: Backend

**Files:** `apps/backend/src/modules/produccion/{reglas-informacion-produccion.ts,reglas-informacion-produccion.spec.ts,informacion-produccion.repository.ts,informacion-produccion.service.ts,informacion-produccion.controller.ts,dto/informacion-produccion.dto.ts}`, `produccion.module.ts`, e2e `apps/backend/test/informacion-produccion.e2e-spec.ts`.

**Interfaces — Produces:**
```ts
// reglas-informacion-produccion.ts (puras)
export const MAX_DIAS_INFORMACION = 366;
export interface RenglonInformacion { presentacionId: string | null; productoId: string; producto: string; volumen: string;
  produccion: number; compras: number; total: number }
export function porProductoInformacion(renglones: readonly RenglonInformacion[]): RenglonInformacion[] // suma por productoId; presentacionId null, volumen ''; orden producto (es) luego productoId
export function ordenarInformacion(renglones: RenglonInformacion[]): RenglonInformacion[] // compararPresentaciones de reglas-inventario-pt
// GET /informacion-produccion?desde&hasta&sucursal&vista=presentacion|producto
//   → { desde, hasta, hoyEnTijuana, renglones: RenglonInformacion[] }
// GET /informacion-produccion/detalle?(presentacion|producto)&desde&hasta&sucursal
//   → { detalle: { fecha: string /*AAAA-MM-DD*/; hora: string /*hh:mm Tijuana de created_at*/; sucursal: string /*código*/;
//        origen: 'produccion' | 'compra'; capturo: string /*usuario.nombre*/; piezas: number; comentario: string | null }[] }
```
Exportar los tipos de respuesta `InformacionProduccion` y `DetalleInformacionProduccion` desde el servicio (los usa el e2e y la copia del portal).

- [ ] Unit rojo de las reglas: `porProductoInformacion` suma produccion/compras/total de las presentaciones de un producto y ordena por nombre; `ordenarInformacion` ordena por tamaño (355 ml antes de 1 L) y luego producto.
- [ ] e2e rojo (sucursales propias del archivo con códigos libres — revisa que no choquen con otros e2e —, todo limpiado por id al final): entrada de producción y de compra en su columna y total; Review Focus 1–4; merma/consumo/descuento/retiro_merma no cuentan; Todas suma las dos sucursales; presentación dada de baja con entrada sale; sin entradas → `renglones: []`; detalle por presentación (fecha, hora, sucursal, origen, capturó, piezas, comentario; orden fecha, hora, id) y por producto (suma por operación); validaciones (fecha futura con `hoyEnTijuana`, rango invertido, 367 días, vista inválida, detalle sin/ con ambos parámetros = 400, presentación inexistente = 404); 403 sin `informacion_produccion.ver`; atado a otra sucursal = 403; sucursal inexistente = 404.
- [ ] Implementar: una consulta agrupada por presentación (`sum(case when origen = 'produccion' …)`) con `join presentacion`/`producto` para nombre y volumen; el detalle agrupado por operación (`group by o.id`) con `join usuario` para `capturo`. DTO con `@Matches(/^\d{4}-\d{2}-\d{2}$/)` en desde/hasta, `vista` `@IsIn`, `presentacion`/`producto` `@IsUUID` como `ConsultaHistorialPtDto`. Validación de fechas en el servicio (orden: formato real → futura → invertido → largo), luego `objetivo` (detalle) y `ambito`.
- [ ] Unit completo, e2e `informacion-produccion` + `inventario-pt`, lint → **Commit** `Información de Producción: backend`.

### Tarea 3: Portal

**Files:** `apps/portal/src/lib/informacion-produccion.ts` (+ `.test.ts`; tipos copiados del backend + `leerInformacionProduccion(desde, hasta, sucursal, vista)` y `leerDetalleInformacion(c: CualPt, desde, hasta, sucursal)`), `apps/portal/src/components/informacion-produccion/{pantalla-informacion-produccion.tsx,tabla-informacion-produccion.tsx,ventana-detalle-informacion.tsx}` (+ prueba de la pantalla), `apps/portal/src/app/(portal)/produccion/informacion-produccion/page.tsx` (igual que la de PT con Recargas: `key={sucursal}`), `components/layout/nav-config.ts` (Producción: después de "Inventario de PT con Ventas", antes de "Almacenes") y `nav-config.test.ts` (lista completa de 7), `lib/explicacion-permisos.ts` (`"informacion_produccion.ver": "Abre Producción → Información de Producción: lo que se produjo y se compró en un rango de días (por presentación o por producto), con cada captura de Entradas/Compras."`).

- Pantalla: `EncabezadoPantalla` título "Información de Producción", descripción "Lo que se produjo y se compró en un rango de días, según las Entradas/Compras del Registro de Operación."; sin permiso → `EstadoPantalla tipo="sin-permiso"`; sucursal como PT con Recargas (atado = la suya; si no, la del menú o `todas`). `FiltroFechas` (rango inicial: `primerDiaDelMes(hoy)`..hoy, hoy de `hoyEnTijuana()` de `lib/ventas`), consulta al montar y al Mostrar; `SelectorSegmentado` Por presentación | Por producto que vuelve a pedir con el rango **consultado** (Review Focus 5). Guardia `ultima` contra respuestas viejas. Error del servidor → `Aviso tono="error"` con `mensajeDe`.
- Tabla: columnas Producto · Producción · Compras · Total (`table-fixed`, Producto ancho); por presentación `FilaGrupo` por tamaño, `FilaTotal` "Total <tamaño>" y al final `FilaTotal` "Total"; por producto un renglón por producto y "Total". Vacío: `FilaVacia` "No hubo entradas en esas fechas.". El nombre del producto es un botón (como el historial de PT con Ventas) que abre la ventana.
- Ventana: `Ventana ancho="ancho"` título "<nombreDe(renglon)> · <rango con formatearDiaCorto>"; columnas Día · Origen ("Producción"/"Compra") · Capturó · Piezas · Comentario, más **Sucursal** (después de Día) solo con `todas`; `FilaTotal` con la suma; "Cargando…"/error como `VentanaAQuien` de PT con Recargas.
- [ ] Pruebas rojas: tabla agrupada con totales de tamaño y total general; Por producto; vacío; detalle por presentación y por producto (llama con `cualDe`), columna Sucursal solo con Todas; Review Focus 5; sin permiso; menú con la entrada en su lugar; llamadas de `lib` con la URL exacta → implementar → `npm test --workspace=apps/portal`, lint, `tsc` → **Commit** `Información de Producción: pantalla`.

### Tarea 4: Navegador y documentación

- [ ] Con los servidores de Roberto, a 1366 px, con datos de la base LOCAL (crear lo necesario con comentario "Prueba informacion produccion" y **borrarlo al final**): entradas de producción y compra en varios días y dos sucursales, un envío TJ→MX y una entrada borrada; ver Por presentación, Por producto, Todas, el detalle (con y sin Todas) y cambiar el rango. Sin scroll horizontal.
- [ ] `CLAUDE.md` (bloque nuevo "Información de Producción (2026-11-28)" después del de PT con Recargas: fuente, columnas, sin envíos, sin Excel, permiso, endpoints, migración y pre-flight "nada que contar"; decisiones pendientes de confirmar con el tío), vault (`10-Dominio/Modulos/Producción.md`, `00-Inicio/Estado del proyecto.md` fila 3h, bitácora 2026-11-28; commit **y push**) → **Commit** `Docs: Información de Producción`.

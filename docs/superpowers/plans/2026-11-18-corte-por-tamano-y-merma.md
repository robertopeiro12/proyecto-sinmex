# Corte por tamaño, con merma teórica — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Producción → Corte muestre, por tamaño, piezas teóricas vs reales y merma teórica vs real validada, con
la cuenta del cliente (resta merma y consumo de la tablet).

**Architecture:** La cuenta sigue viviendo solo en `apps/backend/src/modules/produccion/reglas-corte.ts` (puro). La
consulta `movimientosDelDia` suma además `movimiento_inventario`. El portal recibe las líneas ya ordenadas por tamaño y
arma secciones y totales en `apps/portal/src/lib/cortes.ts` (puro, copia de la regla de tamaño). Sin migración, sin
cambio de la tablet ni del contrato de sincronización.

**Tech Stack:** NestJS + Kysely (backend, Jest), Next.js + Vitest + Testing Library (portal).

**Spec:** `docs/superpowers/specs/2026-11-18-corte-por-tamano-y-merma-design.md` (y el anterior
`2026-11-12-corte-de-mercancia-design.md` para lo que no cambia).

## Global Constraints

- Teórica (C3) = `cargadas − vendidas − regaladas − mermaEntregada − mermaAlmacen − consumo − cambiosEntregados + cambiosRecibidos`, sin recortar.
- Merma teórica (C4) = `mermaRecibida + mermaAlmacen`.
- Resultado = teórica − real en los dos bloques; positivo = falta (rojo); negativo se muestra sin bloquear.
- Total del día (D1) = suma por tamaño de `max(0, suma con signo de los resultados del tamaño)`; un tamaño no tapa a otro.
- Tamaño (D3): clave = `volumen` en minúsculas sin espacios; orden por mililitros (`L`/`lt`/`litro` ×1000), los que no se leen al final por texto.
- Cambios físicos = 0 siempre (no existen todavía).
- Los tipos del portal (`lib/cortes.ts`) copian los del backend: todo cambio de forma va en los dos en el mismo commit.
- Textos en español, sin `window.confirm`; piezas comunes de `components/ui/`. La tabla cabe a 1366 px.
- Comandos siempre desde la raíz del repo con `--workspace`.

## Review Focus

1. **Venta del portal con "Control de inventario"**: la existencia ahora descuenta merma entregada, merma de almacén y consumo; la merma recibida NO suma. → e2e en Tarea 2.
2. **Un movimiento borrado** (`deleted_at`) o de otro día/vendedor no cuenta. → e2e en Tarea 2.
3. **Vendedor con solo merma/consumo** (sin carga ni venta) aparece en la lista del día. → e2e en Tarea 2.
4. **Presentación agregada a mano** de un tamaño que no estaba en la tabla crea su sección en el orden correcto. → prueba en Tarea 3.
5. **Volúmenes escritos distinto** ("500 ml", "500ML", "500ml") caen en la misma sección; "1 L" va después de "600 ml"; uno ilegible ("Garrafón") al final. → pruebas en Tareas 1 y 3.

---

### Tarea 1: Reglas puras del corte (backend)

**Files:**
- Modify: `apps/backend/src/modules/produccion/reglas-corte.ts`
- Test: `apps/backend/src/modules/produccion/reglas-corte.spec.ts`

**Interfaces:**
- Produces (lo usan Tareas 2 y 3 como modelo):
  - `MovimientoPresentacion` agrega `producto: string`, `volumen: string`, `mermaEntregada`, `mermaRecibida`, `mermaAlmacen`, `consumo`, `cambiosEntregados`, `cambiosRecibidos` (todos `number`).
  - `LineaCorte extends MovimientoPresentacion` agrega `mermaTeorica: number`, `resultadoMerma: number | null` (además de `deberiaRegresar`, `faltante`).
  - `TotalesCorte` agrega los 8 conceptos nuevos sumados, `mermaTeorica: number` y `faltanteMerma: number | null`.
  - `deberiaRegresar(m: Pick<MovimientoPresentacion, 'cargadas'|'vendidas'|'regaladas'|'mermaEntregada'|'mermaAlmacen'|'consumo'|'cambiosEntregados'|'cambiosRecibidos'>): number`
  - `mermaTeorica(m: Pick<MovimientoPresentacion, 'mermaRecibida'|'mermaAlmacen'>): number`
  - `claveTamano(volumen: string): string`
  - `mililitros(volumen: string): number | null`
  - `compararTamano(a: string, b: string): number` (por volumen)
  - `faltanteDelDia(lineas: readonly { volumen: string; valor: number | null }[]): number` — D1.
  - `estadoCorte(hecho: boolean, totales: Pick<TotalesCorte, 'faltante'|'faltanteMerma'>): EstadoCorte` (cambia la firma: antes recibía líneas).
  - `armarCorte(movimientos, hecho)` devuelve las líneas **ordenadas** por `compararTamano(volumen)`, luego `producto` (`localeCompare` `'es'`), luego `presentacionId`.
  - `existenciasPorPresentacion` sin cambio de firma: usa la teórica nueva.

- [ ] **Paso 1: Pruebas que fallan.** Reemplaza las de `deberiaRegresar`, `estadoCorte` y `armarCorte` y agrega:
  - `deberiaRegresar`: ejemplo del cliente 500 ml Horchata `{cargadas: 1000, vendidas: 800, mermaEntregada: 10, cambiosEntregados: 5, consumo: 1, resto 0}` → `184`; Jamaica `{800, 750, cambiosRecibidos: 5, regaladas: 5}` → `50`; Tamarindo `{750, 720, mermaEntregada: 2}` → `28`; cada concepto por separado resta 1 (y `cambiosRecibidos` suma 1); negativo no se recorta.
  - `mermaTeorica({mermaRecibida: 8, mermaAlmacen: 2})` → `10`.
  - `claveTamano`: `"500 ml"`, `"500ML"`, `" 500ml "` → `"500ml"`.
  - `mililitros`: `"355 ml"`→355, `"1 L"`→1000, `"1.5 L"`→1500, `"1,5 lt"`→1500, `"Garrafón"`→null.
  - `compararTamano`: orden `["1 L", "Garrafón", "355 ml", "600 ml", "500ml"]` → `["355 ml", "500ml", "600 ml", "1 L", "Garrafón"]`.
  - `faltanteDelDia`: 355 ml `[−1, +1]` → 0 (ejemplo del cliente); 500 ml `[0, 1, 0]` → 1; 355 ml `[2]` + 500 ml `[−3]` → 2 (D1); `null`s cuentan como 0.
  - `estadoCorte`: sin hacer → `sin_corte`; hecho con `faltante 0, faltanteMerma 0` → `hecho`; con `faltanteMerma 1` → `con_faltante`.
  - `armarCorte` hecho con el ejemplo del Excel 355 ml (Horchata teórica 184/real 185, Jamaica 50/49, Tamarindo 28/28) → `totales.faltante` 0; merma 355 ml (Horchata recibida 8 + almacén 2 / real 10; Jamaica 2/1; Tamarindo 0/0) → `resultadoMerma` 0 y 1, `totales.faltanteMerma` 1, estado `con_faltante`; sin hacer → `faltante`, `resultadoMerma`, `totales.faltante`, `totales.faltanteMerma` en `null`; orden de líneas por tamaño y producto.
  - `existenciasPorPresentacion`: con `mermaEntregada 2, mermaAlmacen 1, consumo 1, mermaRecibida 5` la existencia es `cargadas − vendidas − regaladas − 4` (la recibida no suma).
  - Ajusta las pruebas que quedan (`faltante`, `validarCorte`, `planCorte`) solo si dejan de compilar.

- [ ] **Paso 2:** `npm test --workspace=apps/backend -- reglas-corte` → FALLA (no existen las funciones/campos nuevos).

- [ ] **Paso 3: Implementa** en `reglas-corte.ts`. `resultadoMerma = hecho ? mermaTeorica − merma : null`. `totales.faltante = hecho ? faltanteDelDia(líneas con valor = faltante) : null`; igual `faltanteMerma` con `resultadoMerma`. `mililitros`: número con `.` o `,` decimal seguido de unidad `ml` (×1) o `l`/`lt`/`lts`/`litro(s)` (×1000), sin importar mayúsculas/espacios; si no, `null`. Actualiza el comentario de cabecera (ya resta merma y consumo; cambios en 0 hasta T-33).

- [ ] **Paso 4:** `npm test --workspace=apps/backend -- reglas-corte` → PASA.

- [ ] **Paso 5: Commit** `Corte: teórica con merma y consumo, merma teórica y faltante por tamaño (reglas)`.

---

### Tarea 2: Consulta, servicio y e2e (backend)

**Files:**
- Modify: `apps/backend/src/modules/produccion/cortes.repository.ts` (`movimientosDelDia`)
- Modify: `apps/backend/src/modules/produccion/cortes.service.ts` (`FilaCorte`, `LineaCortePantalla`, `lista`)
- Test: `apps/backend/test/cortes.e2e-spec.ts`, `apps/backend/test/ventas-inventario.e2e-spec.ts`

**Interfaces:**
- Consumes: todo lo de la Tarea 1.
- Produces (copia exacta para la Tarea 3):
  - `LineaCortePantalla` = `Pick<LineaCorte, 'presentacionId'|'nombre'|'producto'|'volumen'|'cargadas'|'vendidas'|'regaladas'|'mermaEntregada'|'mermaRecibida'|'mermaAlmacen'|'consumo'|'cambiosEntregados'|'cambiosRecibidos'|'deberiaRegresar'|'buenas'|'faltante'|'merma'|'mermaTeorica'|'resultadoMerma'>`.
  - `FilaCorte` agrega `mermaFaltante: number | null` (= `totales.faltanteMerma`); `piezasFaltantes` = `totales.faltante` (regla D1).
  - `estado` de la fila con la firma nueva de `estadoCorte`.

- [ ] **Paso 1: Pruebas e2e que fallan.** Agrega un helper `crearMovimiento({ vendedorId, sucursalId, fecha, tipo, clienteId?, borrado?, lineas: { presentacionId, sentido, piezas }[] })` que escribe directo en `movimiento_inventario` (`id` = `randomUUID()`, `registrado_en = now()`) y `movimiento_inventario_linea`; límpialo en el `afterAll` como las demás tablas. Pruebas:
  - "la merma y el consumo de la tablet bajan la teórica y arman la merma teórica": carga aceptada 50 Jamaica 500 ml; venta 30; `merma_cliente` recibido 4 + entregado 3; `merma_trayecto` entregado 2; `consumo` entregado 1 → `deberiaRegresar` 14, `mermaRecibida` 4, `mermaEntregada` 3, `mermaAlmacen` 2, `consumo` 1, `mermaTeorica` 6. Guardar `buenas 13, merma 5` → `faltante` 1, `resultadoMerma` 1, `totales.faltante` 1, `totales.faltanteMerma` 1; en la lista `piezasFaltantes` 1, `mermaFaltante` 1, `estado` `con_faltante`.
  - "un movimiento borrado, de otro día o de otro vendedor no cuenta".
  - "un vendedor con solo merma o consumo ese día sale en la lista".
  - "las líneas vienen ordenadas por tamaño y producto, con `producto` y `volumen`": presentaciones `600 ml`, `355 ml`, `1 L` → orden 355, 600, 1 L.
  - "dentro de un tamaño un sobrante tapa un faltante; entre tamaños no": dos productos 355 ml (resultados −1 y +1) y uno 500 ml (+2) → `totales.faltante` 2.
  - En `ventas-inventario.e2e-spec.ts`: con control de inventario prendido, carga aceptada 10, `merma_trayecto` 2 y `consumo` 1 → vender 8 da 409 ("faltan 1"); vender 7 pasa; un `merma_cliente` solo recibido no cambia lo vendible. (Usa el helper de movimiento de ese archivo o uno igual.)
  - Ajusta las pruebas existentes que comparan líneas completas (agregan los campos nuevos en 0).

- [ ] **Paso 2:** `npm run test:e2e --workspace=apps/backend -- cortes ventas-inventario` → FALLAN las nuevas. (Requiere Docker y `npm run supabase start`; si la base local está atrasada, `npm run supabase -- migration up --local`.)

- [ ] **Paso 3: Implementa.** En `movimientosDelDia` agrega al `with mov` un `union all` desde `movimiento_inventario mi join movimiento_inventario_linea l` con `mi.fecha = fecha`, `mi.deleted_at is null`, repartiendo `l.piezas` con `case` en `merma_entregada` (`merma_cliente`+`entregado`), `merma_recibida` (`merma_cliente`+`recibido`), `merma_almacen` (`merma_trayecto`) y `consumo` (`consumo`); las demás ramas ponen 0 en esas columnas. El `select` final suma las cuatro, devuelve `p.nombre as producto`, `pr.volumen as volumen` y `0 as "cambiosEntregados"`, `0 as "cambiosRecibidos"`. El orden final lo pone `armarCorte`. En el servicio, mapea los campos nuevos y `mermaFaltante`. Actualiza los comentarios que dicen "cargadas − vendidas − regaladas".

- [ ] **Paso 4:** `npm run test:e2e --workspace=apps/backend -- cortes ventas-inventario` y `npm test --workspace=apps/backend` → PASAN; `npm run lint --workspace=apps/backend` y `npm run build --workspace=apps/backend` sin errores.

- [ ] **Paso 5: Commit** `Corte: la consulta suma merma y consumo de la tablet; lista con faltante de merma`.

---

### Tarea 3: Reglas puras del portal (`lib/cortes.ts`)

**Files:**
- Modify: `apps/portal/src/lib/cortes.ts`
- Test: `apps/portal/src/lib/cortes.test.ts`

**Interfaces:**
- Consumes: forma de `LineaCortePantalla`, `TotalesCorte` y `FilaCorte` de la Tarea 2 (copiarlas tal cual en `LineaCorte`, `TotalesCorte`, `FilaCorte`).
- Produces (los usa la Tarea 4):
  - `claveTamano`, `mililitros`, `compararTamano` — copia exacta de la Tarea 1 (comentario que diga dónde está la normativa).
  - `FilaVistaCorte` agrega `resultadoMerma: number | null` (teórica − merma escrita; misma regla de visibilidad que `faltante`).
  - `GrupoVistaCorte { tamano: string; filas: FilaVistaCorte[]; totales: { deberiaRegresar: number; buenas: number; faltante: number | null; mermaTeorica: number; merma: number; resultadoMerma: number | null } }` — `tamano` = volumen de la primera fila; totales de resultado = suma con signo de los visibles, `null` si ninguno visible.
  - `VistaCorte` agrega `grupos: GrupoVistaCorte[]` (orden `compararTamano`, dentro por `producto`), y `totales.faltante` / `totales.faltanteMerma` con la regla D1 (solo con `hecho`, si no `null`).
  - `etiquetaEstadoCorte(fila: Pick<FilaCorte, 'estado'|'piezasFaltantes'|'mermaFaltante'>)`: `con_faltante` → texto `Faltan N` si piezas > 0, `N de merma` si merma > 0, unidos con `" · "`; solo merma = `Faltan N de merma`. Ej.: `"Faltan 3 · 1 de merma"`, `"Faltan 2 de merma"`, `"Faltan 3"`.
  - `estadoDeCorte(corte)` devuelve también `mermaFaltante`.
  - `lineaAgregada(presentacionId: string, producto: string, volumen: string): LineaCorte` (todo en 0, `nombre` = `producto + " " + volumen`, resultados `null`).
  - `presentacionesParaAgregar` devuelve `{ id, nombre, producto, volumen }[]`.

- [ ] **Paso 1: Pruebas que fallan** en `cortes.test.ts`: copias de las de `claveTamano`/`mililitros`/`compararTamano` de la Tarea 1; `vistaCorte` con el ejemplo 355 ml del cliente (hecho; grupo total `faltante` 0, merma total `resultadoMerma` 1); grupos en orden con una línea agregada de `"1 L"` y otra de `"500ML"` que cae en el grupo de `"500 ml"`; sin hecho solo las tocadas muestran resultados y el total del día es `null`; D1 entre tamaños; las tres frases de `etiquetaEstadoCorte`. Ajusta las pruebas viejas a la forma nueva.

- [ ] **Paso 2:** `npm test --workspace=apps/portal -- src/lib/cortes` → FALLA.

- [ ] **Paso 3: Implementa** en `lib/cortes.ts`; cambia el comentario de cabecera para apuntar a este spec.

- [ ] **Paso 4:** `npm test --workspace=apps/portal -- src/lib/cortes` → PASA.

- [ ] **Paso 5: Commit** `Portal: secciones por tamaño y merma teórica en las reglas del corte`.

---

### Tarea 4: Pantallas del corte (portal)

**Files:**
- Modify: `apps/portal/src/components/produccion/corte-vendedor.tsx`, `apps/portal/src/components/produccion/pantalla-corte.tsx`
- Test: `apps/portal/src/components/produccion/corte-vendedor.test.tsx`, `apps/portal/src/components/produccion/pantalla-corte.test.tsx`

**Interfaces:**
- Consumes: `vistaCorte(...).grupos`, `etiquetaEstadoCorte`, `estadoDeCorte`, `lineaAgregada(id, producto, volumen)`, `presentacionesParaAgregar` de la Tarea 3.

- [ ] **Paso 1: Pruebas que fallan.**
  - `corte-vendedor.test.tsx`: con líneas de 355 ml y 500 ml salen dos encabezados de sección con el volumen y en orden; encabezados de columna "Piezas teóricas por regresar", "Piezas reales retornadas", "Resultado", "Merma teórica por regresar", "Merma real validada", "Resultado"; el renglón dice solo el producto ("Horchata"); cada sección tiene su renglón "Total 355 ml"; un resultado positivo sale en rojo (clase `text-destructive`) y uno negativo como número negativo sin rojo; escribir en "Merma real validada de Horchata 355 ml" recalcula el resultado de merma; los campos tienen `aria-label` `Piezas reales de <nombre>` y `Merma real de <nombre>`; agregar una presentación de otro tamaño crea su sección; la pastilla dice "Faltan 1 · 1 de merma" con el corte guardado de ese caso.
  - `pantalla-corte.test.tsx`: la pastilla de la lista dice "Faltan 3 · 1 de merma" y "Faltan 2 de merma".
  - Ajusta las pruebas viejas (columnas Cargadas/Vendidas/Regaladas ya no están).

- [ ] **Paso 2:** `npm test --workspace=apps/portal -- produccion/corte produccion/pantalla-corte` → FALLA.

- [ ] **Paso 3: Implementa** la tabla de `corte-vendedor.tsx`: una sola `Tabla` (`table-fixed`, `colgroup`: producto flexible + 6 columnas `w-28`), encabezado de dos niveles ("Producto terminado" sobre 3 columnas, "Merma" sobre 3), y por grupo un renglón de sección con el tamaño (`FilaGrupo` si sirve, si no un `<tr>` con `colSpan={7}`), sus filas y un `FilaTotal` "Total <tamaño>"; al pie, un renglón con los faltantes del día ("Faltan N" / "N de merma" en rojo, vacío si 0). Los resultados: `> 0` en rojo y negrita, `< 0` el número con signo en gris, `0` "0", `null` vacío. `Ayuda` en "Piezas teóricas por regresar" con el texto `"Cargadas − vendidas − promoción − merma entregada al cliente − merma de almacén − consumo − cambios entregados + cambios recibidos."` y en "Merma teórica por regresar" con `"Merma recibida del cliente + merma de almacén."`. Conserva "Vendió más de lo cargado" bajo el producto, "Agregar presentación", guardar/cancelar y `useConfirmar` como están. Quita `LEYENDA`. La descripción del encabezado: `"<día>. Cuenta lo que regresó y anota las piezas buenas y la merma de cada producto."`. En `pantalla-corte.tsx` solo cambia lo que pida la firma nueva de `etiquetaEstadoCorte`.

- [ ] **Paso 4:** `npm test --workspace=apps/portal` y `npm run lint --workspace=apps/portal` → PASAN.

- [ ] **Paso 5: Commit** `Portal: Corte por tamaño con bloques de producto terminado y merma`.

---

### Tarea 5: Revisión en navegador y documentación

**Files:**
- Modify: `CLAUDE.md` (bloque "Corte de mercancía (pieza 3)" y la línea del bloque T-17 que cita `existenciasPorPresentacion`)
- Modify (vault `../jawa-obsidian-memory`): la nota de dominio del corte que enlace la fuente de 2026-11-16 (busca con `grep -rl "Corte de mercancía" 20-* 10-*`), `00-Inicio/Estado del proyecto.md` (fila 3: el pendiente "restar merma y consumo del #150" queda hecho; agregar que el corte va por tamaño) y la bitácora del día.

- [ ] **Paso 1:** Levanta backend (puerto 3010, `DATABASE_URL` local) y portal; con datos de prueba en la base **local** (dos tamaños, merma de cliente, de trayecto y consumo), abre Producción → Corte a 1366 px y a 1920 px: sin scroll horizontal en la página, secciones en orden, resultados en rojo, guardar y volver a abrir conserva lo escrito. Apaga los servidores al terminar.
- [ ] **Paso 2:** Actualiza `CLAUDE.md`: la regla del corte (C3, C4, D1 por tamaño, cambios en 0) y que la existencia del portal ya descuenta merma y consumo.
- [ ] **Paso 3:** Actualiza el vault (frontmatter `actualizado: 2026-11-18`) y haz commit allá.
- [ ] **Paso 4: Commit** `Docs: corte por tamaño y merma`.

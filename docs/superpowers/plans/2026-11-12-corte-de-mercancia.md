# Corte de mercancía — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** *Producción → Corte*: por día y vendedor, comparar lo que debería regresar (cargadas − vendidas − regaladas)
contra lo que contó el almacén (buenas y merma), con el faltante en rojo. Absorbe a *Producción → Retorno*.

**Architecture:** La tabla `retorno` gana `piezas_merma` y aparece el encabezado `corte_mercancia`. Un servicio nuevo
`cortes.*` en `modules/produccion/` reemplaza a `retornos.*`; la cuenta vive en una regla pura `reglas-corte.ts`. El
portal llena `/produccion/corte` (lista del día → corte del vendedor) con las piezas de `components/ui/`.

**Tech Stack:** NestJS + Kysely + Postgres (Supabase local), Next.js + Vitest/Testing Library, Jest e2e.

**Spec:** `docs/superpowers/specs/2026-11-12-corte-de-mercancia-design.md` (léelo completo; D1–D13 mandan).

## Global Constraints

- "Hoy" = Tijuana (`hoyEnTijuana()`); fecha futura = 400 con `hoyEnTijuana` en la respuesta, como Retorno hoy.
- Todo vivo (`deleted_at is null`) en `retorno`, `corte_mercancia`, `carga`, `venta_nota`, `venta_nota_detalle`.
- Cargadas = la misma suma de cargas **aceptadas** que usa hoy `retornos.repository.ts` (`cargadasDelDia`); reutilízala.
- Vendidas = `cantidad`, regaladas = `cantidad_promocion`, de líneas vivas de ventas vivas del vendedor con esa `fecha`,
  cualquier status.
- Permiso `retorno.gestionar`; alcance como Retorno (atado: su sucursal; vendedor ajeno = 404). No tocar perfiles.
- Migración con timestamp único (`ls supabase/migrations`; posterior a `20261111120000`); aplicarla local
  (`npm run supabase -- migration up --local`) y `npm run db:types --workspace=apps/backend`.
- No tocar `apps/tablet` ni el contrato de sincronización.
- Textos fijos: "Corte", "Sin corte", "Corte hecho", "Faltan N", "Sin carga", "Hacer corte", "Ver corte",
  "← Volver a Corte", "Guardar corte", "Cancelar", "Vendió más de lo cargado", "¿El vendedor no regresó ninguna pieza?",
  y la leyenda de §5 del spec.
- Pruebas portal: `NODE_OPTIONS=--no-experimental-webstorage npm test --workspace=apps/portal`.

## Review Focus

- Vendedor que vendió todo: guardar sin piezas crea el encabezado y queda "Corte hecho", no "Sin corte".
- Venta eliminada (T-17) o con líneas borradas: no cuenta en vendidas.
- Recarga sin aceptar: no cuenta en cargadas → "Vendió más de lo cargado", sin romper totales.
- Día con filas de `retorno` previas a la migración: sale como corte hecho con sus buenas.
- Dos guardados del mismo vendedor y día a la vez: se serializan (fila de `vendedor` `for no key update`), sin 500.

---

### Tarea 1: Backend

**Files:** migración `supabase/migrations/<timestamp>_corte_mercancia.sql`; `apps/backend/src/modules/produccion/`
(crear `reglas-corte.ts` + `.spec.ts`, `cortes.controller.ts`, `cortes.service.ts`, `cortes.repository.ts`, `dto/` del
corte; quitar `retornos.controller.ts`, `retornos.service.ts`, `retornos.repository.ts` y sus DTO tras mover lo
reutilizable; `produccion.module.ts`); e2e `apps/backend/test/cortes.e2e-spec.ts` (reemplaza `retornos.e2e-spec.ts`).

**Produces (los usa la Tarea 2):**
- `GET /cortes?fecha&sucursal?` → `{ fecha, hoy, vendedores: FilaCorte[] }`, `FilaCorte = { vendedor: {id, nombre},
  sucursal: {id, codigo}, piezasCargadas: number, estado: 'sin_corte' | 'hecho' | 'con_faltante', sinCarga: boolean,
  piezasFaltantes: number | null, hechoEn: string | null }`, orden sucursal, nombre.
- `GET /cortes/vendedor?fecha&vendedor` y `PUT /cortes/vendedor` (cuerpo `{ fecha, vendedor, lineas: {presentacionId,
  buenas, merma}[] }`) → `CorteVendedor = { fecha, hoy, vendedor, sucursal, lineas: LineaCorte[], totales,
  hecho: { en: string, por: string } | null }`, `LineaCorte = { presentacionId, nombre, cargadas, vendidas, regaladas,
  deberiaRegresar, buenas, merma, faltante: number | null }`.

- [ ] Migración: `retorno.piezas_merma integer not null default 0`; cambiar el check a `piezas >= 0 and piezas_merma >= 0
  and piezas + piezas_merma > 0`; tabla `corte_mercancia` (§3 del spec) con único parcial `(fecha, vendedor_id)` vivo,
  índice `(sucursal_id, fecha)`, trigger `set_updated_at`; relleno de encabezados desde `retorno` (D13); comentario
  con el pre-flight de §7. Actualizar la descripción de `retorno.gestionar` si hay columna de descripción. Aplicar local +
  `db:types`.
- [ ] `reglas-corte.ts` (puras): `deberiaRegresar({cargadas, vendidas, regaladas}): number` (sin recortar),
  `faltante(deberia, buenas, hecho): number | null` (null si no hecho), `estadoCorte(hecho, lineas): 'sin_corte' |
  'hecho' | 'con_faltante'`, `armarCorte(...)` con totales. Pruebas: ejemplo del spec (68/35/0 → 33; buenas 28 → 5),
  negativo, sobrante, no hecho → null, vendió todo → hecho sin faltante.
- [ ] Repositorio + servicio + controlador con las reglas de §4 y D11/D13 (lista incluye vendedores con carga aceptada,
  venta o conteo; `sinCarga` si no tiene carga aceptada; presentaciones = con carga, venta o conteo, aunque estén
  desactivadas; el PUT acepta presentaciones vivas nuevas, reemplaza el día, 0/0 = baja lógica, crea/actualiza el
  encabezado aunque no haya líneas, todo en una transacción con el vendedor bloqueado).
- [ ] Quitar `/retornos` del módulo (D13).
- [ ] e2e: lista del día (estado, sinCarga, faltantes), corte con venta eliminada y línea borrada excluidas, recarga sin
  aceptar, guardar todo en 0 → hecho, corregir día pasado, fecha futura 400, vendedor de otra sucursal 404, sin permiso
  403, día con retorno previo (relleno) sale hecho, dos PUT concurrentes sin 500.
- [ ] `npm run lint`, `build`, `test`, `test:e2e` del backend. Commit.

### Tarea 2: Portal

**Files:** `apps/portal/src/lib/cortes.ts` (+ test; reemplaza `lib/retornos.ts`), `components/produccion/pantalla-corte.tsx`,
`corte-vendedor.tsx` (+ tests; reemplazan `pantalla-retorno*`), `app/(portal)/produccion/corte/page.tsx`,
`app/(portal)/produccion/retorno/page.tsx` (redirige a `/produccion/corte`, conservando `?sucursal`),
`components/layout/nav-config.ts` (Corte sin `pronto`, Retorno fuera del menú) y su prueba.

**Consumes:** los tipos y endpoints de la Tarea 1 (duplicados en `lib/cortes.ts`; el portal no importa del backend).

- [ ] `lib/cortes.ts`: tipos + `leerCortesDelDia`, `leerCorteVendedor`, `guardarCorteVendedor`.
- [ ] Pantalla de lista (§5): `EncabezadoPantalla`, día (Hoy · Ayer), sucursal según alcance, `Tabla` de vendedores con
  `Etiqueta` de estado y "Sin carga", botón "Hacer corte"/"Ver corte"; con "Todas", `FilaGrupo sucursal=…` por
  sucursal como en Dashboard.
- [ ] Corte del vendedor (pantalla completa, "← Volver a Corte"): tabla por presentación con campos Buenas y Merma
  (vacíos si no hay guardado, nunca prellenados con el teórico), Faltante en rojo si > 0, sobrante sin rojo, aviso
  "Vendió más de lo cargado" si debería < 0, fila de totales, "Agregar presentación", leyenda; "Guardar corte" (sin
  piezas → `useConfirmar` "¿El vendedor no regresó ninguna pieza?"), "Cancelar"; salir con cambios pregunta con
  `useConfirmar`. Días futuros no se ofrecen. Cabe a 1366 px (`table-fixed` + `colgroup`).
- [ ] Pruebas de cada punto; `npm run lint --workspace=apps/portal`, `tsc`, pruebas. Commit.

### Tarea 3: Documentación

- [ ] `CLAUDE.md`: reemplazar el bloque "Retorno del vendedor" por "Corte de mercancía" (tablas, endpoints, regla,
  D13, migración y su protocolo de nube con el pre-flight).
- [ ] Vault: `Estado del proyecto` (pieza 3), bitácora 2026-11-12, enlace a la fuente de respuestas. Commit (vault aparte).

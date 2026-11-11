# Ruta Diaria parte 2 (revisión de notas) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Revisión de papeles en la tarde con las notas asignadas y las ventas a crédito del día, corregible hoy y ayer,
y el número de notas NO entregadas en rojo en Dashboard y Flujo diario.

**Spec:** `docs/superpowers/specs/2026-11-11-ruta-diaria-parte-2-revision-notas-design.md` (léelo completo).

## Global Constraints

- "Hoy"/"ayer" = Tijuana (`hoyEnTijuana()` backend; el portal recibe del servidor si el día es editable o usa `lib/ventas.ts`).
- Montos en centavos. Todo vivo (`deleted_at is null`) en `venta_nota`, `nota_asignada`, `cobranza_abono`.
- Saldo = `monto_total − abonos vivos` (misma expresión que `detalle.repository.ts`).
- Permiso para guardar: `nota_papel.revisar` (ya existe). Alcance: vendedor de otra sucursal = 404.
- Textos fijos: "Notas Asignadas Cobradas", "Notas Asignadas NO cobradas por Entregar", "Notas Nuevas x Cobrar
  Entregadas", "Notas de Ventas NO Entregadas", "Guardar revisión", "Cancelar".
- Tipos duplicados backend `reglas-detalle.ts` / `reglas-flujo-diario.ts` ↔ portal `lib/flujo-diario.ts`: cambian juntos.
- No tocar `apps/tablet`. Migración con timestamp único (`ls supabase/migrations`), aplicarla local y `db:types`.
- Pruebas portal: `NODE_OPTIONS=--no-experimental-webstorage npm test --workspace=apps/portal`.

### Tarea 1: Backend

**Files:** migración `supabase/migrations/20261111120000_nota_asignada_papel.sql`; `apps/backend/src/modules/estadisticas/`
(`detalle.repository.ts`, `reglas-detalle.ts` + spec, `dashboard.service.ts`, `dashboard.controller.ts`, `dto/`,
`flujo-diario.repository.ts`, `reglas-flujo-diario.ts` + spec); e2e `apps/backend/test/` (dashboard / flujo-diario).

- [ ] Migración: `nota_asignada.papel_entregado boolean`, `papel_revisado_en timestamptz`, `papel_revisado_por_usuario_id
  uuid references usuario`, check `(papel_entregado is null) = (papel_revisado_en is null)`. Aplicar local + `db:types`.
- [ ] `DetalleVendedorDia` gana `asignadasCobradas` y `asignadasPorEntregar` (cada nota: `ventaNotaId`, `folio`, `cliente`,
  `totalCentavos`, `pendienteCentavos`, `entregada: boolean | null`); `notasCredito` gana `ventaNotaId` y se filtra a
  saldo > 0; una nota asignada a ese vendedor ese día no sale en `notasCredito`. Orden: cliente, folio.
- [ ] `PUT /dashboard/notas-entregadas`: cuerpo `{ vendedor, fecha?, notas: {folio, entregada}[], asignadas?:
  {ventaNotaId, entregada}[] }`; `fecha` por omisión hoy; solo hoy o ayer de Tijuana (otra → 400 "Ese día ya no se puede
  revisar."). Las `notas` deben ser ventas a crédito vivas del vendedor con `fecha` = esa fecha (antes era `<= hoy`:
  mantener compatibilidad aceptando también ese caso solo si `fecha` no viene). Las `asignadas` deben ser `nota_asignada`
  vivas de ese vendedor y fecha. Todo en una transacción; inválido → 400 sin guardar.
- [ ] `FilaVendedorDia.notasNoEntregadas: number | null` (Dashboard y Flujo diario): con notas por revisar ese día
  (asignadas con saldo > 0 + crédito del día con saldo > 0, más las ya revisadas aunque hoy estén pagadas) y ninguna
  revisada → `null`; si no, cuántas tienen `papel_entregado = false` entre `nota_asignada` de ese día y ventas a crédito
  de ese día.
- [ ] Pruebas: unitarias de las reglas (listas, exclusión de pagadas, nueva+asignada sale una vez, conteo null/0/n);
  e2e: guardar asignadas y nuevas, corregir al día siguiente (ayer) sí, antier no (400), vendedor de otra sucursal 404,
  nota pagada por otro vendedor no aparece en nuevas del que la vendió.
- [ ] Commit.

### Tarea 2: Portal

**Files:** `apps/portal/src/lib/flujo-diario.ts` (+ test), `components/flujo-diario/detalle-vendedor-pestanas.tsx`,
`detalle-vendedor.tsx`, `tabla-por-vendedor.tsx`, `components/dashboard/tabla-dashboard.tsx` (+ tests).

- [ ] Tipos al día con la Tarea 1; `guardarNotasEntregadas({vendedor, fecha, notas, asignadas})`.
- [ ] La pestaña de notas (mismo componente en Dashboard y Flujo diario): las tres listas con los textos fijos; casillas
  palomeadas si `entregada` es `null`; "Guardar revisión" manda las dos listas completas con la fecha del detalle;
  "Cancelar" regresa a lo guardado; debajo "Notas de Ventas NO Entregadas" (lo guardado en no, de las dos listas) y las
  de días anteriores que ya existían. En Flujo diario se puede guardar solo si el día es hoy o ayer y hay permiso.
- [ ] Columna "Notas de ventas" (Dashboard y Flujo diario por vendedor): el número `notasNoEntregadas` (rojo si > 0, nada
  si `null`) junto al botón.
- [ ] Pruebas de cada punto; lint y `tsc`.
- [ ] Commit.

### Tarea 3: Documentación

- [ ] `CLAUDE.md` (bloque Flujo diario y Dashboard, casilla "Entregada"): las tres listas, palomeadas por defecto,
  hoy/ayer, `nota_asignada.papel_*`, conteo de no entregadas, migración nueva con su protocolo de nube.
- [ ] Vault: `Estado del proyecto`, bitácora 2026-11-11. Commit (vault aparte).

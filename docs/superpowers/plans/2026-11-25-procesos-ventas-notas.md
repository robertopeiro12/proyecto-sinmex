# Procesos PR B: Ventas y Notas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pestañas Ventas y Notas dentro de *Operación → Procesos* que reemplazan a Registrar venta, Ventas, Facturas y Cobranza, con redirecciones.

**Architecture:** backend mínimo (filtros nuevos en `GET /ventas`); el portal **reutiliza** los componentes de hoy (`components/ventas/`, `components/facturas/`, `components/cobranza/`) dentro de `components/procesos/` en vez de reescribirlos.

**Tech Stack:** NestJS + Kysely + Jest, Next.js + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-procesos-ventas-notas-design.md` (boceto: `docs/superpowers/specs/img/2026-11-25-procesos-boceto-notas.png`; estilo: `img/2026-11-25-procesos-boceto-2.png`)

## Global Constraints

- Sin migración. Ninguna regla de negocio de venta, cobro, factura, edición o eliminación cambia; se reutilizan los endpoints de hoy.
- `GET /ventas`: `folio` exacto (normalizado: sin espacios, mayúsculas), `filtro` ∈ `con_saldo|por_facturar|todas` (omisión `todas` = comportamiento actual); `con_saldo`/`por_facturar` exigen `clienteId` (si no, 400 "Elige un cliente.") e ignoran fechas; cada resultado trae `factura: { estado, numero }` y vendedor.
- Botonera del cobro (R3): la barra dice "Cobrar N notas…" y se oculta con el recuadro abierto; "Cancelar" y "Grabar pago" juntos abajo a la derecha, después de "Así queda".
- Redirecciones: `/operacion/registrar-venta` → `/operacion/procesos?pestana=ventas`; `/operacion/ventas`, `/operacion/facturas` → `?pestana=notas`; `/operacion/cobranza?cliente&nota` → `?pestana=notas&cliente=…&nota=…`; conservan `?sucursal`.
- Estilo del boceto 2 (sin tarjetas con pastillas, tablas sencillas); piezas de `components/ui/`; `useConfirmar`; cabe a 1366 px.
- Roberto tiene backend (3010) y portal (3001) prendidos: no apagar, **no `npm run build`**, sin `git stash`, solo base local.

## Review Focus

1. Cobrar desde Notas graba exactamente lo mismo que la pantalla Cobranza de hoy (mismo cuerpo, misma vista previa, 409 si una nota ya no tiene saldo) y la lista se recarga. → prueba Tarea 2.
2. El botón **Cobrar** de *Cuentas por Cobrar* lleva a Notas con ese cliente elegido y esa nota palomeada. → prueba Tarea 3.
3. Cambiar de cliente arriba limpia casillas, recuadro de cobro y detalle abierto. → prueba Tarea 2.
4. `filtro=con_saldo` sin `clienteId` = 400; `folio` de otra sucursal no aparece (alcance de siempre). → e2e Tarea 1.
5. La venta registrada desde la pestaña Ventas usa el cliente de arriba y no el de una selección anterior. → prueba Tarea 2.

---

### Tarea 1: Backend — filtros de `GET /ventas`
**Files:** `apps/backend/src/modules/ventas-cobranza/dto/buscar-ventas.dto.ts`, el servicio/repositorio de la búsqueda (`ventas-consulta.*` o donde viva `buscar`), e2e de ventas.
- [ ] e2e en rojo (folio exacto; filtro con_saldo = solo notas con saldo según la regla existente de "nota con saldo"; por_facturar = factura pendiente; sin cliente = 400; `factura.estado/numero` y vendedor en cada fila; `todas` igual que hoy) → implementar → e2e de ventas/facturas/cobranza sin regresiones, unit, lint → **Commit** `Ventas: filtros con_saldo, por_facturar y folio en la búsqueda`.

### Tarea 2: Portal — pestañas Ventas y Notas
**Files:** `components/procesos/` (pestañas nuevas, p. ej. `pestana-ventas.tsx`, `pestana-notas.tsx`), `lib/ventas.ts` (tipos y parámetros nuevos de la búsqueda, duplicados del backend), refactor mínimo de `pantalla-registrar-venta.tsx`, `pantalla-ventas.tsx`, `cobranza-cliente.tsx`, `asignar-factura.tsx` para poder usarse dentro de la pestaña (props: cliente dado, sin encabezado propio), + pruebas.
- [ ] Pruebas en rojo (Review Focus 1, 3 y 5; pestañas por permiso; Notas sin cliente; filtros; barra; R3; anotar factura; Ver › y volver; "A favor $X" en la línea del cliente) → implementar según el spec D1–D2 y el boceto → `npm test --workspace=apps/portal`, lint, tsc → **Commit** `Procesos: pestañas Ventas y Notas`.

### Tarea 3: Menú, redirecciones y Cuentas por Cobrar
**Files:** `components/layout/nav-config.ts` (+ su prueba), `app/(portal)/operacion/{registrar-venta,ventas,facturas,cobranza}/page.tsx` (redirect de servidor), lectura de `pestana`/`cliente`/`nota` en la página de Procesos, enlace Cobrar de `components/cuentas-por-cobrar/`.
- [ ] Pruebas en rojo (Review Focus 2; cada redirección con y sin `?sucursal`; el menú ya no las tiene) → implementar → portal completo, lint, tsc → **Commit** `Procesos: Ventas y Notas reemplazan Registrar venta, Ventas, Facturas y Cobranza en el menú`.

### Tarea 4: Navegador y documentación
- [ ] Con los servidores de Roberto, a 1366 px: registrar una venta desde Procesos → Ventas; verla en Notas; cobrar dos notas (ver "Así queda", Cancelar/Grabar juntos); anotar factura; Ver › → editar y volver; redirecciones viejas y el Cobrar de Cuentas por Cobrar. Comentario o cliente de prueba identificable; borrar lo de prueba en la base LOCAL al final.
- [ ] `CLAUDE.md` (bloque de Procesos: PR B; quitar o ajustar menciones de las pantallas viejas como "Registrar venta"/"Cobranza" donde describan navegación), vault (`20-Arquitectura/Portal Web.md`, `00-Inicio/Estado del proyecto.md`, bitácora; commit sin push) → **Commit** `Docs: Procesos PR B`.

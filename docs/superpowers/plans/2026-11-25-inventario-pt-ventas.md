# Inventario de PT con Ventas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pantalla *Producción → Inventario de PT con Ventas* con el inventario real del almacén por día, sus detalles y los ajustes.

**Architecture:** tabla nueva de ajustes; backend en `apps/backend/src/modules/produccion/` (`inventario-pt.*` + reglas puras `reglas-inventario-pt.ts`) que **lee** las fuentes existentes (ventas, `operacion_almacen`, `proceso_oficina`, `movimiento_inventario`, corte/`retorno`); portal en `components/inventario-pt/` + `lib/inventario-pt.ts`.

**Tech Stack:** Postgres/Supabase (migración + pgTAP), NestJS + Kysely + Jest, Next.js + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-inventario-pt-ventas-design.md` (boceto: `docs/superpowers/specs/img/2026-11-25-inventario-pt-ventas-boceto.png`)

## Global Constraints

- Migración `supabase/migrations/20261130120000_inventario_pt_ajuste.sql` (versión única).
- Fórmulas exactas del spec D2: `Final = Inicial − Ventas − Merma − Consumo − Promo − Descuentos + Cambios + Entradas − Envíos`; `Merma acumulada = anterior + Merma − Retiro`; Inicial = Final del día anterior o el del ajuste de ese día.
- Fuentes exactas por columna: spec D2 (todo vivo; merma de vendedores = contada si el corte está hecho, si no teórica; Procesos merma solo con Oficina; retiro solo autorizado; envíos recibidos dentro de Entradas).
- Sin ajuste previo: Inicial/Final/Merma acumulada `null` ("Sin inventario inicial"), nunca 0.
- Permisos nuevos `inventario_pt.ver` e `inventario_pt.ajustar` (grupo `Produccion/Almacen`, con ⓘ en `lib/explicacion-permisos.ts`). Alcance como el Corte.
- Diseño "parecido a todo": piezas de `components/ui/`, estilo de Corte/Registro de Operación, tamaños con `claveTamano`/`compararTamano`, Día + Hoy · Ayer, cabe a 1366 px, `useConfirmar`.
- Roberto tiene backend (3010) y portal (3001) prendidos: no apagar, **no `npm run build`**, sin `git stash`, migración solo a la base LOCAL.

## Review Focus

1. Envío TJ→MX: resta en TJ (Envíos) y suma en MX (Entradas); con "Todas" el total no cambia. → e2e Tarea 2.
2. Un ajuste a media serie: el Inicial de ese día es el del ajuste y los días siguientes encadenan desde ahí; el día anterior no cambia. → unit Tarea 2.
3. Merma de un vendedor: con corte hecho cuenta la contada (no la de la app); sin corte, la teórica; Procesos merma con vendedor no se suma dos veces. → e2e Tarea 2.
4. Una venta, proceso u operación dada de baja deja de contar. → e2e Tarea 2.
5. Presentación sin ningún ajuste anterior: muestra los movimientos pero Inicial/Final vacíos. → unit Tarea 2 + prueba Tarea 3.

---

### Tarea 1: Migración y pgTAP
**Files:** `supabase/migrations/20261130120000_inventario_pt_ajuste.sql`, `supabase/tests/99_inventario_pt_test.sql`, `apps/backend/src/database/schema.d.ts`.
- `inventario_pt_ajuste`: `id`, `sucursal_id`, `presentacion_id`, `fecha`, `inventario_inicial int >= 0`, `merma_acumulada_inicial int >= 0`, `comentario` (1..300 recortado o null), `capturo_usuario_id`, `actualizado_por_usuario_id`, tiempos con trigger de `updated_at`, `deleted_at`; único parcial vivo `(sucursal_id, presentacion_id, fecha)`; índice `(sucursal_id, fecha) where deleted_at is null`. Permisos `inventario_pt.ver`, `inventario_pt.ajustar`.
- [ ] pgTAP rojo → migración → `npm run supabase -- migration up --local`, `npm run supabase -- test db` PASS (ajusta el conteo de permisos de `93_permiso_sucursal_test.sql`) → prueba en autocommit como el CI (base temporal `prueba_ci`, borrarla) → db:types → **Commit** `Inventario de PT: migración (ajustes y permisos)`.

### Tarea 2: Backend
**Files:** `produccion/{reglas-inventario-pt.ts,reglas-inventario-pt.spec.ts,inventario-pt.repository.ts,inventario-pt.service.ts,inventario-pt.controller.ts,dto/inventario-pt.dto.ts}`, `produccion.module.ts`, e2e `apps/backend/test/inventario-pt.e2e-spec.ts`.
**Produces:**
```ts
interface MovimientosDia { ventas: number; merma: number; consumo: number; promo: number; descuentos: number;
  cambios: number; entradas: number; envios: number; retiroMerma: number }
interface RenglonPt extends MovimientosDia { presentacionId: string; producto: string; volumen: string;
  inicial: number | null; final: number | null; mermaAcumulada: number | null; ajustado: boolean }
// GET /inventario-pt?fecha&sucursal&vista=presentacion|producto → { fecha, hoyEnTijuana, renglones: RenglonPt[] }
// GET /inventario-pt/historial?presentacion&desde&hasta&sucursal → { dias: (RenglonPt & { fecha: string })[] }  (≤ 62 días)
// GET /inventario-pt/descuentos?presentacion&fecha&sucursal → { detalle: { quien: string; origen: 'corte'|'nomina'; piezas: number }[] }
// GET /inventario-pt/ajustes?fecha&sucursal → { renglones: { presentacionId, inventarioInicial, mermaAcumuladaInicial, ajustado }[] }  (precarga con lo calculado)
// PUT /inventario-pt/ajustes { fecha, sucursal, renglones: { presentacionId, inventarioInicial, mermaAcumuladaInicial }[], comentario? } → 204
```
Permisos: GET = `inventario_pt.ver`; ajustes = `inventario_pt.ajustar`. `sucursal = todas` solo en GET (suma por presentación de las sucursales; sin ajuste en alguna sucursal → `null` en esa presentación). Fecha futura = 400.
- [ ] Unit de la regla (Review Focus 2 y 5; encadenado; merma acumulada con retiro; por producto suma presentaciones; `null` se propaga) → e2e (cada columna con su fuente; Review Focus 1, 3, 4; permisos; alcance; ajuste PUT y su efecto) → implementar (consultas por día agrupadas, sin N+1; reutiliza la cuenta del corte para la merma de vendedores) → pasan; unit completo, e2e `inventario-pt` + `cortes` + `procesos-corte`, lint → **Commit** `Inventario de PT: backend (cálculo, historial, descuentos y ajustes)`.

### Tarea 3: Portal
**Files:** `lib/inventario-pt.ts` (tipos duplicados), `components/inventario-pt/` (pantalla, tabla, historial, a quién, ajustes + pruebas), `app/(portal)/produccion/inventario-pt-ventas/page.tsx`, `nav-config.ts` (Producción, después de Registro de Operación), `lib/explicacion-permisos.ts`.
- Seguir el boceto y el spec D1, D3, D4 al pie de la letra.
- [ ] Pruebas rojas (tabla por tamaño con totales; Por producto; "Sin inventario inicial"; "Ajustado"; historial; a quién; ajustes: precarga, solo cambiados, TAB, guardar; sin permiso) → implementar → `npm test --workspace=apps/portal`, lint, tsc → **Commit** `Inventario de PT: pantalla con historial, descuentos y ajustes`.

### Tarea 4: Navegador y documentación
- [ ] Con los servidores de Roberto, a 1366 px: capturar un ajuste de arranque, ver la tabla de ayer y hoy con datos de la base local (crear lo necesario con comentario "Prueba PT" y borrarlo al final), historial, a quién, Todas, Por producto. Comparar contra el boceto.
- [ ] `CLAUDE.md` (bloque nuevo "Inventario de PT con Ventas": fórmula, fuentes, ajustes, permisos, endpoints, migración y pre-flight), vault (`10-Dominio/Modulos/Inventario.md`, `00-Inicio/Estado del proyecto.md`, bitácora; commit sin push) → **Commit** `Docs: Inventario de PT con Ventas`.

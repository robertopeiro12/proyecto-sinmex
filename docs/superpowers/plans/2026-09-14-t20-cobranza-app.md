# T-20 · Cobranza / Abono — App Tablet — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el vendedor cobre en ruta sin red una nota pendiente —liquidándola o abonando, con método y fecha de pago y folio propio— y que al sincronizar el servidor reparta el dinero entre las notas del cliente y su saldo a favor, cambie el status de las notas y deje el cobro listo para el corte; y que una venta de contado deje su cobro registrado.

**Architecture:** Backend: migración `20260914160000_cobranza_saldo_favor` (columnas `folio`, `origen`, `fecha_operacion` en `cobranza_abono` y tabla `saldo_favor_movimiento`); `CobranzasService.registrarCobranza(cobranza, contexto, trx)` en `ventas-cobranza/` bloquea las notas del cliente `for update`, reparte con la función pura `repartirPago` y escribe filas `cobranza_abono` + status de `venta_nota` + movimiento de saldo a favor; `despacho-cobranza.ts` conecta `tipo: "cobranza"` al despachador de T-16; `VentasService.registrarVenta` deja el cobro `venta_contado`; el `pull` pasa a saldo derivado, abonos por nota, saldo a favor por cliente y notas cerradas con `activo: 0`. Tablet: migración local 005, `repartirPago` duplicada a propósito con los mismos casos de prueba, repositorio de cobranzas que emite el folio y aplica el reparto local en la misma transacción, `fuenteCobranzas`, pantalla captura → revisión → folio y acción "Cobrar notas pendientes (N)" al grabar una venta.

**Tech Stack:** NestJS 11 · Kysely 0.28 · Postgres (Supabase local) · pgTAP · Jest 30 (backend) · Expo SDK 57 / React Native 0.86 · expo-router · SQLite (`expo-sqlite` en la tablet, `better-sqlite3` en pruebas) · Jest 29 + ts-jest (tablet)

**Spec:** `docs/superpowers/specs/2026-09-14-t20-cobranza-app-design.md` — las decisiones se citan como D1…D17. Donde el spec y el código discrepan en un hecho, este plan sigue al código y lo dice en la tarea; las decisiones que el plan añade van marcadas **Ruling propuesto** (lista completa al final, en "Discrepancias y rulings").

## Global Constraints

- **Worktree y rama:** todo se hace en `/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t20`, rama `feature/t-20-cobranza-app`, apilada sobre `feature/t-16-venta-app` @ `008dc9e` (PR #89 abierto, sin merge). **Nunca** se toca `proyecto-sinmex`, `proyecto-sinmex-t16`, `proyecto-sinmex-t40` ni `proyecto-sinmex-b`: son de otras sesiones. No se hace `push` de la rama ni se abre PR dentro de las tareas (lo hace el controlador al final).
- **Todo comando se corre desde la raíz del worktree** (`/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t20`) con `--workspace=`, nunca entrando a `apps/*`.
- **Idioma del código:** identificadores, comentarios y mensajes de error **en español**, **sin acentos en los identificadores ni en los comentarios de código** (sí en los textos que lee el vendedor). Los comentarios explican *por qué*, no *qué*.
- **Stack local:** Docker Desktop (`docker context ls` → `desktop-linux`). `psql` no está instalado en el host: `docker exec -i supabase_db_proyecto-sinmex psql -U postgres`.
- **Base local compartida.** Tiene aplicada `20260914120000_prospecto_campos_opcionales` (T-40), que **no está en esta rama**. Por eso `npm run supabase -- migration up --local` falla con `LegacyMigrationMissingLocalError`. **Nunca `db reset`, nunca `migration repair` de esa versión.** Cómo aplicar la migración nueva: Task 1, Step 5. Antes de correr la e2e del backend, confirma con el controlador que ninguna otra sesión la está corriendo contra la base local.
- **`db:types` arrastra la deriva de T-40:** regenerar pone `domicilio: string | null` y `lista_precio_id: string | null` en `export interface Cliente`. En esta rama **solo** entran los hunks de T-20; los dos de `Cliente` se revierten (Task 1, Step 7) y el commit lo explica.
- **`sinmex dev`:** ningún implementador ejecuta nada contra `sinmex dev`. El único paso que lo hace es **SINMEX DEV (controlador)** de la Task 1, que corre el controlador. `npm test`, `npm run test:e2e` y `npm run db:types` usan `.env.test` → Postgres local. No se levanta `npm run backend`.
- **pgTAP:** `npx supabase test db`.
- **Contrato duplicado (CLAUDE.md):** "Los tipos están **duplicados** a propósito en `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y `apps/tablet/src/sincronizacion/contrato.ts` (la tablet no puede importar del backend: Metro). Si tocas uno, toca el otro y el `docs/` en el mismo commit." Todo cambio de T-20 es aditivo: **`CONTRATO_ACTUAL` sigue en 1** y una tablet vieja no se rompe.
- **Zona horaria (CLAUDE.md):** "`fecha_operacion` la calcula la tablet con su reloj local (Tijuana) y el servidor NUNCA la re-deriva de UTC." `cobranza_abono.fecha_operacion` es la del sobre tal cual (D3). Un `date` de Postgres se lee con `to_char(..., 'YYYY-MM-DD')`, nunca con `toISOString()`.
- **Idempotencia (CLAUDE.md):** la idempotencia vive en `unique (vendedor_id, clave_idempotencia)`; la clave es el `id` local de la fila en SQLite; una operación **rechazada no deja fila** — ni en el buzón ni en `cobranza_abono` ni en `saldo_favor_movimiento`.
- **Dinero:** centavos enteros en la tablet y en el cable; `numeric(12,2)` en Postgres; la frontera es **solo** `apps/backend/src/modules/sincronizacion/dinero.ts` (`aCentavos` / `aPesos`). En pantalla, dinero solo con `pesos()` dentro de `<Cifra>`. En la tablet, el monto capturado se convierte con `leerMontoCentavos` (sin coma flotante).
- **Folio (CLAUDE.md):** "**Emite dentro de la transacción que guarda la operación.** `folios.emitir()` usa `savepoint`, no `begin`, para poder anidarse." La cobranza lleva folio propio (D11) y comparte el tope de 99 por vendedor y día con las ventas. En `cobranza_abono.folio` se repite en todas las filas de un mismo cobro: **no es unique** en esa tabla, así que `RESTRICCIONES_DE_FOLIO` y `esColisionDeFolio` de `despacho.ts` **no cambian** (la colisión la sigue detectando `uq_sync_operacion_folio`).
- **Dirección de dependencias (ADR-0009):** `ventas-cobranza/` no importa tipos del contrato; lanza `CobranzaRechazada` con su razón y `sincronizacion/` la traduce con `CODIGO_POR_RAZON_COBRANZA`.
- **Coordinación con T-40 (PR #90, otra sesión):** en `despacho.ts` el orden es `venta` → `prospecto` → `cobranza` (al final); cada tipo en su `despacho-<tipo>.ts`; en el servicio, `case` separado sin reordenar lo que hay; códigos de rechazo nuevos al final de `CODIGOS_RECHAZO`. El que mergea segundo resuelve un conflicto mecánico.
- **Reparto duplicado a propósito:** `repartirPago` existe en `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts` y en `apps/tablet/src/datos/cobranzas-reglas.ts` con el **mismo código** y la **misma tabla de casos** (`CASOS_REPARTO`). La tablet no puede importar del backend (Metro). Si cambias uno, cambias el otro y sus casos en el mismo commit.
- **Tablet (sistema de diseño):** toda pantalla en `<Pantalla>`; **una sola acción primaria** por paso; acciones opuestas difieren en glifo + forma + color; toda cifra en `<Cifra>`; toda lectura de catálogo en un `useMemo` con `versionCatalogos` en las dependencias (defecto del 2026-08-23).
- **Línea base medida** (`.superpowers/sdd/t-20-cobranza/linea-base.txt`, 2026-09-14): pgTAP **129** (`Result: PASS`) · backend unit **243** (22 suites) · backend e2e **359** (14 suites) · tablet **227** (16 suites) · typecheck tablet, lint backend/tablet, build backend y bundle de Metro limpios. Cada tarea dice cuántas pruebas **agrega** y el total esperado; si tu conteo no coincide, **detente** y averigua por qué.
- **Flake conocido:** un 401 intermitente en `auth-vendedor.e2e-spec.ts`. Si una corrida completa de e2e falla **solo** por eso, repítela **una** vez; si vuelve a fallar, o falla otra cosa, detente.
- **`npm run lint --workspace=apps/backend` corre con `--fix`**: después, `git status --short` solo puede mostrar archivos de la tarea. Si tocó otro archivo, **detente**.
- **Commits:** mensaje convencional (`feat(t-20): …`, `test(t-20): …`, `docs(t-20): …`) y terminan exactamente con estas dos líneas:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm`
- **Vault** (`/Users/marioburgos/iocusdev/JAWA/Obsidian Memory`): solo en la tarea de cierre, paso **VAULT**, commit y push a `main` del vault. Nunca se edita `90-Fuentes/`.
- **Sin tablet física:** las pantallas se verifican con typecheck, lint y bundle (`npm run export --workspace=apps/tablet`).

---

## Antes de la Task 1 (no es una tarea: solo comprobar)

```bash
git branch --show-current          # feature/t-20-cobranza-app
git status --short                 # vacío
git log --oneline -1               # el commit de este plan, encima de ea0dc78 (spec)
docker context ls                  # desktop-linux marcado con *
npm run supabase -- status         # el stack local arriba
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "select version from supabase_migrations.schema_migrations order by version desc limit 3;"
```

Expected de la última: `20260914120000`, `20260912140500`, `20260912140000`. Si `git status --short` no está vacío, el stack no arranca o la base local ya tiene `20260914160000`, **detente** y avisa al controlador.

---

## Estructura de archivos

### Backend y Supabase

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `supabase/migrations/20260914160000_cobranza_saldo_favor.sql` | Crear: `folio`, `origen`, `fecha_operacion` en `cobranza_abono`, checks, índices, tabla `saldo_favor_movimiento` | 1 |
| `supabase/tests/99_cobranza_saldo_favor_test.sql` | Crear: pgTAP de lo anterior, con el backfill simulado | 1 |
| `apps/backend/src/database/schema.d.ts` | Regenerar con `db:types`, sin los hunks de `Cliente` de T-40 | 1 |
| `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts` (+ spec) | Crear: `repartirPago`, `esCobrable`, `saldoDerivadoCentavos` — puro | 2 |
| `apps/backend/src/modules/ventas-cobranza/cobranza-rechazada.ts` | Crear: error de dominio `nota-no-encontrada` | 2 |
| `apps/backend/src/modules/ventas-cobranza/datos-cobranza.ts` (+ spec) | Crear: `normalizarDatosCobranza` — puro | 3 |
| `apps/backend/src/modules/sincronizacion/contrato.ts` | Modificar: `MetodoPago`, `DatosCobranza`, `nota-no-encontrada` (4); `AbonoPull`, `abonos`, `saldo_favor_centavos` (7) | 4, 7 |
| `apps/tablet/src/sincronizacion/contrato.ts` | Modificar: la misma copia | 4, 7 |
| `docs/contrato-sincronizacion.md` | Modificar: §6 (4), §5 (7), §7 y §9 (15) | 4, 7, 15 |
| `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts` | Crear: SQL del cobro, recibe `trx` | 5 |
| `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts` (+ spec) | Crear: `registrarCobranza(cobranza, contexto, trx)` | 5 |
| `apps/backend/src/modules/ventas-cobranza/ventas.service.ts` (+ spec) | Modificar: cobro `venta_contado` (D2) | 5 |
| `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` | Modificar: provee y exporta `CobranzasService` | 5 |
| `apps/backend/src/modules/sincronizacion/despacho-cobranza.ts` (+ spec) | Crear: `prepararCobranza`, `CODIGO_POR_RAZON_COBRANZA` | 6 |
| `apps/backend/src/modules/sincronizacion/despacho.ts` (+ spec) | Modificar: `cobranza` al final de la unión y del switch | 6 |
| `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` | Modificar: inyecta `CobranzasService`, `case 'cobranza'` en `proyectar`, `CobranzaRechazada` en el `catch` de `aplicar` | 6 |
| `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` | Modificar: `notasPendientes` y `clientes` del `pull` | 7 |
| `apps/backend/test/sincronizacion.e2e-spec.ts` | Modificar: fixture `fecha_operacion` (1), limpieza + contado (5), helpers + smoke + e2e base (6), pull (7), reglas (8) | 1, 5, 6, 7, 8 |

### Tablet

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `apps/tablet/src/datos/migraciones/005-cobranzas.ts` (+ spec) | Crear: tabla `cobranza`, `nota_pendiente.abonos_json`, `cliente.saldo_favor_centavos` | 9 |
| `apps/tablet/src/datos/migraciones/index.ts`, `004-ventas.spec.ts` | Modificar: registra la 005; la 004 deja de exigir "exactamente 4" | 9 |
| `apps/tablet/src/datos/tipos.ts` | Modificar: `MetodoPago`, `AbonoNota`, `Cobranza`; campos nuevos de `Cliente` y `NotaPendiente` | 9 |
| `apps/tablet/src/datos/repositorios/catalogos.ts` (+ spec) | Modificar: `COLUMNAS` (9); `publicarCambio()` (11) | 9, 11 |
| `apps/tablet/src/sincronizacion/motor.ts` (+ spec) | Modificar: `aSnapshot` con `abonos_json` y `saldo_favor_centavos` | 9 |
| `apps/tablet/src/datos/pruebas-apoyo.ts` | Modificar: pull de prueba (7); snapshot de prueba (9) | 7, 9 |
| `apps/tablet/src/datos/cobranzas-reglas.ts` (+ spec) | Crear: `repartirPago` (duplicada), `leerMontoCentavos`, `leerAbonos`, `problemasDeCobro` — puro | 10 |
| `apps/tablet/src/datos/repositorios/cobranzas.ts` (+ spec) | Crear: `previsualizar`, `registrar`, `porId`, `delDia`, `pendientesDeSincronizar`, `marcarSincronizada`, `marcarError` | 11 |
| `apps/tablet/src/datos/inicializar.ts`, `apps/tablet/src/datos/index.ts` | Modificar: `CapaDatos.cobranzas` y exportaciones | 10, 11 |
| `apps/tablet/src/sincronizacion/fuente-cobranzas.ts` (+ spec) | Crear: arma las operaciones `cobranza` | 12 |
| `apps/tablet/src/estado/proveedor-sesion.tsx` | Modificar: registra `fuenteCobranzas` después de ventas | 12 |
| `apps/tablet/app/(jornada)/index.tsx`, `apps/tablet/app/(jornada)/cerrar-dia.tsx` | Modificar: "registros por subir" suma cobranzas | 12 |
| `apps/tablet/src/ui/opcion.tsx` | Crear: la opción seleccionable que hoy vive dentro de `venta.tsx` | 13 |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx` | Reemplazar el placeholder por la pantalla (D16) | 13 |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx` | Modificar: "Cobrar notas pendientes (N)" al grabar (D6); usa `ui/opcion` | 14 |
| `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx` | Modificar: saldo a favor en la ficha (D5) | 14 |

---

## Tareas y modelos

| # | Tarea | Implementa | Revisa |
|---|---|---|---|
| 1 | Migración `cobranza_saldo_favor` + pgTAP + `db:types` + fixture e2e (+ paso SINMEX DEV del controlador) | `haiku` | `sonnet` |
| 2 | Reparto y status puros (backend) + `CobranzaRechazada` | `haiku` | `sonnet` |
| 3 | `normalizarDatosCobranza` | `sonnet` | `sonnet` |
| 4 | Contrato de push: `DatosCobranza` y `nota-no-encontrada` en backend, tablet y `docs/` §6 | `haiku` | `sonnet` |
| 5 | `CobranzasRepository` + `CobranzasService` + cobro de contado en `registrarVenta` | `sonnet` | `opus` |
| 6 | Despacho de `cobranza` + servicio de sincronización + migración de pruebas genéricas + e2e base | `opus` | `opus` |
| 7 | `pull`: saldo derivado, abonos, saldo a favor, notas cerradas + contrato §5 + e2e | `sonnet` | `opus` |
| 8 | e2e de las reglas de cobranza | `sonnet` | `opus` |
| 9 | Tablet: migración 005 + tipos + snapshot | `sonnet` | `sonnet` |
| 10 | Tablet: reparto puro duplicado + validación de la captura | `haiku` | `sonnet` |
| 11 | Tablet: repositorio de cobranzas + `publicarCambio` + capa de datos | `sonnet` | `sonnet` |
| 12 | Tablet: `fuenteCobranzas` + registro en la sesión + contadores | `haiku` | `sonnet` |
| 13 | Tablet: pantalla `cobranza.tsx` + `ui/opcion.tsx` | `sonnet` | `sonnet` |
| 14 | Tablet: consignación en `venta.tsx` + saldo a favor en la ficha | `sonnet` | `sonnet` |
| 15 | Cierre: verificación completa, `docs/` §7 y §9, vault | `sonnet` | `sonnet` |
| — | **Revisión final de la rama** | `opus` (o `fable`) — la despacha el controlador | — |

**Diferencias con la tabla orientativa del spec, y por qué:**
- La tarea 13 del spec se parte en **13** (pantalla de cobranza) y **14** (consignación en `venta.tsx` + saldo a favor en la ficha): un revisor puede rechazar una sin la otra.
- Los tipos del `pull` (`AbonoPull`, `abonos`, `saldo_favor_centavos`) van en la **Task 7** y no en la 4: si `NotaPendientePull` exigiera `abonos` antes de que el repositorio los mande, el backend no compilaría.
- El `db push` a `sinmex dev` (D17) no es trabajo de implementador: es un paso marcado **SINMEX DEV (controlador)** al final de la Task 1.

---
### Task 1: Migración `cobranza_saldo_favor` + pgTAP + `db:types` + fixture e2e

**Modelo:** implementador `haiku` · revisor `sonnet`

**Files:**
- Create: `supabase/migrations/20260914160000_cobranza_saldo_favor.sql`
- Create: `supabase/tests/99_cobranza_saldo_favor_test.sql`
- Modify (generado, parcial): `apps/backend/src/database/schema.d.ts`
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts` (el insert de `cobranza_abono` del `beforeAll`)

**Interfaces:**
- Consumes: la suite pgTAP en verde (129).
- Produces:
  - `cobranza_abono.folio text null`, `cobranza_abono.origen text not null default 'cobro'` con check `('venta_contado','cobro')`, `cobranza_abono.fecha_operacion date not null`; checks `ck_cobranza_abono_monto_positivo` (`monto > 0`) y `ck_cobranza_abono_saldo_no_negativo` (`saldo_pendiente >= 0`); índices `idx_cobranza_abono_nota`, `idx_cobranza_abono_folio`.
  - Tabla `saldo_favor_movimiento (id, created_at, updated_at, deleted_at, cliente_id, vendedor_id, monto, origen, folio, fecha_operacion)`, índice `idx_saldo_favor_cliente`, trigger `trg_saldo_favor_movimiento_updated`.
  - En `schema.d.ts`: `CobranzaAbono` gana `fecha_operacion: Timestamp;`, `folio: string | null;`, `origen: Generated<string>;`; nueva `SaldoFavorMovimiento`; `DB.saldo_favor_movimiento`. Las Tasks 5–8 compilan contra eso.

**Contexto:** el spec pide probar el backfill de `fecha_operacion`, y después de migrar ya no hay filas nulas que probar. La prueba lo **simula** dentro de su propia transacción: quita el `not null`, inserta una fila sin fecha, corre el mismo `update` de la migración, comprueba y vuelve a poner el `not null`. El `rollback` final lo deshace todo (**Ruling propuesto**).

- [ ] **Step 1: Pre-flight local**

Run: `docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "select count(*) from cobranza_abono where monto <= 0 or saldo_pendiente < 0;" -c "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cobranza_abono' and column_name in ('folio','origen','fecha_operacion');" -c "select count(*) from pg_tables where schemaname = 'public' and tablename = 'saldo_favor_movimiento';"`
Expected: `0`, `0` y `0`. Si no, **detente**: un check nuevo no aplicaría o la migración ya corrió.

- [ ] **Step 2: Escribir la prueba pgTAP que falla**

Crea `supabase/tests/99_cobranza_saldo_favor_test.sql`:

```sql
begin;
select plan(26);

-- Cobranza, abono y saldo a favor (T-20).
--
-- T-05 creo `cobranza_abono` sin folio, sin origen, sin fecha de operacion y
-- sin checks de importe. T-20 es el primero que escribe en ella (desde el push
-- de la tablet y desde la venta de contado), y lo que se prueba aqui es lo que
-- la BASE garantiza aunque el portal (T-21) o un script entren por debajo del
-- servicio.
--
-- Nombres con prefijo `ZZ-pgtap` para no chocar con datos reales; el vendedor
-- va SIN segmento de folio para no depender de cuales estan ocupados.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t20', 'Vendedor pgTAP T-20', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T20 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
     contado_credito, semana, mes, status, sucursal_id)
  select 'ZZPGTAPT2001', '2026-09-10', c.id, v.id, 250.00, '900',
         'credito', 37, 9, 'pendiente', c.sucursal_id
    from cliente c, vendedor v
   where c.nombre = 'ZZ-pgtap-T20 Cliente' and v.login = 'zz-pgtap-t20';

create temporary table _t20 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t20') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T20 Cliente') as cliente,
  (select id from venta_nota where folio = 'ZZPGTAPT2001') as nota;

------------------------------------------------------------------
-- cobranza_abono: estructura
------------------------------------------------------------------

select has_column('cobranza_abono', 'folio',
  'el cobro lleva el folio que emitio la tablet (D11)');
select has_column('cobranza_abono', 'origen',
  'el cobro dice si salio de una venta de contado o de un cobro capturado (D2)');
select has_column('cobranza_abono', 'fecha_operacion',
  'el cobro cuenta en el corte del dia en que se capturo (D3)');
select col_not_null('cobranza_abono', 'fecha_operacion',
  'fecha_operacion es obligatoria');
select col_is_null('cobranza_abono', 'folio',
  'folio admite null: un cobro del portal (T-21) puede no llevarlo');
select has_index('cobranza_abono', 'idx_cobranza_abono_nota',
  'los abonos de una nota se buscan por nota (saldo derivado, D7)');
select has_index('cobranza_abono', 'idx_cobranza_abono_folio',
  'los abonos de un cobro se buscan por folio');

------------------------------------------------------------------
-- cobranza_abono: reglas
------------------------------------------------------------------

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, folio)
    select nota, '2026-09-12', '2026-09-14', vendedor, 50.00, 'abono',
           200.00, 'efectivo', 'TJ260914ZZ01'
      from _t20$$,
  'acepta un abono con folio y fecha de operacion'
);

select is(
  (select origen from cobranza_abono where folio = 'TJ260914ZZ01'),
  'cobro',
  'un cobro sin origen explicito es un cobro capturado'
);

-- Un mismo cobro reparte a varias notas con el MISMO folio (D11): la unicidad
-- del folio vive en sync_operacion, no aqui.
select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, folio)
    select nota, '2026-09-12', '2026-09-14', vendedor, 200.00, 'cobranza',
           0.00, 'efectivo', 'TJ260914ZZ01'
      from _t20$$,
  'acepta dos filas con el mismo folio'
);

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, folio, origen)
    select nota, '2026-09-14', '2026-09-14', vendedor, 250.00, 'cobranza',
           0.00, 'efectivo', 'TJ260914ZZ02', 'venta_contado'
      from _t20$$,
  'acepta el cobro automatico de una venta de contado'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', '2026-09-14', vendedor, 0.00, 'abono',
           250.00, 'efectivo'
      from _t20$$,
  '23514',
  null,
  'rechaza un cobro de $0'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', '2026-09-14', vendedor, 10.00, 'abono',
           -0.01, 'efectivo'
      from _t20$$,
  '23514',
  null,
  'rechaza un saldo pendiente negativo: el excedente va a saldo a favor'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-09-14', '2026-09-14', vendedor, 10.00, 'abono',
           240.00, 'efectivo', 'portal'
      from _t20$$,
  '23514',
  null,
  'rechaza un origen fuera del catalogo'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', vendedor, 10.00, 'abono',
           240.00, 'efectivo'
      from _t20$$,
  '23502',
  null,
  'rechaza un cobro sin fecha de operacion'
);

------------------------------------------------------------------
-- saldo_favor_movimiento
------------------------------------------------------------------

select has_table('saldo_favor_movimiento',
  'el saldo a favor es un libro de movimientos (D5)');
select fk_ok('saldo_favor_movimiento', 'cliente_id', 'cliente', 'id',
  'cada movimiento es de un cliente');
select fk_ok('saldo_favor_movimiento', 'vendedor_id', 'vendedor', 'id',
  'y lo origina un vendedor');
select has_index('saldo_favor_movimiento', 'idx_saldo_favor_cliente',
  'el saldo de un cliente se suma por cliente');
select has_trigger('saldo_favor_movimiento', 'trg_saldo_favor_movimiento_updated',
  'updated_at se mantiene solo, como en el resto del esquema');

select lives_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, folio, fecha_operacion)
    select cliente, vendedor, 30.50, 'excedente_cobro', 'TJ260914ZZ01', '2026-09-14'
      from _t20$$,
  'acepta el excedente de un cobro'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, folio, fecha_operacion)
    select cliente, vendedor, 0.00, 'excedente_cobro', 'TJ260914ZZ01', '2026-09-14'
      from _t20$$,
  '23514',
  null,
  'rechaza un movimiento de $0'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, folio, fecha_operacion)
    select cliente, vendedor, 10.00, 'ajuste_portal', null, '2026-09-14'
      from _t20$$,
  '23514',
  null,
  'T-20 solo escribe excedentes de cobro: otro origen es de otro ticket'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen)
    select cliente, vendedor, 10.00, 'excedente_cobro'
      from _t20$$,
  '23502',
  null,
  'rechaza un movimiento sin fecha de operacion'
);

------------------------------------------------------------------
-- Backfill de fecha_operacion, simulado
------------------------------------------------------------------

-- Despues de migrar ya no hay filas sin fecha, asi que se recrea el estado de
-- antes dentro de esta transaccion y se corre el MISMO update de la migracion.
alter table cobranza_abono alter column fecha_operacion drop not null;

insert into cobranza_abono
    (venta_nota_id, fecha_pago, vendedor_id, monto, tipo, saldo_pendiente, metodo_pago, folio)
  select nota, '2026-09-11', vendedor, 10.00, 'abono', 190.00, 'efectivo', 'ZZBACKFILL'
    from _t20;

update cobranza_abono set fecha_operacion = fecha_pago where fecha_operacion is null;

select is(
  (select fecha_operacion from cobranza_abono where folio = 'ZZBACKFILL'),
  '2026-09-11'::date,
  'una fila previa toma su fecha de pago como fecha de operacion'
);

select lives_ok(
  $$alter table cobranza_abono alter column fecha_operacion set not null$$,
  'tras el backfill ya no queda ninguna fila sin fecha de operacion'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Correr pgTAP y verlo fallar**

Run: `npx supabase test db`
Expected: `99_cobranza_saldo_favor_test.sql` falla (no existen las columnas ni la tabla) y el resto sigue en verde.

- [ ] **Step 4: Escribir la migración**

Crea `supabase/migrations/20260914160000_cobranza_saldo_favor.sql`:

```sql
-- Cobranza, abono y saldo a favor (T-20).
--
-- T-05 creo `cobranza_abono` como esqueleto. T-20 es el primero que escribe en
-- ella: el push de la tablet (tipo `cobranza`) y la venta de contado (D2).

alter table cobranza_abono
  -- El folio que emitio la tablet (D11). Se repite en todas las filas que
  -- genera un mismo cobro, asi que NO es unique aqui: su unicidad global vive
  -- en `sync_operacion.folio`.
  add column folio text,
  -- Cobro automatico de una venta de contado o cobro capturado (D2). Corte y
  -- tesoreria suman una sola tabla y pueden desglosar.
  add column origen text not null default 'cobro'
    check (origen in ('venta_contado', 'cobro')),
  -- El dia de trabajo del sobre, tal cual llego (D3). El corte suma por esta
  -- fecha; `fecha_pago` es informativa.
  add column fecha_operacion date;

-- Filas previas (si las hay en un entorno compartido): su fecha de operacion es la de pago.
update cobranza_abono set fecha_operacion = fecha_pago where fecha_operacion is null;

alter table cobranza_abono
  alter column fecha_operacion set not null,
  add constraint ck_cobranza_abono_monto_positivo check (monto > 0),
  -- La foto del saldo tras el abono (D7). Nunca negativa: lo que sobra va a
  -- saldo a favor, no a una nota con saldo negativo.
  add constraint ck_cobranza_abono_saldo_no_negativo check (saldo_pendiente >= 0);

create index idx_cobranza_abono_nota on cobranza_abono (venta_nota_id) where deleted_at is null;
create index idx_cobranza_abono_folio on cobranza_abono (folio);

-- Saldo a favor del cliente como libro de movimientos (D5): el saldo es la
-- suma de sus movimientos vivos. T-20 solo escribe excedentes de cobro; usarlo
-- es de otro ticket, y ese ticket agregara su origen al check.
create table saldo_favor_movimiento (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  cliente_id      uuid not null references cliente(id),
  vendedor_id     uuid references vendedor(id),
  monto           numeric(12,2) not null check (monto <> 0),
  origen          text not null check (origen in ('excedente_cobro')),
  folio           text,
  fecha_operacion date not null
);
create index idx_saldo_favor_cliente on saldo_favor_movimiento (cliente_id) where deleted_at is null;
create trigger trg_saldo_favor_movimiento_updated before update on saldo_favor_movimiento
  for each row execute function set_updated_at();
```

- [ ] **Step 5: Aplicar la migración en la base local (sin tocar la versión de T-40)**

Primero mira qué ofrece el CLI:

Run: `npx supabase migration up --help`
Expected: la ayuda lista `--include-all` y `--local`.

Intenta:

Run: `npx supabase migration up --local --include-all`

- **Si termina sin error**, compruébalo:
  `docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "select version from supabase_migrations.schema_migrations where version in ('20260914120000','20260914160000') order by version;"`
  Expected: **las dos** versiones. Si falta `20260914120000`, **detente** y avisa: el CLI tocó la versión de T-40.
- **Si falla** (por ejemplo, otra vez `LegacyMigrationMissingLocalError`), aplica el SQL a mano y registra la versión:

```bash
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -v ON_ERROR_STOP=1 -1 < supabase/migrations/20260914160000_cobranza_saldo_favor.sql
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -v ON_ERROR_STOP=1 -c "insert into supabase_migrations.schema_migrations (version, name) values ('20260914160000', 'cobranza_saldo_favor');"
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "select version from supabase_migrations.schema_migrations order by version desc limit 3;"
```

Expected: `20260914160000`, `20260914120000`, `20260912140500`.

**Nunca** `supabase db reset` ni `supabase migration repair`.

- [ ] **Step 6: pgTAP en verde**

Run: `npx supabase test db`
Expected: `Result: PASS`, `Tests=155` (129 + 26).

- [ ] **Step 7: Regenerar los tipos de Kysely y quitar la deriva de T-40**

Run: `npm run db:types --workspace=apps/backend && git diff apps/backend/src/database/schema.d.ts`

Expected: el diff trae exactamente estos cambios y ningún otro:
1. En `export interface Cliente`: `domicilio: string | null;` y `lista_precio_id: string | null;` — **son de T-40, no de esta rama**.
2. En `export interface CobranzaAbono`: `fecha_operacion: Timestamp;`, `folio: string | null;`, `origen: Generated<string>;`.
3. Una interfaz nueva `export interface SaldoFavorMovimiento` (entre `Ruta` y `SesionRefresh`).
4. En `export interface DB`: `saldo_favor_movimiento: SaldoFavorMovimiento;`.

Si aparece cualquier otra cosa, **detente**.

Revierte **solo** la deriva de `Cliente`. En `apps/backend/src/database/schema.d.ts`, dentro de `export interface Cliente`, reemplaza:

```ts
  domicilio: string | null;
```

por:

```ts
  domicilio: string;
```

y reemplaza:

```ts
  lista_precio_id: string | null;
```

por:

```ts
  lista_precio_id: string;
```

Run: `git diff apps/backend/src/database/schema.d.ts`
Expected: solo quedan los cambios 2, 3 y 4. La interfaz nueva debe quedar así (el orden de columnas es el de `kysely-codegen`, alfabético):

```ts
export interface SaldoFavorMovimiento {
  cliente_id: string;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  fecha_operacion: Timestamp;
  folio: string | null;
  id: Generated<string>;
  monto: Numeric;
  origen: string;
  updated_at: Generated<Timestamp>;
  vendedor_id: string | null;
}
```

- [ ] **Step 8: El fixture e2e que inserta `cobranza_abono` gana `fecha_operacion`**

En `apps/backend/test/sincronizacion.e2e-spec.ts` (en el `beforeAll`), reemplaza:

```ts
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: notaId,
        fecha_pago: '2026-08-03',
        vendedor_id: vendedorId,
```

por:

```ts
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: notaId,
        fecha_pago: '2026-08-03',
        // T-20: obligatoria desde 20260914160000 (D3).
        fecha_operacion: '2026-08-03',
        vendedor_id: vendedorId,
```

- [ ] **Step 9: Build, unitarias, lint y e2e siguen igual**

```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
git status --short
```

Expected: build sin errores; `Tests: 243 passed` (22 suites); lint sin cambios; e2e `Tests: 359 passed` (14 suites); `git status --short` solo con los cuatro archivos de la tarea.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260914160000_cobranza_saldo_favor.sql \
        supabase/tests/99_cobranza_saldo_favor_test.sql \
        apps/backend/src/database/schema.d.ts \
        apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(t-20): cobranza_abono con folio, origen y fecha de operacion; saldo a favor

Columnas folio (D11, no unique: se repite en las filas de un cobro),
origen venta_contado/cobro (D2) y fecha_operacion obligatoria con
backfill desde fecha_pago (D3); checks de monto > 0 y saldo no
negativo; tabla saldo_favor_movimiento (D5). 26 pruebas pgTAP, con el
backfill simulado dentro de la prueba.

schema.d.ts se regenero y se le quitaron a mano los dos hunks de
Cliente (domicilio y lista_precio_id nullable): son de la migracion
20260914120000 de T-40, que esta en la base local compartida pero no en
esta rama.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

- [ ] **Step 11: SINMEX DEV (controlador) — el implementador NO corre este paso**

> Lo corre **el controlador**, después de aprobar la Task 1 y con las suites de arriba en verde (D17). Mientras el acceso a `sinmex dev` no exista en esta máquina, el paso queda **pendiente** y se anota en el reporte de cierre; el resto del plan sigue.

**El archivo de credenciales.** `.env.sinmex-dev` con una línea `DATABASE_URL=...`, en la raíz de este worktree (`proyecto-sinmex-t20/.env.sinmex-dev`, cubierto por `.env*` en `.gitignore`). El registro de decisiones dice que Mario lo crea en `proyecto-sinmex/`: ese checkout es de otra sesión y no se toca; si el archivo no está en el worktree de T-20, se le pide a Mario que lo ponga ahí y **se detiene**. La URL **nunca se imprime**: nada de `echo`, `cat`, `env` ni `set -x`. Cada bloque de abajo es **una sola** invocación de shell, porque el estado del shell no persiste entre llamadas.

(a) Comprobar el archivo sin mostrarlo:

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t20" \
  && test -f .env.sinmex-dev && git check-ignore -q .env.sinmex-dev \
  && set -a && . ./.env.sinmex-dev && set +a \
  && test -n "$DATABASE_URL" && echo "credenciales listas"
```

Expected: `credenciales listas`.

(b) Pre-flight **de solo lectura** contra `sinmex dev`:

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t20" \
  && set -a && . ./.env.sinmex-dev && set +a \
  && docker exec -e DATABASE_URL -i supabase_db_proyecto-sinmex \
       sh -c 'psql "$DATABASE_URL" -At -F " | " -v ON_ERROR_STOP=1' <<'SQL'
set session characteristics as transaction read only;
select 'ultimas_versiones', string_agg(version, ',' order by version)
  from (select version from supabase_migrations.schema_migrations order by version desc limit 12) v;
-- T-16 (20260912120000_venta_integridad), solo si no esta aplicada:
select 't16_columnas_ya_existen', count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'venta_nota' and column_name in ('comentarios', 'pct_comision');
select 't16_num_nota_vacio', count(*) from venta_nota where char_length(btrim(num_nota)) = 0;
select 't16_detalle_invalido', count(*) from venta_nota_detalle
 where cantidad < 0 or cantidad_promocion < 0 or cantidad + cantidad_promocion = 0 or precio < 0;
select 't16_detalle_repetido', count(*) from (
  select 1 from venta_nota_detalle group by venta_nota_id, presentacion_id having count(*) > 1) d;
-- T-20 (20260914160000_cobranza_saldo_favor):
select 't20_abono_invalido', count(*) from cobranza_abono where monto <= 0 or saldo_pendiente < 0;
select 't20_columnas_ya_existen', count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'cobranza_abono' and column_name in ('folio', 'origen', 'fecha_operacion');
select 't20_tabla_ya_existe', count(*) from pg_tables where schemaname = 'public' and tablename = 'saldo_favor_movimiento';
select 't20_set_updated_at', count(*) from pg_proc where proname = 'set_updated_at';
SQL
```

Expected: todas las cuentas en `0` salvo `t20_set_updated_at | 1`. (La consulta de T-16 que registra el vault incluye `char_length(comentarios) > 500`; se quitó porque `comentarios` no existe antes de esa migración y la consulta fallaría.) Si el contenedor no alcanza la base por IPv6, usa en `.env.sinmex-dev` la URI del *session pooler* de Supabase (la pone Mario). Cualquier cuenta distinta de lo esperado → **detente** y repórtalo a Mario sin empujar nada.

Anota `ultimas_versiones` y compáralas con `ls supabase/migrations`: **toda** versión remota tiene que existir como archivo local. Si hay una remota sin archivo local (por ejemplo, `20260914120000` de T-40 empujada desde otro lado), **detente**: `db push` fallaría y lo único que lo "arregla" es un `migration repair`, que aquí está prohibido.

(c) Ensayo:

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t20" \
  && set -a && . ./.env.sinmex-dev && set +a \
  && npx supabase db push --db-url "$DATABASE_URL" --dry-run
```

Expected: la lista de migraciones a empujar es **exactamente** `20260912120000_venta_integridad.sql` y `20260914160000_cobranza_saldo_favor.sql` (la primera es de T-16 y D17 la incluye). Si el CLI pide `--include-all` porque la de T-16 es más vieja que la última remota, repite el ensayo con `--dry-run --include-all` y aplica la misma regla. Si la lista trae **cualquier otra** versión (por ejemplo `20260912140000` / `20260912140500` de T-62, que son de `main`), **detente** y pregúntale a Mario: empujar migraciones de `main` no es decisión de T-20.

(d) Empujar (con las mismas banderas que dieron la lista correcta, sin `--dry-run`):

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t20" \
  && set -a && . ./.env.sinmex-dev && set +a \
  && npx supabase db push --db-url "$DATABASE_URL"
```

(e) Verificar, de nuevo en solo lectura:

```bash
cd "/Users/marioburgos/iocusdev/JAWA/JAWA ANDROID/proyecto-sinmex-t20" \
  && set -a && . ./.env.sinmex-dev && set +a \
  && docker exec -e DATABASE_URL -i supabase_db_proyecto-sinmex \
       sh -c 'psql "$DATABASE_URL" -At -F " | " -v ON_ERROR_STOP=1' <<'SQL'
set session characteristics as transaction read only;
select 'versiones_t16_t20', count(*) from supabase_migrations.schema_migrations
 where version in ('20260912120000', '20260914160000');
select 'columnas_t20', count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'cobranza_abono' and column_name in ('folio', 'origen', 'fecha_operacion');
select 'tabla_saldo_favor', count(*) from pg_tables where schemaname = 'public' and tablename = 'saldo_favor_movimiento';
SQL
```

Expected: `versiones_t16_t20 | 2`, `columnas_t20 | 3`, `tabla_saldo_favor | 1`. Riesgo aceptado por Mario (D17): si una revisión cambia estas migraciones, se corrige con una migración nueva, nunca editando la empujada.

---
### Task 2: Reparto y status puros (backend) + `CobranzaRechazada`

**Modelo:** implementador `haiku` · revisor `sonnet`

**Files:**
- Create: `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts`
- Test: `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.spec.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/cobranza-rechazada.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type TipoAbono = 'cobranza' | 'abono'`
  - `interface NotaParaReparto { id: string; fecha: string; folio: string; cobrable: boolean; saldoCentavos: number }`
  - `interface Aplicacion { notaId: string; montoCentavos: number; saldoAntesCentavos: number; saldoDespuesCentavos: number; tipo: TipoAbono; status: 'pagada' | 'abonado' }`
  - `interface Reparto { aplicaciones: Aplicacion[]; saldoFavorCentavos: number }`
  - `repartirPago(montoCentavos: number, notaElegidaId: string, notas: readonly NotaParaReparto[]): Reparto` — lanza `Error` si el monto no es un entero positivo.
  - `esCobrable(status: string, borrada: boolean): boolean`
  - `saldoDerivadoCentavos(montoTotalCentavos: number, abonadoCentavos: number): number`
  - `type RazonRechazoCobranza = 'nota-no-encontrada'`, `interface RechazoCobranza { razon; motivo }`, `class CobranzaRechazada extends Error { readonly razon: RazonRechazoCobranza }`

**Contexto:** `repartirPago` y la tabla `CASOS_REPARTO` se copian **tal cual** a la tablet en la Task 10. Es duplicación deliberada: la tablet no puede importar del backend (Metro) y el reparto local tiene que coincidir con el del servidor, o el saldo "parpadea" hasta el siguiente pull.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.spec.ts`:

```ts
import {
  esCobrable,
  repartirPago,
  saldoDerivadoCentavos,
  type NotaParaReparto,
  type Reparto,
} from './reglas-cobranza';

/**
 * CASOS COMPARTIDOS CON LA TABLET (T-20, D1).
 *
 * Esta tabla se copia tal cual a
 * `apps/tablet/src/datos/cobranzas-reglas.spec.ts`. Si cambias un caso aqui,
 * cambialo alla en el mismo commit: el reparto local de la tablet tiene que dar
 * lo mismo que el del servidor.
 */
const nota = (
  id: string,
  fecha: string,
  folio: string,
  saldoCentavos: number,
  cobrable = true,
): NotaParaReparto => ({ id, fecha, folio, cobrable, saldoCentavos });

interface CasoReparto {
  nombre: string;
  monto: number;
  elegida: string;
  notas: NotaParaReparto[];
  esperado: Reparto;
}

const CASOS_REPARTO: CasoReparto[] = [
  {
    nombre: 'abono parcial a la nota elegida',
    monto: 5000,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 15000)],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 5000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 10000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'liquida exacto',
    monto: 15000,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 15000)],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 15000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'el excedente va a las otras notas, de la mas vieja a la mas nueva',
    monto: 15000,
    elegida: 'B',
    notas: [
      nota('C', '2026-08-03', 'TJ260803AP01', 4000),
      nota('B', '2026-08-05', 'TJ260805AP01', 10000),
      nota('A', '2026-08-01', 'TJ260801AP01', 3000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'A', montoCentavos: 3000, saldoAntesCentavos: 3000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'C', montoCentavos: 2000, saldoAntesCentavos: 4000, saldoDespuesCentavos: 2000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'misma fecha: desempata el folio',
    monto: 3000,
    elegida: 'X',
    notas: [
      nota('X', '2026-08-04', 'TJ260804AP09', 1000),
      nota('N2', '2026-08-01', 'TJ260801AP02', 5000),
      nota('N1', '2026-08-01', 'TJ260801AP01', 5000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'X', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'N1', montoCentavos: 2000, saldoAntesCentavos: 5000, saldoDespuesCentavos: 3000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'lo que sobra de todas las notas queda a favor',
    monto: 5000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 1000),
      nota('B', '2026-08-02', 'TJ260802AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'B', montoCentavos: 2000, saldoAntesCentavos: 2000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 2000,
    },
  },
  {
    nombre: 'nota elegida que ya no se puede cobrar: todo pasa a excedente (D9)',
    monto: 2000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 0, false),
      nota('B', '2026-08-02', 'TJ260802AP01', 3000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 2000, saldoAntesCentavos: 3000, saldoDespuesCentavos: 1000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'las otras notas que no se pueden cobrar se saltan aunque tengan saldo',
    monto: 2500,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-05', 'TJ260805AP01', 1000),
      nota('B', '2026-08-01', 'TJ260801AP01', 5000, false),
      nota('C', '2026-08-02', 'TJ260802AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'C', montoCentavos: 1500, saldoAntesCentavos: 2000, saldoDespuesCentavos: 500, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'sin otras notas, el excedente queda a favor',
    monto: 1500,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 1000)],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 500,
    },
  },
  {
    nombre: 'una nota con saldo 0 no recibe nada',
    monto: 1000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 0),
      nota('B', '2026-08-02', 'TJ260802AP01', 1000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'la elegida va primero aunque sea la mas nueva',
    monto: 3000,
    elegida: 'N',
    notas: [
      nota('V', '2026-08-01', 'TJ260801AP01', 2000),
      nota('N', '2026-08-09', 'TJ260809AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'N', montoCentavos: 2000, saldoAntesCentavos: 2000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'V', montoCentavos: 1000, saldoAntesCentavos: 2000, saldoDespuesCentavos: 1000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'una nota elegida que no esta en la lista: todo es excedente',
    monto: 1000,
    elegida: 'Z',
    notas: [nota('B', '2026-08-02', 'TJ260802AP01', 1000)],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    },
  },
];

describe('repartirPago (D1, D8, D9)', () => {
  it.each(CASOS_REPARTO)('$nombre', ({ monto, elegida, notas, esperado }) => {
    expect(repartirPago(monto, elegida, notas)).toEqual(esperado);
  });

  it('no reordena ni modifica la lista que recibe', () => {
    const notas = [
      nota('C', '2026-08-03', 'TJ260803AP01', 4000),
      nota('B', '2026-08-05', 'TJ260805AP01', 10000),
    ];
    const copia = notas.map((n) => ({ ...n }));
    repartirPago(12000, 'B', notas);
    expect(notas).toEqual(copia);
  });

  it.each([0, -100, 15.5, Number.NaN])(
    'un monto de %p no es un pago: es un bug de quien llama',
    (monto) => {
      expect(() =>
        repartirPago(monto, 'A', [nota('A', '2026-08-01', 'TJ260801AP01', 1000)]),
      ).toThrow(Error);
    },
  );
});

describe('esCobrable', () => {
  it.each([
    ['pendiente', true],
    ['abonado', true],
    ['pagada', false],
    ['cuenta_perdida', false],
    ['promocion', false],
  ])('una nota %s viva, cobrable = %p', (status, esperado) => {
    expect(esCobrable(status, false)).toBe(esperado);
  });

  it('una nota borrada nunca es cobrable, aunque diga pendiente', () => {
    expect(esCobrable('pendiente', true)).toBe(false);
  });
});

describe('saldoDerivadoCentavos (D7)', () => {
  it('es el monto total menos lo abonado', () => {
    expect(saldoDerivadoCentavos(25000, 10000)).toBe(15000);
  });

  it('nunca es negativo, aunque los abonos pasen del total', () => {
    expect(saldoDerivadoCentavos(25000, 30000)).toBe(0);
  });
});
```

- [ ] **Step 2: Correr las pruebas y verlas fallar**

Run: `npm test --workspace=apps/backend -- reglas-cobranza`
Expected: FAIL con `Cannot find module './reglas-cobranza'`.

- [ ] **Step 3: Implementar**

Crea `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts`:

```ts
/**
 * Reglas puras de la cobranza (T-20), sin base de datos ni Nest.
 *
 * > [!warning] Duplicado a proposito en la tablet
 * > `repartirPago` y sus tipos viven tambien en
 * > `apps/tablet/src/datos/cobranzas-reglas.ts`, con el mismo codigo y la misma
 * > tabla de casos de prueba. La tablet reparte localmente al grabar el cobro
 * > (para descontar el saldo sin red) y el servidor vuelve a repartir al
 * > proyectar; si divergen, el saldo de la tablet parpadea hasta el pull. La
 * > tablet no puede importar del backend (Metro): si cambias uno, cambia el
 * > otro en el mismo commit.
 */

export type TipoAbono = 'cobranza' | 'abono';

/** Una nota del cliente tal como la ve el reparto. */
export interface NotaParaReparto {
  id: string;
  /** `AAAA-MM-DD`: el orden del excedente es por fecha y luego por folio. */
  fecha: string;
  folio: string;
  /** Solo `pendiente`/`abonado` y viva (D8, D9). */
  cobrable: boolean;
  saldoCentavos: number;
}

/** Lo que el pago deja en una nota. */
export interface Aplicacion {
  notaId: string;
  montoCentavos: number;
  saldoAntesCentavos: number;
  /** Es la foto que se guarda en `cobranza_abono.saldo_pendiente` (D7). */
  saldoDespuesCentavos: number;
  /** `cobranza` si la deja en 0; `abono` si no (D8). */
  tipo: TipoAbono;
  status: 'pagada' | 'abonado';
}

export interface Reparto {
  /** En orden: la elegida primero y despues las demas por fecha y folio. */
  aplicaciones: Aplicacion[];
  /** Lo que no cupo en ninguna nota (D1 paso 3). */
  saldoFavorCentavos: number;
}

/** Una nota recibe dinero solo si esta `pendiente` o `abonado` y no esta borrada (D8, D9). */
export function esCobrable(status: string, borrada: boolean): boolean {
  return !borrada && (status === 'pendiente' || status === 'abonado');
}

/**
 * La verdad del saldo (D7): monto total menos lo abonado en vivo.
 *
 * Nunca negativo: si datos viejos tienen abonos por encima del total, la nota
 * simplemente no tiene saldo; el excedente de hoy no se come ese descuadre.
 */
export function saldoDerivadoCentavos(
  montoTotalCentavos: number,
  abonadoCentavos: number,
): number {
  return Math.max(0, montoTotalCentavos - abonadoCentavos);
}

function porFechaYFolio(a: NotaParaReparto, b: NotaParaReparto): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  // El id solo desempata para que el orden sea determinista.
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Reparte un pago (D1): primero la nota elegida hasta su saldo, despues las
 * otras notas cobrables del cliente de la mas vieja a la mas nueva (`fecha`,
 * luego `folio`), y lo que sobre queda como saldo a favor.
 *
 * Un pago mayor al saldo **se acepta** (Mario). Una nota elegida que ya no es
 * cobrable (D9) no recibe nada y todo el monto pasa a las demas.
 *
 * @throws {Error} si `montoCentavos` no es un entero positivo: la forma del
 * pago ya la valido quien llama, asi que llegar aqui con eso es un bug.
 */
export function repartirPago(
  montoCentavos: number,
  notaElegidaId: string,
  notas: readonly NotaParaReparto[],
): Reparto {
  if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) {
    throw new Error(
      `repartirPago necesita un entero positivo de centavos, no ${montoCentavos}.`,
    );
  }

  const elegida = notas.find((n) => n.id === notaElegidaId);
  const otras = notas
    .filter((n) => n.id !== notaElegidaId)
    .sort(porFechaYFolio);
  const orden = elegida ? [elegida, ...otras] : otras;

  const aplicaciones: Aplicacion[] = [];
  let restante = montoCentavos;

  for (const n of orden) {
    if (restante === 0) break;
    if (!n.cobrable || n.saldoCentavos <= 0) continue;

    const monto = Math.min(restante, n.saldoCentavos);
    const despues = n.saldoCentavos - monto;
    aplicaciones.push({
      notaId: n.id,
      montoCentavos: monto,
      saldoAntesCentavos: n.saldoCentavos,
      saldoDespuesCentavos: despues,
      tipo: despues === 0 ? 'cobranza' : 'abono',
      status: despues === 0 ? 'pagada' : 'abonado',
    });
    restante -= monto;
  }

  return { aplicaciones, saldoFavorCentavos: restante };
}
```

Crea `apps/backend/src/modules/ventas-cobranza/cobranza-rechazada.ts`:

```ts
/**
 * Una cobranza que el DOMINIO no acepta (T-20).
 *
 * Igual que `VentaRechazada`: no importa nada del contrato de sincronizacion.
 * `push` la traduce a su codigo (`sincronizacion/despacho-cobranza.ts`) y el
 * portal de T-21 la traducira a HTTP.
 *
 * Hay una sola razon a proposito (D10): una nota ya pagada, cancelada o
 * borrada NO se rechaza — el dinero si se cobro y rechazarlo lo perderia (D9).
 */
export type RazonRechazoCobranza =
  /**
   * La nota no existe, su cliente no es de la sucursal del vendedor, o no es
   * del cliente que dice el sobre. Una cobranza sobre una venta que aun no se
   * proyecto cae aqui y se reenvia en cada sincronizacion.
   */
  'nota-no-encontrada';

export interface RechazoCobranza {
  razon: RazonRechazoCobranza;
  /** En el espanol que leera quien tenga la tablet en la mano. */
  motivo: string;
}

export class CobranzaRechazada extends Error {
  readonly razon: RazonRechazoCobranza;

  constructor({ razon, motivo }: RechazoCobranza) {
    super(motivo);
    this.name = 'CobranzaRechazada';
    this.razon = razon;
  }
}
```

- [ ] **Step 4: Correr las pruebas y verlas pasar**

Run: `npm test --workspace=apps/backend -- reglas-cobranza`
Expected: PASS, **24** pruebas (11 casos + 1 + 4 + 5 + 1 + 2).

- [ ] **Step 5: Suite, build y lint**

```bash
npm test --workspace=apps/backend
npm run build --workspace=apps/backend
npm run lint --workspace=apps/backend
git status --short
```

Expected: `Tests: 267 passed` (243 + 24), 23 suites; build y lint limpios; `git status --short` solo con los tres archivos.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts \
        apps/backend/src/modules/ventas-cobranza/reglas-cobranza.spec.ts \
        apps/backend/src/modules/ventas-cobranza/cobranza-rechazada.ts
git commit -m "$(cat <<'EOF'
feat(t-20): reparto puro del pago y CobranzaRechazada

repartirPago aplica el pago a la nota elegida, despues a las otras notas
cobrables del cliente por fecha y folio, y deja el resto como saldo a
favor (D1, D8, D9). La tabla CASOS_REPARTO se duplica a proposito en la
tablet. CobranzaRechazada tiene una sola razon: nota-no-encontrada (D10).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 3: Validación de `datos` de cobranza

**Modelo:** implementador `sonnet` · revisor `sonnet`

**Files:**
- Create: `apps/backend/src/modules/ventas-cobranza/datos-cobranza.ts`
- Test: `apps/backend/src/modules/ventas-cobranza/datos-cobranza.spec.ts`

**Interfaces:**
- Consumes: nada (es pura).
- Produces:
  - `type MetodoPago = 'efectivo' | 'transferencia' | 'cheque'`, `const METODOS_PAGO: readonly MetodoPago[]`
  - `const MAX_CENTAVOS_COBRO = 999_999_999_999`
  - `interface CobranzaNormalizada { clienteId: string; ventaNotaId: string; montoCentavos: number; metodoPago: MetodoPago; fechaPago: string }` — ids en minúsculas.
  - `type ResultadoDatosCobranza = { ok: true; cobranza: CobranzaNormalizada } | { ok: false; campo: string; motivo: string }`
  - `normalizarDatosCobranza(clienteId: string | null, fechaOperacion: string, datos: Record<string, unknown>): ResultadoDatosCobranza` — el `motivo` empieza por el nombre del campo.

**Contexto:** mismo criterio que `datos-venta.ts` (T-16): recibe `datos` sin tipar, rechaza **por operación** con un motivo y comprueba lo que haría reventar a Postgres (un uuid mal formado, un entero que no cabe en `numeric(12,2)`, una fecha que no existe). La fecha de pago va de 1 día cualquiera hasta `fecha_operacion` (D14); el límite inferior "no antes de la fecha de la nota" lo aplica la tablet, que conoce la nota sin consultar (D4): el servidor no rechaza por eso, porque rechazar un cobro real lo perdería.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/backend/src/modules/ventas-cobranza/datos-cobranza.spec.ts`:

```ts
import {
  normalizarDatosCobranza,
  type ResultadoDatosCobranza,
} from './datos-cobranza';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const NOTA = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const FECHA_OPERACION = '2026-09-14';

const datos = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  venta_nota_id: NOTA,
  monto_centavos: 15000,
  metodo_pago: 'efectivo',
  fecha_pago: '2026-09-12',
  ...extra,
});

/** El motivo de un rechazo, o falla la prueba si no hubo rechazo. */
function motivo(r: ResultadoDatosCobranza): string {
  if (r.ok) throw new Error('se esperaba un rechazo');
  return r.motivo;
}

describe('normalizarDatosCobranza (D14)', () => {
  it('normaliza una cobranza valida, con los uuid en minusculas', () => {
    expect(
      normalizarDatosCobranza(
        CLIENTE.toUpperCase(),
        FECHA_OPERACION,
        datos({ venta_nota_id: NOTA.toUpperCase() }),
      ),
    ).toEqual({
      ok: true,
      cobranza: {
        clienteId: CLIENTE,
        ventaNotaId: NOTA,
        montoCentavos: 15000,
        metodoPago: 'efectivo',
        fechaPago: '2026-09-12',
      },
    });
  });

  it('sin cliente en el sobre no hay cobranza', () => {
    expect(motivo(normalizarDatosCobranza(null, FECHA_OPERACION, datos()))).toMatch(
      /^cliente_id: /,
    );
  });

  it.each([undefined, 'no-soy-uuid', 123])(
    'venta_nota_id %p no es un uuid',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(CLIENTE, FECHA_OPERACION, datos({ venta_nota_id: valor })),
        ),
      ).toMatch(/^venta_nota_id: /);
    },
  );

  it.each([0, -1, 15.5, '15000', 1_000_000_000_000, undefined])(
    'monto_centavos %p no es un cobro',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(CLIENTE, FECHA_OPERACION, datos({ monto_centavos: valor })),
        ),
      ).toMatch(/^monto_centavos: /);
    },
  );

  it('acepta el tope de numeric(12,2)', () => {
    const r = normalizarDatosCobranza(
      CLIENTE,
      FECHA_OPERACION,
      datos({ monto_centavos: 999_999_999_999 }),
    );
    expect(r.ok).toBe(true);
  });

  it.each(['EFECTIVO', 'tarjeta', undefined])(
    'metodo_pago %p no esta en el catalogo',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(CLIENTE, FECHA_OPERACION, datos({ metodo_pago: valor })),
        ),
      ).toMatch(/^metodo_pago: /);
    },
  );

  it.each(['efectivo', 'transferencia', 'cheque'])(
    'acepta el metodo %s',
    (valor) => {
      const r = normalizarDatosCobranza(CLIENTE, FECHA_OPERACION, datos({ metodo_pago: valor }));
      expect(r.ok && r.cobranza.metodoPago).toBe(valor);
    },
  );

  it.each(['2026-02-30', '14/09/2026', '2026-9-14', undefined])(
    'fecha_pago %p no es una fecha que exista',
    (valor) => {
      expect(
        motivo(
          normalizarDatosCobranza(CLIENTE, FECHA_OPERACION, datos({ fecha_pago: valor })),
        ),
      ).toMatch(/^fecha_pago: /);
    },
  );

  it('una fecha de pago posterior a la fecha de operacion es invalida', () => {
    expect(
      motivo(
        normalizarDatosCobranza(CLIENTE, FECHA_OPERACION, datos({ fecha_pago: '2026-09-15' })),
      ),
    ).toMatch(/^fecha_pago: /);
  });

  it('la fecha de pago puede ser el mismo dia de la operacion', () => {
    const r = normalizarDatosCobranza(
      CLIENTE,
      FECHA_OPERACION,
      datos({ fecha_pago: FECHA_OPERACION }),
    );
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Correr las pruebas y verlas fallar**

Run: `npm test --workspace=apps/backend -- datos-cobranza`
Expected: FAIL con `Cannot find module './datos-cobranza'`.

- [ ] **Step 3: Implementar**

Crea `apps/backend/src/modules/ventas-cobranza/datos-cobranza.ts`:

```ts
/**
 * Validacion y normalizacion de `datos` de una cobranza (T-20, D14).
 *
 * Pura, sin base de datos: decide si el cobro tiene la FORMA correcta. Que la
 * nota exista y sea del cliente lo decide `CobranzasService` dentro de la
 * transaccion.
 *
 * Recibe un objeto sin tipar y no un DTO por la regla de T-07: se rechaza por
 * operacion con un motivo, nunca se tumba el lote. Por eso tambien comprueba
 * lo que haria reventar a Postgres (un uuid mal formado, un importe que no cabe,
 * una fecha que no existe): eso seria un 500 para todo el lote, y la tablet
 * traduce un 5xx a "sin red" y reintentaria para siempre.
 */

/** Catalogo confirmado por el cliente ([[Cobranza-Abono]]). */
export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

export const METODOS_PAGO: readonly MetodoPago[] = [
  'efectivo',
  'transferencia',
  'cheque',
];

/** `numeric(12,2)` expresado en centavos: lo que cabe en `cobranza_abono.monto`. */
export const MAX_CENTAVOS_COBRO = 999_999_999_999;

/** El cobro ya validado. El folio no va aqui: viaja en el `contexto`. */
export interface CobranzaNormalizada {
  /** uuid en minusculas, el del sobre. */
  clienteId: string;
  /** uuid en minusculas: la nota que eligio el vendedor. */
  ventaNotaId: string;
  montoCentavos: number;
  metodoPago: MetodoPago;
  /** `AAAA-MM-DD`, informativa (D3). */
  fechaPago: string;
}

export type ResultadoDatosCobranza =
  | { ok: true; cobranza: CobranzaNormalizada }
  | {
      ok: false;
      /** El campo que fallo. */
      campo: string;
      /** Empieza por `campo`: es lo que guarda la tablet en `sync_error`. */
      motivo: string;
    };

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function invalido(campo: string, motivo: string): ResultadoDatosCobranza {
  return { ok: false, campo, motivo: `${campo}: ${motivo}` };
}

function esUnoDe<T extends string>(
  valor: unknown,
  opciones: readonly T[],
): valor is T {
  return typeof valor === 'string' && (opciones as readonly string[]).includes(valor);
}

/**
 * `AAAA-MM-DD` que existe en el calendario.
 *
 * `Date.UTC` aqui solo sirve para comprobar el calendario (un 30 de febrero se
 * desborda a marzo); no deriva ningun dia de trabajo de UTC.
 */
function esFechaReal(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !RE_FECHA.test(valor)) return false;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/**
 * Valida y normaliza `datos` de una operacion `cobranza`.
 *
 * `fechaOperacion` ya viene validada por `normalizarOperacion`; aqui solo se
 * compara como texto, que para `AAAA-MM-DD` es comparar fechas.
 */
export function normalizarDatosCobranza(
  clienteId: string | null,
  fechaOperacion: string,
  datos: Record<string, unknown>,
): ResultadoDatosCobranza {
  if (clienteId === null) {
    return invalido('cliente_id', 'una cobranza necesita el cliente en el sobre.');
  }

  const ventaNotaId = datos.venta_nota_id;
  if (typeof ventaNotaId !== 'string' || !RE_UUID.test(ventaNotaId)) {
    return invalido('venta_nota_id', 'tiene que ser el uuid de la nota que se cobra.');
  }

  const monto = datos.monto_centavos;
  if (
    typeof monto !== 'number' ||
    !Number.isInteger(monto) ||
    monto < 1 ||
    monto > MAX_CENTAVOS_COBRO
  ) {
    return invalido(
      'monto_centavos',
      `tiene que ser un entero de centavos entre 1 y ${MAX_CENTAVOS_COBRO}.`,
    );
  }

  const metodoPago = datos.metodo_pago;
  if (!esUnoDe(metodoPago, METODOS_PAGO)) {
    return invalido('metodo_pago', 'tiene que ser efectivo, transferencia o cheque.');
  }

  const fechaPago = datos.fecha_pago;
  if (!esFechaReal(fechaPago)) {
    return invalido('fecha_pago', 'tiene que ser una fecha AAAA-MM-DD que exista.');
  }
  if (fechaPago > fechaOperacion) {
    return invalido('fecha_pago', 'no puede ser posterior a fecha_operacion.');
  }

  return {
    ok: true,
    cobranza: {
      clienteId: clienteId.toLowerCase(),
      ventaNotaId: ventaNotaId.toLowerCase(),
      montoCentavos: monto,
      metodoPago,
      fechaPago,
    },
  };
}
```

- [ ] **Step 4: Correr las pruebas y verlas pasar**

Run: `npm test --workspace=apps/backend -- datos-cobranza`
Expected: PASS, **24** pruebas (1 + 1 + 3 + 6 + 1 + 3 + 3 + 4 + 1 + 1).

- [ ] **Step 5: Suite, build y lint**

```bash
npm test --workspace=apps/backend
npm run build --workspace=apps/backend
npm run lint --workspace=apps/backend
git status --short
```

Expected: `Tests: 291 passed` (267 + 24), 24 suites; build y lint limpios; `git status --short` solo con los dos archivos.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/datos-cobranza.ts \
        apps/backend/src/modules/ventas-cobranza/datos-cobranza.spec.ts
git commit -m "$(cat <<'EOF'
feat(t-20): validacion de datos de cobranza

normalizarDatosCobranza exige cliente en el sobre, uuid de la nota,
monto entero entre 1 y el tope de numeric(12,2), metodo del catalogo y
fecha de pago real no posterior a fecha_operacion (D14). El motivo
empieza por el campo, como en la venta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 4: Contrato de push — `DatosCobranza` y `nota-no-encontrada` en backend, tablet y `docs/` §6

**Modelo:** implementador `haiku` · revisor `sonnet`

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modify: `apps/tablet/src/sincronizacion/contrato.ts`
- Modify: `docs/contrato-sincronizacion.md` (§6)

**Interfaces:**
- Consumes: nada.
- Produces (idéntico en los dos `contrato.ts`):
  - `type MetodoPago = 'efectivo' | 'transferencia' | 'cheque'`
  - `type DatosCobranza = { venta_nota_id: string; monto_centavos: number; metodo_pago: MetodoPago; fecha_pago: string }`
  - `'nota-no-encontrada'` como **último** elemento de `CODIGOS_RECHAZO`.
- Los tipos del `pull` (`AbonoPull`, `abonos`, `saldo_favor_centavos`) **no** van aquí: van en la Task 7, junto con el repositorio que los manda.

- [ ] **Step 1: Backend — lista de tipos**

En `apps/backend/src/modules/sincronizacion/contrato.ts`, reemplaza:

```ts
 * TODO: T-20 — `cobranza` (abono/liquidacion sobre una nota, ver [[Cobranza-Abono]]).
```

por:

```ts
 * Hecho: T-20 — `cobranza` (abono/liquidacion sobre una nota, ver {@link DatosCobranza} y [[Cobranza-Abono]]).
```

- [ ] **Step 2: Backend — código de rechazo al final**

En el mismo archivo, reemplaza:

```ts
   * recupera sola cuando el administrador asigna el precio en el portal.
   */
  'precio-no-asignado',
] as const;
```

por:

```ts
   * recupera sola cuando el administrador asigna el precio en el portal.
   */
  'precio-no-asignado',
  /**
   * La nota que se cobra no existe, su cliente no es de la sucursal del
   * vendedor, o no es del `cliente_id` del sobre. T-20.
   *
   * Una nota ya pagada o cancelada en el servidor **no** cae aqui: el cobro se
   * acepta y el monto va a las otras notas y al saldo a favor (el dinero si se
   * cobro). Una cobranza sobre una venta que aun no se proyecto si cae aqui, y
   * la tablet la reenvia en cada sincronizacion.
   */
  'nota-no-encontrada',
] as const;
```

- [ ] **Step 3: Backend — forma de `datos` de cobranza**

En el mismo archivo, reemplaza:

```ts
  /** De 1 a 50, sin presentacion repetida. */
  lineas: LineaVenta[];
};
```

por:

```ts
  /** De 1 a 50, sin presentacion repetida. */
  lineas: LineaVenta[];
};

/** Catalogo de metodos de pago ([[Cobranza-Abono]]). En la app el default es `efectivo`. */
export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago del cliente sobre UNA nota que eligio el vendedor. `cliente_id` y
 * `folio` viajan en el **sobre** y en una cobranza son obligatorios. El
 * servidor reparte el monto: primero la nota elegida hasta su saldo, despues
 * las otras notas pendientes del cliente de la mas vieja a la mas nueva, y lo
 * que sobre queda como saldo a favor. Un monto mayor al saldo se acepta.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosCobranza = {
  /** uuid de la `venta_nota` (el `id` de una nota pendiente del pull). */
  venta_nota_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  metodo_pago: MetodoPago;
  /** `AAAA-MM-DD`, no posterior a `fecha_operacion`. Informativa: el corte cuenta por `fecha_operacion`. */
  fecha_pago: string;
};
```

- [ ] **Step 4: Tablet — la misma copia**

En `apps/tablet/src/sincronizacion/contrato.ts`, reemplaza:

```ts
  /** T-16: el cliente no tiene precio para esa presentacion. Lo arregla el portal. */
  'precio-no-asignado',
] as const;
```

por:

```ts
  /** T-16: el cliente no tiene precio para esa presentacion. Lo arregla el portal. */
  'precio-no-asignado',
  /** T-20: la nota cobrada no existe en el servidor o no es de este cliente. Se reenvia. */
  'nota-no-encontrada',
] as const;
```

En el mismo archivo, reemplaza:

```ts
  /** De 1 a 50, sin presentacion repetida. */
  lineas: LineaVenta[];
};
```

por:

```ts
  /** De 1 a 50, sin presentacion repetida. */
  lineas: LineaVenta[];
};

/** Catalogo de metodos de pago. En la app el default es `efectivo`. */
export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago sobre UNA nota; el servidor reparte el excedente a las otras notas
 * del cliente y al saldo a favor. `cliente_id` y `folio` van en el sobre y son
 * obligatorios.
 */
export type DatosCobranza = {
  venta_nota_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  metodo_pago: MetodoPago;
  /** `AAAA-MM-DD`, no posterior a `fecha_operacion`. */
  fecha_pago: string;
};
```

Y en el comentario de `OperacionSaliente.folio`, reemplaza:

```ts
   * Hoy la `jornada` no lo lleva: no es una nota que nadie firme. Venta y
   * cobranza si lo llevaran (T-16/T-20).
```

por:

```ts
   * Hoy la `jornada` no lo lleva: no es una nota que nadie firme. Venta y
   * cobranza si lo llevan, y en ellas es obligatorio (T-16/T-20).
```

- [ ] **Step 5: `docs/contrato-sincronizacion.md` §6**

Reemplaza:

```markdown
`datos` lo fija el ticket de cada módulo, y fijarlo es un cambio **aditivo** que
no sube la versión del contrato. Hoy tiene forma fija **`venta`** (T-16, abajo);
cobranza, gastos, merma y ruta siguen libres hasta T-20/T-27/T-33/T-39, y el
servidor las guarda tal cual.
```

por:

```markdown
`datos` lo fija el ticket de cada módulo, y fijarlo es un cambio **aditivo** que
no sube la versión del contrato. Hoy tienen forma fija **`venta`** (T-16) y
**`cobranza`** (T-20), abajo; gastos, merma y ruta siguen libres hasta
T-27/T-33/T-39, y el servidor las guarda tal cual.
```

Inserta, justo **antes** de la línea `### Respuesta \`200\` — parcial y honesta`:

````markdown
### `datos` de una cobranza (T-20)

```jsonc
{
  "clave": "uuid del cobro local",
  "tipo": "cobranza",
  "fecha_operacion": "2026-09-14",
  "ocurrido_en": "2026-09-14T12:10:00.000-07:00",
  "cliente_id": "uuid",              // obligatorio en cobranza
  "folio": "TJ260914AP04",           // obligatorio en cobranza; mismo contador del día que la venta
  "datos": {
    "venta_nota_id": "uuid",         // la nota que eligió el vendedor (id del pull)
    "monto_centavos": 15000,         // entero, 1..999999999999; puede pasar del saldo
    "metodo_pago": "efectivo",       // efectivo | transferencia | cheque
    "fecha_pago": "2026-09-12"       // AAAA-MM-DD, no posterior a fecha_operacion
  }
}
```

- `cliente_id` y `folio` viajan **en el sobre** y son **obligatorios**: sin cualquiera de los dos →
  `datos-invalidos`.
- **El servidor reparte el pago**, en este orden: la nota elegida hasta su saldo; si sobra, las
  **otras notas pendientes/abonadas del mismo cliente, de la más vieja a la más nueva** (`fecha` y
  luego `folio`); lo que aún sobre queda como **saldo a favor** del cliente. Cada nota que recibe
  dinero gana una fila en `cobranza_abono` con el mismo folio; queda `pagada` si su saldo llega a 0
  y `abonado` si no.
- **El saldo es derivado**: `monto_total − Σ abonos vivos`, calculado por el servidor al proyectar.
- **Una nota ya pagada, cancelada o borrada no rechaza el cobro**: su saldo aplicable es 0 y todo el
  monto pasa a las otras notas y al saldo a favor. El dinero sí se cobró.
- El único rechazo del dominio es **`nota-no-encontrada`**: la nota no existe, su cliente no es de
  la sucursal del vendedor, o no es del `cliente_id` del sobre.
- `fecha_pago` es informativa: el corte cuenta el cobro en `fecha_operacion`.
- Cada cobranza se aplica en **su propia transacción** junto con su fila del buzón (§7).

````

En la tabla de **Códigos de rechazo**, justo después de la fila que empieza por `| \`precio-no-asignado\` |`, agrega:

```markdown
| `nota-no-encontrada` | La nota que se cobra no existe, su cliente no es de la sucursal del vendedor, o no es del `cliente_id` del sobre. Una nota ya pagada o cancelada **no** cae aquí: el cobro se acepta y va a otras notas o a saldo a favor. La tablet la reenvía en cada sincronización (T-20) |
```

- [ ] **Step 6: Todo compila y las suites siguen igual**

```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run lint --workspace=apps/backend
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git status --short
```

Expected: build limpio; `Tests: 291 passed` (24 suites); lint del backend sin cambios; tablet `Tests: 227 passed` (16 suites); typecheck y lint de la tablet limpios; `git status --short` solo con los tres archivos.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/contrato.ts \
        apps/tablet/src/sincronizacion/contrato.ts \
        docs/contrato-sincronizacion.md
git commit -m "$(cat <<'EOF'
feat(t-20): contrato de push de cobranza y codigo nota-no-encontrada

DatosCobranza y MetodoPago en backend, tablet y docs §6, y el codigo
nota-no-encontrada al final de CODIGOS_RECHAZO (D10, D14). Aditivo:
CONTRATO_ACTUAL sigue en 1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 5: `CobranzasRepository` + `CobranzasService` + cobro de contado en `registrarVenta`

**Modelo:** implementador `sonnet` · revisor `opus`

**Files:**
- Create: `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts`
- Test: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.service.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` (reemplazo completo)
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts` (limpieza del `afterAll` y prueba de contado)

**Interfaces:**
- Consumes: `repartirPago`, `esCobrable`, `saldoDerivadoCentavos`, `TipoAbono` (Task 2); `CobranzaRechazada` (Task 2); `CobranzaNormalizada`, `MetodoPago` (Task 3); `ContextoVenta` de `ventas.service.ts`; `aCentavos`/`aPesos` de `sincronizacion/dinero.ts`; columnas nuevas de `schema.d.ts` (Task 1).
- Produces:
  - `type ContextoCobranza = ContextoVenta` (en `cobranzas.service.ts`)
  - `interface EntidadCobranza { tabla: 'cobranza_abono' | 'saldo_favor_movimiento'; id: string }`
  - `CobranzasService.registrarCobranza(cobranza: CobranzaNormalizada, contexto: ContextoCobranza, trx: Transaction<DB>): Promise<EntidadCobranza>` — lanza `CobranzaRechazada('nota-no-encontrada')` sin escribir nada.
  - `CobranzasRepository.notaParaCobro(ventaNotaId, trx): Promise<NotaParaCobro | undefined>`, `bloquearNotasDelCliente(clienteId, notaElegidaId, trx): Promise<NotaBloqueada[]>`, `abonadoPorNota(ids, trx): Promise<Map<string, string>>`, `insertarAbono(abono: NuevoAbono, trx): Promise<string>`, `actualizarStatusNota(id, status, trx): Promise<void>`, `insertarSaldoFavor(movimiento: NuevoSaldoFavor, trx): Promise<string>`
  - `VentasService` recibe un tercer argumento `cobranzas: CobranzasRepository`; una venta `contado` con monto > 0 deja una fila `cobranza_abono` `origen: 'venta_contado'`.
  - `VentasCobranzaModule` provee `CobranzasService` y `CobranzasRepository` y exporta `VentasService` y `CobranzasService`.

**Contexto y rulings de esta tarea:**
- **Candado (D13):** antes de leer saldos se bloquean `for update`, en orden de `id`, las notas cobrables del cliente **y** la elegida (aunque ya esté pagada o borrada). Dos cobros concurrentes del mismo cliente toman los candados en el mismo orden (sin deadlock) y el segundo lee los abonos que el primero ya confirmó (READ COMMITTED). **Ruling propuesto:** no se bloquean las notas pagadas que no se eligieron; no pueden recibir dinero.
- **`updated_at` (D12):** cada nota que recibe dinero se actualiza (`status` a `pagada` o `abonado`) y el trigger `set_updated_at` le toca `updated_at` aunque el status no cambie. `insertarSaldoFavor` toca `cliente.updated_at` explícitamente. **Costo aceptado:** tocar `cliente` hace que el siguiente pull incremental reenvíe los precios completos (`preciosCambiaron` mira `cliente`).
- **Todo a saldo a favor (D9):** si ninguna nota recibe dinero, no hay fila `cobranza_abono` a la que apuntar (el check `monto > 0` impide una de $0). **Ruling propuesto:** `registrarCobranza` devuelve `{ tabla: 'saldo_favor_movimiento', id }` y el buzón apunta al movimiento.
- **Contado (D2):** `fecha_pago` del cobro automático = `fecha_operacion` de la venta (**Ruling propuesto**: la venta no captura fecha de pago).

- [ ] **Step 1: Escribir las pruebas del servicio de cobranzas**

Crea `apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts`:

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { CobranzaNormalizada } from './datos-cobranza';
import { CobranzaRechazada } from './cobranza-rechazada';
import type {
  CobranzasRepository,
  NotaBloqueada,
  NotaParaCobro,
} from './cobranzas.repository';
import { CobranzasService, type ContextoCobranza } from './cobranzas.service';

const CLIENTE = 'cliente-1';
const SUCURSAL = 'sucursal-tj';
const A = 'nota-a';
const B = 'nota-b';
const C = 'nota-c';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

const contexto: ContextoCobranza = {
  sucursalId: SUCURSAL,
  fechaOperacion: '2026-09-14',
  vendedorId: 'vendedor-1',
  folio: 'TJ260914AP04',
  usuarioId: null,
};

const cobro = (extra: Partial<CobranzaNormalizada> = {}): CobranzaNormalizada => ({
  clienteId: CLIENTE,
  ventaNotaId: A,
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: '2026-09-10',
  ...extra,
});

const bloqueada = (
  id: string,
  fecha: string,
  montoTotal: string,
  extra: Partial<NotaBloqueada> = {},
): NotaBloqueada => ({
  id,
  fecha,
  folio: `TJ${fecha.slice(2, 4)}${fecha.slice(5, 7)}${fecha.slice(8, 10)}AP01`,
  status: 'pendiente',
  borrada: false,
  montoTotal,
  ...extra,
});

function montar(
  opciones: {
    nota?: NotaParaCobro | undefined;
    bloqueadas?: NotaBloqueada[];
    abonado?: Map<string, string>;
  } = {},
) {
  let abonos = 0;
  const repo = {
    notaParaCobro: jest
      .fn()
      .mockResolvedValue(
        'nota' in opciones
          ? opciones.nota
          : { id: A, clienteId: CLIENTE, sucursalId: SUCURSAL },
      ),
    bloquearNotasDelCliente: jest
      .fn()
      .mockResolvedValue(opciones.bloqueadas ?? [bloqueada(A, '2026-08-01', '250.00')]),
    abonadoPorNota: jest
      .fn()
      .mockResolvedValue(opciones.abonado ?? new Map([[A, '100.00']])),
    insertarAbono: jest
      .fn()
      .mockImplementation(() => Promise.resolve(`abono-${++abonos}`)),
    actualizarStatusNota: jest.fn().mockResolvedValue(undefined),
    insertarSaldoFavor: jest.fn().mockResolvedValue('favor-1'),
  };
  const servicio = new CobranzasService(repo as unknown as CobranzasRepository);
  return { servicio, repo };
}

describe('CobranzasService.registrarCobranza', () => {
  it('un abono parcial deja una fila abono con la foto del saldo y la nota abonado', async () => {
    const { servicio, repo } = montar();

    await expect(servicio.registrarCobranza(cobro(), contexto, trx)).resolves.toEqual({
      tabla: 'cobranza_abono',
      id: 'abono-1',
    });

    expect(repo.insertarAbono).toHaveBeenCalledTimes(1);
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      {
        ventaNotaId: A,
        vendedorId: 'vendedor-1',
        fechaPago: '2026-09-10',
        fechaOperacion: '2026-09-14',
        monto: '50.00',
        tipo: 'abono',
        saldoPendiente: '100.00',
        metodoPago: 'efectivo',
        folio: 'TJ260914AP04',
        origen: 'cobro',
      },
      trx,
    );
    expect(repo.actualizarStatusNota).toHaveBeenCalledWith(A, 'abonado', trx);
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('liquidar deja la fila tipo cobranza con saldo 0 y la nota pagada', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarCobranza(cobro({ montoCentavos: 15000 }), contexto, trx);

    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '150.00', tipo: 'cobranza', saldoPendiente: '0.00' }),
      trx,
    );
    expect(repo.actualizarStatusNota).toHaveBeenCalledWith(A, 'pagada', trx);
  });

  it('el excedente va a las otras notas por fecha y el resto a saldo a favor, con el mismo folio', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(A, '2026-08-05', '100.00'),
        bloqueada(B, '2026-08-03', '80.00'),
        bloqueada(C, '2026-08-01', '50.00', { status: 'abonado' }),
      ],
      abonado: new Map([[C, '20.00']]),
    });

    await expect(
      servicio.registrarCobranza(cobro({ montoCentavos: 25000 }), contexto, trx),
    ).resolves.toEqual({ tabla: 'cobranza_abono', id: 'abono-1' });

    // A (elegida) 100, luego C (la mas vieja, saldo 30) y B (80): sobran 40.
    expect(repo.insertarAbono).toHaveBeenCalledTimes(3);
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ventaNotaId: A, monto: '100.00', folio: 'TJ260914AP04' }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ventaNotaId: C, monto: '30.00', folio: 'TJ260914AP04' }),
      trx,
    );
    expect(repo.insertarAbono).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ ventaNotaId: B, monto: '80.00', folio: 'TJ260914AP04' }),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: 'vendedor-1',
        monto: '40.00',
        folio: 'TJ260914AP04',
        fechaOperacion: '2026-09-14',
      },
      trx,
    );
  });

  it('una nota elegida ya pagada no se rechaza: el dinero va a las demas (D9)', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [
        bloqueada(A, '2026-08-01', '250.00', { status: 'pagada' }),
        bloqueada(B, '2026-08-02', '60.00'),
      ],
      abonado: new Map([[A, '250.00']]),
    });

    await expect(
      servicio.registrarCobranza(cobro({ montoCentavos: 10000 }), contexto, trx),
    ).resolves.toEqual({ tabla: 'cobranza_abono', id: 'abono-1' });

    expect(repo.insertarAbono).toHaveBeenCalledTimes(1);
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({ ventaNotaId: B, monto: '60.00', tipo: 'cobranza' }),
      trx,
    );
    expect(repo.actualizarStatusNota).not.toHaveBeenCalledWith(A, expect.anything(), trx);
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '40.00' }),
      trx,
    );
  });

  it('una nota elegida borrada tampoco recibe dinero, aunque diga pendiente', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [bloqueada(A, '2026-08-01', '250.00', { borrada: true })],
      abonado: new Map(),
    });

    await servicio.registrarCobranza(cobro(), contexto, trx);

    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '50.00' }),
      trx,
    );
  });

  it('si todo queda a favor, el buzon apunta al movimiento de saldo a favor', async () => {
    const { servicio } = montar({
      bloqueadas: [bloqueada(A, '2026-08-01', '250.00', { status: 'pagada' })],
      abonado: new Map([[A, '250.00']]),
    });

    await expect(servicio.registrarCobranza(cobro(), contexto, trx)).resolves.toEqual({
      tabla: 'saldo_favor_movimiento',
      id: 'favor-1',
    });
  });

  it('bloquea las notas del cliente antes de leer lo abonado (D13)', async () => {
    const { servicio, repo } = montar();
    await servicio.registrarCobranza(cobro(), contexto, trx);

    expect(repo.bloquearNotasDelCliente).toHaveBeenCalledWith(CLIENTE, A, trx);
    expect(repo.abonadoPorNota).toHaveBeenCalledWith([A], trx);
    expect(repo.bloquearNotasDelCliente.mock.invocationCallOrder[0]).toBeLessThan(
      repo.abonadoPorNota.mock.invocationCallOrder[0],
    );
  });

  it('una nota que no existe es nota-no-encontrada y no escribe nada', async () => {
    const { servicio, repo } = montar({ nota: undefined });

    const error: unknown = await servicio
      .registrarCobranza(cobro(), contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CobranzaRechazada);
    expect(error).toMatchObject({ razon: 'nota-no-encontrada' });
    expect(repo.bloquearNotasDelCliente).not.toHaveBeenCalled();
    expect(repo.insertarAbono).not.toHaveBeenCalled();
    expect(repo.insertarSaldoFavor).not.toHaveBeenCalled();
  });

  it('una nota de un cliente de otra sucursal es nota-no-encontrada', async () => {
    const { servicio, repo } = montar({
      nota: { id: A, clienteId: CLIENTE, sucursalId: 'sucursal-mx' },
    });
    await expect(servicio.registrarCobranza(cobro(), contexto, trx)).rejects.toMatchObject({
      razon: 'nota-no-encontrada',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });

  it('una nota de otro cliente es nota-no-encontrada', async () => {
    const { servicio, repo } = montar({
      nota: { id: A, clienteId: 'cliente-2', sucursalId: SUCURSAL },
    });
    await expect(servicio.registrarCobranza(cobro(), contexto, trx)).rejects.toMatchObject({
      razon: 'nota-no-encontrada',
    });
    expect(repo.insertarAbono).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr las pruebas y verlas fallar**

Run: `npm test --workspace=apps/backend -- cobranzas.service`
Expected: FAIL con `Cannot find module './cobranzas.repository'`.

- [ ] **Step 3: Implementar el repositorio**

Crea `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { MetodoPago } from './datos-cobranza';
import type { TipoAbono } from './reglas-cobranza';

/** La nota elegida y a quien pertenece, para decidir `nota-no-encontrada` (D10). */
export interface NotaParaCobro {
  id: string;
  clienteId: string;
  /** La sucursal del CLIENTE: es la que define el alcance, como en el pull. */
  sucursalId: string;
}

/** Una nota del cliente ya bloqueada `for update`. */
export interface NotaBloqueada {
  id: string;
  /** `AAAA-MM-DD` con `to_char`: un `date` leido como `Date` se corre un dia. */
  fecha: string;
  folio: string;
  status: string;
  borrada: boolean;
  /** Texto `numeric` tal cual lo manda `pg`. */
  montoTotal: string;
}

/** Una fila de `cobranza_abono` lista para escribir. El dinero ya viene como texto (`aPesos`). */
export interface NuevoAbono {
  ventaNotaId: string;
  vendedorId: string;
  fechaPago: string;
  fechaOperacion: string;
  monto: string;
  tipo: TipoAbono;
  saldoPendiente: string;
  metodoPago: MetodoPago;
  folio: string | null;
  origen: 'cobro' | 'venta_contado';
}

export interface NuevoSaldoFavor {
  clienteId: string;
  vendedorId: string | null;
  /** Texto `numeric`, positivo. */
  monto: string;
  folio: string | null;
  fechaOperacion: string;
}

/**
 * SQL de la cobranza (T-20).
 *
 * Como `VentasRepository`: todo metodo recibe la `trx` y ninguno abre la suya,
 * porque el cobro entra o sale junto con su fila del buzon (ADR-0009 §2.3).
 */
@Injectable()
export class CobranzasRepository {
  /**
   * La nota elegida, **incluso borrada**: una nota borrada no se rechaza (D9),
   * solo deja de recibir dinero en el reparto.
   */
  async notaParaCobro(
    ventaNotaId: string,
    trx: Transaction<DB>,
  ): Promise<NotaParaCobro | undefined> {
    const fila = await trx
      .selectFrom('venta_nota as vn')
      .innerJoin('cliente as c', 'c.id', 'vn.cliente_id')
      .select(['vn.id', 'vn.cliente_id', 'c.sucursal_id'])
      .where('vn.id', '=', ventaNotaId)
      .executeTakeFirst();
    return fila
      ? { id: fila.id, clienteId: fila.cliente_id, sucursalId: fila.sucursal_id }
      : undefined;
  }

  /**
   * Bloquea `for update`, en orden de `id`, las notas que pueden recibir dinero
   * y la elegida (D13).
   *
   * El orden fijo es lo que evita el deadlock entre dos cobros del mismo
   * cliente; si aun asi Postgres elige victima, `reintentarAnteConflicto`
   * repite la operacion entera. Con READ COMMITTED, las consultas que siguen al
   * candado ya ven los abonos que el otro cobro confirmo.
   */
  async bloquearNotasDelCliente(
    clienteId: string,
    notaElegidaId: string,
    trx: Transaction<DB>,
  ): Promise<NotaBloqueada[]> {
    const filas = await sql<{
      id: string;
      fecha: string;
      folio: string;
      status: string;
      borrada: boolean;
      monto_total: string;
    }>`
      select id, to_char(fecha, 'YYYY-MM-DD') as fecha, folio, status,
             deleted_at is not null as borrada, monto_total
        from venta_nota
       where cliente_id = ${clienteId}
         and ((status in ('pendiente', 'abonado') and deleted_at is null)
              or id = ${notaElegidaId})
       order by id
         for update
    `.execute(trx);

    return filas.rows.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      folio: f.folio,
      status: f.status,
      borrada: f.borrada,
      montoTotal: f.monto_total,
    }));
  }

  /** Suma de los abonos vivos por nota, como texto `numeric`. Una nota sin abonos no aparece. */
  async abonadoPorNota(
    ids: readonly string[],
    trx: Transaction<DB>,
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const filas = await trx
      .selectFrom('cobranza_abono')
      .select(['venta_nota_id', sql<string>`sum(monto)::text`.as('abonado')])
      .where('venta_nota_id', 'in', ids)
      .where('deleted_at', 'is', null)
      .groupBy('venta_nota_id')
      .execute();
    return new Map(filas.map((f) => [f.venta_nota_id, f.abonado]));
  }

  async insertarAbono(abono: NuevoAbono, trx: Transaction<DB>): Promise<string> {
    const fila = await trx
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: abono.ventaNotaId,
        vendedor_id: abono.vendedorId,
        fecha_pago: abono.fechaPago,
        fecha_operacion: abono.fechaOperacion,
        monto: abono.monto,
        tipo: abono.tipo,
        saldo_pendiente: abono.saldoPendiente,
        metodo_pago: abono.metodoPago,
        folio: abono.folio,
        origen: abono.origen,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  /**
   * Status tras el reparto (D8). Se escribe aunque no cambie: el trigger
   * `set_updated_at` le toca `updated_at` y asi el pull incremental la ve (D12).
   */
  async actualizarStatusNota(
    ventaNotaId: string,
    status: 'pagada' | 'abonado',
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota')
      .set({ status })
      .where('id', '=', ventaNotaId)
      .execute();
  }

  /**
   * Movimiento de saldo a favor (D5) y `updated_at` del cliente, para que el
   * pull incremental le baje el saldo nuevo a la tablet (D12).
   */
  async insertarSaldoFavor(
    movimiento: NuevoSaldoFavor,
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .insertInto('saldo_favor_movimiento')
      .values({
        cliente_id: movimiento.clienteId,
        vendedor_id: movimiento.vendedorId,
        monto: movimiento.monto,
        origen: 'excedente_cobro',
        folio: movimiento.folio,
        fecha_operacion: movimiento.fechaOperacion,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await trx
      .updateTable('cliente')
      .set({ updated_at: sql`now()` })
      .where('id', '=', movimiento.clienteId)
      .execute();

    return fila.id;
  }
}
```

- [ ] **Step 4: Implementar el servicio**

Crea `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import { CobranzaRechazada } from './cobranza-rechazada';
import { CobranzasRepository } from './cobranzas.repository';
import type { CobranzaNormalizada } from './datos-cobranza';
import {
  esCobrable,
  repartirPago,
  saldoDerivadoCentavos,
} from './reglas-cobranza';
import type { ContextoVenta } from './ventas.service';

/**
 * Quien y cuando: el mismo contexto que la venta (D13). Desde la tablet
 * `folio` viene emitido y `usuarioId` es null; el portal (T-21) los llenara al
 * reves.
 */
export type ContextoCobranza = ContextoVenta;

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadCobranza {
  tabla: 'cobranza_abono' | 'saldo_favor_movimiento';
  id: string;
}

/**
 * La cobranza (T-20): **una regla, un sitio** (ADR-0009). La tablet entra por
 * el `push`; el portal entrara por su controller en T-21, los dos por aqui.
 */
@Injectable()
export class CobranzasService {
  constructor(private readonly repo: CobranzasRepository) {}

  /**
   * Registra un cobro cuya forma ya valido `normalizarDatosCobranza`, dentro de
   * la transaccion de quien llama.
   *
   * Reparte el monto (D1): la nota elegida, las otras notas cobrables del
   * cliente por fecha y folio, y el resto a saldo a favor. Una nota elegida ya
   * pagada, cancelada o borrada no se rechaza (D9).
   *
   * Devuelve la primera fila `cobranza_abono` creada o, si todo quedo a favor,
   * el movimiento de saldo a favor.
   *
   * @throws {CobranzaRechazada} `nota-no-encontrada` (D10). No escribe nada antes de lanzar.
   */
  async registrarCobranza(
    cobranza: CobranzaNormalizada,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<EntidadCobranza> {
    const nota = await this.repo.notaParaCobro(cobranza.ventaNotaId, trx);
    if (
      !nota ||
      nota.sucursalId !== contexto.sucursalId ||
      nota.clienteId !== cobranza.clienteId
    ) {
      throw new CobranzaRechazada({
        razon: 'nota-no-encontrada',
        motivo: `La nota ${cobranza.ventaNotaId} no existe o no es de este cliente.`,
      });
    }

    // D13: primero el candado, despues los saldos.
    const notas = await this.repo.bloquearNotasDelCliente(
      cobranza.clienteId,
      cobranza.ventaNotaId,
      trx,
    );
    const abonado = await this.repo.abonadoPorNota(
      notas.map((n) => n.id),
      trx,
    );

    const reparto = repartirPago(
      cobranza.montoCentavos,
      cobranza.ventaNotaId,
      notas.map((n) => ({
        id: n.id,
        fecha: n.fecha,
        folio: n.folio,
        cobrable: esCobrable(n.status, n.borrada),
        saldoCentavos: saldoDerivadoCentavos(
          aCentavos(n.montoTotal),
          aCentavos(abonado.get(n.id)),
        ),
      })),
    );

    let primera: string | null = null;
    for (const a of reparto.aplicaciones) {
      const id = await this.repo.insertarAbono(
        {
          ventaNotaId: a.notaId,
          vendedorId: contexto.vendedorId,
          fechaPago: cobranza.fechaPago,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(a.montoCentavos),
          tipo: a.tipo,
          // La foto del saldo tras esta fila (D7); nunca se lee como fuente.
          saldoPendiente: aPesos(a.saldoDespuesCentavos),
          metodoPago: cobranza.metodoPago,
          folio: contexto.folio,
          origen: 'cobro',
        },
        trx,
      );
      primera ??= id;
      await this.repo.actualizarStatusNota(a.notaId, a.status, trx);
    }

    let movimiento: string | null = null;
    if (reparto.saldoFavorCentavos > 0) {
      movimiento = await this.repo.insertarSaldoFavor(
        {
          clienteId: cobranza.clienteId,
          vendedorId: contexto.vendedorId,
          monto: aPesos(reparto.saldoFavorCentavos),
          folio: contexto.folio,
          fechaOperacion: contexto.fechaOperacion,
        },
        trx,
      );
    }

    if (primera !== null) return { tabla: 'cobranza_abono', id: primera };
    if (movimiento !== null) return { tabla: 'saldo_favor_movimiento', id: movimiento };
    // repartirPago no admite montos <= 0: si llega aqui, algo se rompio arriba.
    throw new Error('registrarCobranza no escribio ninguna fila.');
  }
}
```

- [ ] **Step 5: Correr las pruebas del servicio y verlas pasar**

Run: `npm test --workspace=apps/backend -- cobranzas.service`
Expected: PASS, **10** pruebas.

- [ ] **Step 6: Pruebas del cobro de contado en `ventas.service.spec.ts`**

En `apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts`, reemplaza:

```ts
import type { PreciosRepository } from '../cartera-clientes/precios.repository';
```

por:

```ts
import type { PreciosRepository } from '../cartera-clientes/precios.repository';
import type { CobranzasRepository } from './cobranzas.repository';
```

Reemplaza:

```ts
  const servicio = new VentasService(
    repo,
    precios as unknown as PreciosRepository,
  );
  return { servicio, repo, precios };
```

por:

```ts
  const cobranzas = {
    insertarAbono: jest.fn().mockResolvedValue('abono-1'),
  };
  const servicio = new VentasService(
    repo,
    precios as unknown as PreciosRepository,
    cobranzas as unknown as CobranzasRepository,
  );
  return { servicio, repo, precios, cobranzas };
```

Reemplaza:

```ts
  it('solo piezas de promocion, sin precio: nace promocion con monto 0 y precio 0 (D13)', async () => {
```

por:

```ts
  it('contado con monto deja su cobro venta_contado por el total (T-20, D2)', async () => {
    const { servicio, cobranzas } = montar();
    await servicio.registrarVenta(
      venta({ contadoCredito: 'contado' }),
      contexto(),
      trx,
    );
    expect(cobranzas.insertarAbono).toHaveBeenCalledWith(
      {
        ventaNotaId: 'venta-1',
        vendedorId: 'vendedor-1',
        fechaPago: '2026-09-14',
        fechaOperacion: '2026-09-14',
        monto: '324.00',
        tipo: 'cobranza',
        saldoPendiente: '0.00',
        metodoPago: 'efectivo',
        folio: 'TJ260914AP03',
        origen: 'venta_contado',
      },
      trx,
    );
  });

  it('credito no deja cobro (T-20)', async () => {
    const { servicio, cobranzas } = montar();
    await servicio.registrarVenta(venta(), contexto(), trx);
    expect(cobranzas.insertarAbono).not.toHaveBeenCalled();
  });

  it('una promocion de contado, de monto 0, no deja cobro (T-20, D2)', async () => {
    const { servicio, cobranzas } = montar();
    await servicio.registrarVenta(
      venta({
        contadoCredito: 'contado',
        lineas: [
          {
            presentacionId: PRE_B,
            cantidad: 0,
            cantidadPromocion: 3,
            precioCentavos: 0,
          },
        ],
      }),
      contexto(),
      trx,
    );
    expect(cobranzas.insertarAbono).not.toHaveBeenCalled();
  });

  it('solo piezas de promocion, sin precio: nace promocion con monto 0 y precio 0 (D13)', async () => {
```

- [ ] **Step 7: Correr y ver fallar las 3 nuevas**

Run: `npm test --workspace=apps/backend -- ventas.service`
Expected: FAIL: typecheck de ts-jest (`Expected 2 arguments, but got 3`) o las pruebas de contado sin llamada a `insertarAbono`.

- [ ] **Step 8: Cobro de contado en `VentasService`**

En `apps/backend/src/modules/ventas-cobranza/ventas.service.ts`, reemplaza:

```ts
import { aPesos } from '../sincronizacion/dinero';
import type { VentaNormalizada } from './datos-venta';
```

por:

```ts
import { aPesos } from '../sincronizacion/dinero';
import { CobranzasRepository } from './cobranzas.repository';
import type { VentaNormalizada } from './datos-venta';
```

Reemplaza:

```ts
  constructor(
    private readonly repo: VentasRepository,
    private readonly precios: PreciosRepository,
  ) {}
```

por:

```ts
  constructor(
    private readonly repo: VentasRepository,
    private readonly precios: PreciosRepository,
    // T-20 (D2): la venta de contado deja su cobro en la misma transaccion.
    private readonly cobranzas: CobranzasRepository,
  ) {}
```

Reemplaza:

```ts
      trx,
    );

    return { id };
  }
}
```

por:

```ts
      trx,
    );

    // T-20 (D2): una venta de contado ya se cobro. Deja su fila en
    // `cobranza_abono` para que corte y tesoreria sumen una sola tabla, marcada
    // `venta_contado` para poder desglosarla. Una promocion ($0) no se cobra.
    // La venta no captura fecha de pago: es la de la operacion.
    if (venta.contadoCredito === 'contado' && monto > 0) {
      await this.cobranzas.insertarAbono(
        {
          ventaNotaId: id,
          vendedorId: contexto.vendedorId,
          fechaPago: contexto.fechaOperacion,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(monto),
          tipo: 'cobranza',
          saldoPendiente: aPesos(0),
          metodoPago: 'efectivo',
          folio: contexto.folio,
          origen: 'venta_contado',
        },
        trx,
      );
    }

    return { id };
  }
}
```

- [ ] **Step 9: Módulo**

Reemplaza el contenido de `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` por:

```ts
import { Module } from '@nestjs/common';
import { CarteraClientesModule } from '../cartera-clientes/cartera-clientes.module';
import { CobranzasRepository } from './cobranzas.repository';
import { CobranzasService } from './cobranzas.service';
import { VentasRepository } from './ventas.repository';
import { VentasService } from './ventas.service';

// Ventas y Cobranza. Exporta `VentasService` (T-16) y `CobranzasService` (T-20)
// para que sincronizacion/ despache las operaciones de la tablet (ADR-0009); la
// dependencia va de sincronizacion hacia aqui, nunca al reves. Importa Cartera
// de Clientes porque es la duena de los precios.
@Module({
  imports: [CarteraClientesModule],
  providers: [
    VentasService,
    VentasRepository,
    CobranzasService,
    CobranzasRepository,
  ],
  exports: [VentasService, CobranzasService],
})
export class VentasCobranzaModule {}
```

- [ ] **Step 10: e2e — la limpieza borra los cobros de todas las notas de las pruebas**

Desde esta tarea, una venta de contado deja una fila `cobranza_abono`, y el `afterAll` solo borraba la de `notaId`: la llave foránea impediría borrar las ventas. En `apps/backend/test/sincronizacion.e2e-spec.ts` (el `afterAll` principal), reemplaza:

```ts
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', '=', notaId)
      .execute();
```

por:

```ts
    // T-20: los cobros de TODAS las notas de las pruebas (una venta de contado
    // deja el suyo), antes que las notas.
    await db
      .deleteFrom('cobranza_abono')
      .where(
        'venta_nota_id',
        'in',
        db
          .selectFrom('venta_nota')
          .select('id')
          .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId]),
      )
      .execute();
```

- [ ] **Step 11: e2e — la venta de contado deja su cobro**

En el mismo archivo, reemplaza:

```ts
      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta).toMatchObject({ status: 'pagada', monto_total: '192.00' });
    });
```

por:

```ts
      const [venta] = await ventasConFolio(op.folio as string);
      expect(venta).toMatchObject({ status: 'pagada', monto_total: '192.00' });

      // T-20 (D2): su cobro, distinguible de un cobro capturado.
      const cobros = await db
        .selectFrom('cobranza_abono')
        .select([
          'monto',
          'tipo',
          'saldo_pendiente',
          'metodo_pago',
          'origen',
          'folio',
          'vendedor_id',
          'fecha_pago',
          'fecha_operacion',
        ])
        .where('venta_nota_id', '=', venta.id)
        .execute();
      expect(cobros).toHaveLength(1);
      expect(cobros[0]).toMatchObject({
        monto: '192.00',
        tipo: 'cobranza',
        saldo_pendiente: '0.00',
        metodo_pago: 'efectivo',
        origen: 'venta_contado',
        folio: op.folio,
        vendedor_id: vendedorId,
      });
      expect(fechaTexto(cobros[0].fecha_pago)).toBe(FECHA_VENTAS);
      expect(fechaTexto(cobros[0].fecha_operacion)).toBe(FECHA_VENTAS);
    });

    it('una venta a credito no deja cobro (T-20)', async () => {
      const op = ventaValida();
      await push({ operaciones: [op] }).expect(200);

      const [venta] = await ventasConFolio(op.folio as string);
      const cobros = await db
        .selectFrom('cobranza_abono')
        .select('id')
        .where('venta_nota_id', '=', venta.id)
        .execute();
      expect(cobros).toEqual([]);
    });
```

- [ ] **Step 12: Suites, build y lint**

```bash
npm test --workspace=apps/backend
npm run build --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
git status --short
```

Expected: `Tests: 304 passed` (291 + 10 + 3), 25 suites; build y lint limpios; e2e `Tests: 360 passed` (359 + 1), 14 suites; `git status --short` solo con los siete archivos de la tarea.

- [ ] **Step 13: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts \
        apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts \
        apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts \
        apps/backend/src/modules/ventas-cobranza/ventas.service.ts \
        apps/backend/src/modules/ventas-cobranza/ventas.service.spec.ts \
        apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts \
        apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(t-20): CobranzasService.registrarCobranza y cobro de la venta de contado

registrarCobranza bloquea las notas cobrables del cliente y la elegida
for update en orden de id (D13), reparte con repartirPago, escribe una
fila cobranza_abono por nota con el mismo folio y la foto del saldo, pone
pagada/abonado (tocando updated_at, D12) y deja el excedente como
saldo_favor_movimiento tocando cliente.updated_at (D5). Si todo queda a
favor, la entidad del buzon es el movimiento. Unico rechazo:
nota-no-encontrada (D10).

registrarVenta de contado con monto > 0 deja su cobro venta_contado
(D2). La limpieza del e2e borra los cobros de todas las notas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 6: Despacho de `cobranza` + servicio de sincronización + migración de pruebas genéricas + e2e base

**Modelo:** implementador `opus` · revisor `opus`

**Files:**
- Create: `apps/backend/src/modules/sincronizacion/despacho-cobranza.ts`
- Test: `apps/backend/src/modules/sincronizacion/despacho-cobranza.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.ts`
- Modify: `apps/backend/src/modules/sincronizacion/despacho.spec.ts`
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts`

**Interfaces:**
- Consumes: `normalizarDatosCobranza`, `CobranzaNormalizada` (Task 3); `RazonRechazoCobranza`, `CobranzaRechazada` (Task 2); `CobranzasService.registrarCobranza` y `EntidadCobranza` (Task 5); `'nota-no-encontrada'` en `CODIGOS_RECHAZO` (Task 4).
- Produces:
  - `type PreparacionCobranza = { ok: true; cobranza: CobranzaNormalizada } | ({ ok: false } & Rechazo)`
  - `prepararCobranza(op: OperacionNormalizada): PreparacionCobranza`
  - `const CODIGO_POR_RAZON_COBRANZA: Record<RazonRechazoCobranza, CodigoRechazo>`
  - `Proyeccion` gana `| { tipo: 'cobranza'; cobranza: CobranzaNormalizada }` (al final).
  - `SincronizacionService` recibe `CobranzasService` como tercer argumento del constructor.
  - En el e2e: `FECHA_COBROS = '2026-08-09'`, `clienteConNotas(notas)` y `cobranzaValida(clienteId, ventaNotaId, datos?, extra?)`, que usan las Tasks 7 y 8.

**Contexto:**
- El spec dice "`case` propio en `aplicar`". En el código, el `switch` por tipo vive en el método privado `proyectar()` y el `catch` de rechazos en `aplicar()`: el `case 'cobranza'` va en `proyectar` y la rama de `CobranzaRechazada` en el `catch` de `aplicar`. Todo lo demás (transacción por operación, reintento ante deadlock, colisión de folio fuera de la transacción) ya existe desde T-16 y no se toca.
- Orden acordado con T-40: `cobranza` va **al final** de la unión y del `switch`; T-40 inserta `prospecto` después de `venta`.
- **Primero se migran las pruebas que usan `cobranza` como sobre genérico** (el smoke de 6 tipos y el `it.each` de `despacho.spec.ts`), mientras el código viejo aún las deja pasar; después se cambia el despacho. Ninguna tarea termina con la suite en rojo.
- **Fixtures propios de cobranza (Ruling propuesto):** cada prueba de cobranza crea su propio cliente con sus notas (`clienteConNotas`), porque `clienteId` acumula las ventas de T-16 y un reparto sobre él dependería del orden de las pruebas; y usan su propio día de folio (`FECHA_COBROS`) y contador, para no gastar los 99 consecutivos de `FECHA_VENTAS`.

- [ ] **Step 1: e2e — helpers de cobranza y limpieza**

En `apps/backend/test/sincronizacion.e2e-spec.ts`, reemplaza:

```ts
import request from 'supertest';
```

por:

```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
```

Reemplaza:

```ts
  /** `date` de Postgres a `AAAA-MM-DD`, con los componentes locales que puso el driver. */
  const fechaTexto = (valor: Date | string) =>
    valor instanceof Date
      ? `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`
      : String(valor).slice(0, 10);
```

por:

```ts
  /** `date` de Postgres a `AAAA-MM-DD`, con los componentes locales que puso el driver. */
  const fechaTexto = (valor: Date | string) =>
    valor instanceof Date
      ? `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`
      : String(valor).slice(0, 10);

  /* ---------------------------------------------------------------- */
  /* Cobranzas (T-20)                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Dia de los cobros de prueba. Distinto de `FECHA_VENTAS` para que los cobros
   * tengan su propio contador de folios y no se coman los 99 del dia de ventas.
   */
  const FECHA_COBROS = '2026-08-09';
  let ultimoConsecutivoCobro = 0;
  let ultimaNotaDeCobro = 0;

  /** Clientes creados por `clienteConNotas`; los borra el `afterAll`. */
  const clientesCobro: string[] = [];

  /**
   * Un cliente propio de la sucursal con sus notas a credito, para UNA prueba
   * de cobranza. Cada prueba arma su mundo: un reparto sobre `clienteId`
   * dependeria de cuantas ventas le dejaron las pruebas de T-16.
   *
   * `abonos` inserta filas vivas en `cobranza_abono` con la fecha de la nota y
   * una foto de `saldo_pendiente` en 0 **a proposito**: el servidor nunca la lee
   * como fuente (D7).
   */
  const clienteConNotas = async (
    notas: {
      monto: string;
      fecha: string;
      status?: 'pendiente' | 'abonado' | 'pagada' | 'cuenta_perdida';
      abonos?: string[];
    }[],
  ) => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();

    const cliente = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Cobros ${SUFIJO} ${clientesCobro.length + 1}`,
          domicilio: 'Calle 7 #3',
          telefono: '6640000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    clientesCobro.push(cliente);

    const ids: string[] = [];
    for (const n of notas) {
      const id = (
        await db
          .insertInto('venta_nota')
          .values({
            folio: `EC${SUFIJO}${++ultimaNotaDeCobro}`.slice(0, 20),
            fecha: n.fecha,
            cliente_id: cliente,
            vendedor_id: vendedorId,
            monto_total: n.monto,
            num_nota: '900',
            contado_credito: 'credito',
            semana: 32,
            mes: 8,
            status: n.status ?? 'pendiente',
            sucursal_id: sucursalId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      for (const monto of n.abonos ?? []) {
        await db
          .insertInto('cobranza_abono')
          .values({
            venta_nota_id: id,
            fecha_pago: n.fecha,
            fecha_operacion: n.fecha,
            vendedor_id: vendedorId,
            monto,
            tipo: 'abono',
            saldo_pendiente: '0.00',
            metodo_pago: 'efectivo',
          })
          .execute();
      }
      ids.push(id);
    }
    return { clienteId: cliente, notas: ids };
  };

  /** Una cobranza que el servidor acepta (contrato §6), con su folio del dia de cobros. */
  const cobranzaValida = (
    cliente: string,
    ventaNotaId: string,
    datos: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) =>
    operacion({
      tipo: 'cobranza',
      cliente_id: cliente,
      fecha_operacion: FECHA_COBROS,
      ocurrido_en: `${FECHA_COBROS}T16:20:00.000-07:00`,
      folio: formarFolio(
        sucursalCodigo,
        FECHA_COBROS,
        segmento,
        ++ultimoConsecutivoCobro,
      ),
      datos: {
        venta_nota_id: ventaNotaId,
        monto_centavos: 5000,
        metodo_pago: 'efectivo',
        fecha_pago: FECHA_COBROS,
        ...datos,
      },
      ...extra,
    });

  /** Las filas de `cobranza_abono` de una nota, en el orden en que se escribieron. */
  const abonosDe = (ventaNotaId: string) =>
    db
      .selectFrom('cobranza_abono')
      .select([
        'id',
        'monto',
        'tipo',
        'saldo_pendiente',
        'metodo_pago',
        'origen',
        'folio',
        'vendedor_id',
        'fecha_pago',
        'fecha_operacion',
      ])
      .where('venta_nota_id', '=', ventaNotaId)
      .orderBy('created_at')
      .execute();

  /** El status actual de una nota. */
  const statusDe = async (ventaNotaId: string) =>
    (
      await db
        .selectFrom('venta_nota')
        .select('status')
        .where('id', '=', ventaNotaId)
        .executeTakeFirstOrThrow()
    ).status;

  /** Los movimientos de saldo a favor de un cliente. */
  const saldoFavorDe = (cliente: string) =>
    db
      .selectFrom('saldo_favor_movimiento')
      .select(['id', 'monto', 'origen', 'folio', 'vendedor_id', 'fecha_operacion'])
      .where('cliente_id', '=', cliente)
      .orderBy('created_at')
      .execute();
```

En el `afterAll` principal, reemplaza:

```ts
    // T-16: las ventas que proyecto el push, ademas de `notaId`. Detalle antes
```

por:

```ts
    // T-20: el saldo a favor de los clientes de las pruebas de cobranza.
    if (clientesCobro.length > 0) {
      await db
        .deleteFrom('saldo_favor_movimiento')
        .where('cliente_id', 'in', clientesCobro)
        .execute();
    }
    // T-16: las ventas que proyecto el push, ademas de `notaId`. Detalle antes
```

y reemplaza:

```ts
    await db
      .deleteFrom('cliente')
      .where('id', 'in', [clienteId, clienteAjenoId])
      .execute();
```

por:

```ts
    await db
      .deleteFrom('cliente')
      .where('id', 'in', [clienteId, clienteAjenoId, ...clientesCobro])
      .execute();
```

- [ ] **Step 2: e2e — el smoke de 6 tipos manda una cobranza válida**

En el mismo archivo, reemplaza:

```ts
  describe('push', () => {
    it('sube la operacion del dia y devuelve un id por operacion', async () => {
      const ops = [
```

por:

```ts
  describe('push', () => {
    it('sube la operacion del dia y devuelve un id por operacion', async () => {
      // T-20: una cobranza ya no es un sobre generico; necesita una nota real.
      const cobro = await clienteConNotas([{ monto: '300.00', fecha: '2026-08-02' }]);
      const ops = [
```

y reemplaza:

```ts
        operacion({
          tipo: 'cobranza',
          cliente_id: clienteId,
          datos: { monto_centavos: 15000 },
        }),
```

por:

```ts
        cobranzaValida(cobro.clienteId, cobro.notas[0], { monto_centavos: 15000 }),
```

- [ ] **Step 3: `despacho.spec.ts` — `cobranza` sale de los tipos sin módulo**

En `apps/backend/src/modules/sincronizacion/despacho.spec.ts`, reemplaza:

```ts
  it.each(['jornada', 'cobranza', 'gasto', 'merma', 'ruta'] as const)(
```

por:

```ts
  it.each(['jornada', 'gasto', 'merma', 'ruta'] as const)(
```

- [ ] **Step 4: Confirmar que lo migrado sigue en verde contra el código viejo**

```bash
npm test --workspace=apps/backend -- despacho
npm run test:e2e --workspace=apps/backend -- sincronizacion
```

Expected: `despacho.spec.ts` pasa con una prueba menos (304 − 1 en la suite completa); el e2e de sincronización pasa entero (la cobranza todavía entra como sobre genérico).

- [ ] **Step 5: Escribir las pruebas que fallan del despacho de cobranza**

Crea `apps/backend/src/modules/sincronizacion/despacho-cobranza.spec.ts`:

```ts
import { CODIGOS_RECHAZO } from './contrato';
import {
  CODIGO_POR_RAZON_COBRANZA,
  prepararCobranza,
} from './despacho-cobranza';
import type { OperacionNormalizada } from './operaciones';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const NOTA = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const op = (
  extra: Partial<OperacionNormalizada> = {},
): OperacionNormalizada => ({
  clave: 'c0ffee00-0000-4000-8000-000000000002',
  tipo: 'cobranza',
  fechaOperacion: '2026-09-14',
  ocurridoEn: '2026-09-14T19:10:00.000Z',
  clienteId: CLIENTE,
  folio: 'TJ260914AP04',
  datos: {
    venta_nota_id: NOTA,
    monto_centavos: 15000,
    metodo_pago: 'transferencia',
    fecha_pago: '2026-09-13',
  },
  ...extra,
});

describe('prepararCobranza', () => {
  it('una cobranza valida se prepara para CobranzasService', () => {
    expect(prepararCobranza(op())).toEqual({
      ok: true,
      cobranza: {
        clienteId: CLIENTE,
        ventaNotaId: NOTA,
        montoCentavos: 15000,
        metodoPago: 'transferencia',
        fechaPago: '2026-09-13',
      },
    });
  });

  it.each<[string, Partial<OperacionNormalizada>, string]>([
    ['una cobranza sin folio', { folio: null }, 'folio: '],
    ['una cobranza sin cliente', { clienteId: null }, 'cliente_id: '],
    [
      'una cobranza de $0',
      {
        datos: {
          venta_nota_id: NOTA,
          monto_centavos: 0,
          metodo_pago: 'efectivo',
          fecha_pago: '2026-09-13',
        },
      },
      'monto_centavos: ',
    ],
  ])('%s es datos-invalidos y el motivo dice el campo', (_caso, extra, prefijo) => {
    const r = prepararCobranza(op(extra));
    if (r.ok) throw new Error('debia rechazarse');
    expect(r.codigo).toBe('datos-invalidos');
    expect(r.motivo.startsWith(prefijo)).toBe(true);
  });
});

describe('CODIGO_POR_RAZON_COBRANZA', () => {
  it('cada razon del dominio sale con un codigo que existe en el contrato', () => {
    for (const codigo of Object.values(CODIGO_POR_RAZON_COBRANZA)) {
      expect(CODIGOS_RECHAZO).toContain(codigo);
    }
    expect(CODIGO_POR_RAZON_COBRANZA['nota-no-encontrada']).toBe('nota-no-encontrada');
  });
});
```

En `apps/backend/src/modules/sincronizacion/despacho.spec.ts`, reemplaza:

```ts
  it('una venta valida se prepara para VentasService', () => {
```

por:

```ts
  it('una cobranza pasa por prepararCobranza y sale como proyeccion de cobranza (T-20)', () => {
    const r = prepararProyeccion(
      op({
        tipo: 'cobranza',
        datos: {
          venta_nota_id: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
          monto_centavos: 5000,
          metodo_pago: 'efectivo',
          fecha_pago: '2026-09-14',
        },
      }),
    );
    expect(r).toEqual({
      ok: true,
      proyeccion: {
        tipo: 'cobranza',
        cobranza: {
          clienteId: CLIENTE,
          ventaNotaId: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
          montoCentavos: 5000,
          metodoPago: 'efectivo',
          fechaPago: '2026-09-14',
        },
      },
    });
  });

  it('una venta valida se prepara para VentasService', () => {
```

Run: `npm test --workspace=apps/backend -- despacho`
Expected: FAIL: `Cannot find module './despacho-cobranza'` y, en `despacho.spec.ts`, la cobranza sale como `proyeccion: null`.

- [ ] **Step 6: Implementar `despacho-cobranza.ts`**

Crea `apps/backend/src/modules/sincronizacion/despacho-cobranza.ts`:

```ts
import type { RazonRechazoCobranza } from '../ventas-cobranza/cobranza-rechazada';
import {
  normalizarDatosCobranza,
  type CobranzaNormalizada,
} from '../ventas-cobranza/datos-cobranza';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es de la cobranza (T-20), en su propio archivo
 * para que `despacho.ts` se quede en un `case` de tres lineas por tipo (acuerdo
 * con T-40). Puro, sin base.
 */

export type PreparacionCobranza =
  | { ok: true; cobranza: CobranzaNormalizada }
  | ({ ok: false } & Rechazo);

/**
 * Valida la FORMA de una cobranza antes de abrir la transaccion. Un rechazo
 * aqui no toca la base.
 */
export function prepararCobranza(op: OperacionNormalizada): PreparacionCobranza {
  // El folio es opcional en el sobre (la jornada no lo lleva), pero un cobro
  // sin folio no se puede cotejar contra el recibo del cliente (D11).
  if (op.folio === null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'folio: una cobranza necesita el folio que la tablet emitio para su recibo.',
    };
  }
  const r = normalizarDatosCobranza(op.clienteId, op.fechaOperacion, op.datos);
  if (!r.ok) {
    return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  }
  return { ok: true, cobranza: r.cobranza };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: si ventas-cobranza
 * agrega una razon, esto deja de compilar hasta asignarle codigo.
 */
export const CODIGO_POR_RAZON_COBRANZA: Record<
  RazonRechazoCobranza,
  CodigoRechazo
> = {
  'nota-no-encontrada': 'nota-no-encontrada',
};
```

- [ ] **Step 7: `despacho.ts` — `cobranza` al final**

En `apps/backend/src/modules/sincronizacion/despacho.ts`, reemplaza:

```ts
import type { RazonRechazoVenta } from '../ventas-cobranza/venta-rechazada';
import type { CodigoRechazo } from './contrato';
```

por:

```ts
import type { CobranzaNormalizada } from '../ventas-cobranza/datos-cobranza';
import type { RazonRechazoVenta } from '../ventas-cobranza/venta-rechazada';
import type { CodigoRechazo } from './contrato';
import { prepararCobranza } from './despacho-cobranza';
```

Reemplaza:

```ts
 * Un `tipo` sin modulo todavia (`jornada`, `cobranza`, `gasto`, `merma`, `ruta`)
 * no tiene proyeccion: se guarda en el buzon y queda `aplicada`, como desde
 * T-07. T-20 agregara aqui `{ tipo: 'cobranza'; ... }`.
 */
export type Proyeccion = { tipo: 'venta'; venta: VentaNormalizada };
```

por:

```ts
 * Un `tipo` sin modulo todavia (`jornada`, `gasto`, `merma`, `ruta`) no tiene
 * proyeccion: se guarda en el buzon y queda `aplicada`, como desde T-07.
 * Orden acordado entre tickets: `venta`, `prospecto` (T-40), `cobranza` (T-20).
 */
export type Proyeccion =
  | { tipo: 'venta'; venta: VentaNormalizada }
  | { tipo: 'cobranza'; cobranza: CobranzaNormalizada };
```

Reemplaza:

```ts
    case 'jornada':
    case 'cobranza':
    case 'gasto':
    case 'merma':
    case 'ruta':
      return { ok: true, proyeccion: null };
  }
}
```

por:

```ts
    case 'jornada':
    case 'gasto':
    case 'merma':
    case 'ruta':
      return { ok: true, proyeccion: null };
    case 'cobranza': {
      const r = prepararCobranza(op);
      if (!r.ok) return r;
      return { ok: true, proyeccion: { tipo: 'cobranza', cobranza: r.cobranza } };
    }
  }
}
```

Run: `npm test --workspace=apps/backend -- despacho`
Expected: PASS (`despacho-cobranza.spec.ts` 5 pruebas; `despacho.spec.ts` con una más que en el Step 4).

- [ ] **Step 8: `SincronizacionService` — proyectar y traducir el rechazo**

En `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, reemplaza:

```ts
import { VentaRechazada } from '../ventas-cobranza/venta-rechazada';
import { VentasService } from '../ventas-cobranza/ventas.service';
```

por:

```ts
import { CobranzaRechazada } from '../ventas-cobranza/cobranza-rechazada';
import { CobranzasService } from '../ventas-cobranza/cobranzas.service';
import { VentaRechazada } from '../ventas-cobranza/venta-rechazada';
import { VentasService } from '../ventas-cobranza/ventas.service';
```

Reemplaza:

```ts
  prepararProyeccion,
  type Proyeccion,
} from './despacho';
```

por:

```ts
  prepararProyeccion,
  type Proyeccion,
} from './despacho';
import { CODIGO_POR_RAZON_COBRANZA } from './despacho-cobranza';
```

Reemplaza:

```ts
    // ADR-0009: sincronizacion despacha a los modulos de dominio, nunca al reves.
    private readonly ventas: VentasService,
  ) {}
```

por:

```ts
    // ADR-0009: sincronizacion despacha a los modulos de dominio, nunca al reves.
    private readonly ventas: VentasService,
    private readonly cobranzas: CobranzasService,
  ) {}
```

Reemplaza:

```ts
          codigo: CODIGO_POR_RAZON[error.razon],
          motivo: error.message,
        };
      }
      if (esColisionDeFolio(error)) {
```

por:

```ts
          codigo: CODIGO_POR_RAZON[error.razon],
          motivo: error.message,
        };
      }
      // T-20: el rollback ya dejo sin fila tanto el buzon como los cobros.
      if (error instanceof CobranzaRechazada) {
        return {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: CODIGO_POR_RAZON_COBRANZA[error.razon],
          motivo: error.message,
        };
      }
      if (esColisionDeFolio(error)) {
```

Reemplaza:

```ts
        return { tabla: 'venta_nota', id };
      }
    }
  }
```

por:

```ts
        return { tabla: 'venta_nota', id };
      }
      case 'cobranza':
        // Devuelve la primera fila de cobranza_abono, o el movimiento de saldo
        // a favor si todo el pago quedo a favor.
        return this.cobranzas.registrarCobranza(
          proyeccion.cobranza,
          {
            sucursalId: vendedor.sucursal_id,
            fechaOperacion: op.fechaOperacion,
            vendedorId: vendedor.id,
            folio: op.folio,
            usuarioId: null,
          },
          trx,
        );
    }
  }
```

(`SincronizacionModule` ya importa `VentasCobranzaModule`, que desde la Task 5 exporta `CobranzasService`: no se toca.)

- [ ] **Step 9: e2e base de la cobranza**

En `apps/backend/test/sincronizacion.e2e-spec.ts`, reemplaza:

```ts
  /* ================================================================ */
  /* Folios (T-14)                                                    */
  /* ================================================================ */
```

por:

```ts
  /* ================================================================ */
  /* Cobranzas (T-20): la cobranza entra por el despachador            */
  /* ================================================================ */

  describe('cobranzas (T-20)', () => {
    it('una cobranza valida entra a cobranza_abono y el buzon apunta a la fila', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0], { fecha_pago: '2026-08-05' });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0].estado).toBe('aplicada');

      const abonos = await abonosDe(notas[0]);
      expect(abonos).toHaveLength(1);
      expect(abonos[0]).toMatchObject({
        monto: '50.00',
        tipo: 'abono',
        saldo_pendiente: '200.00',
        metodo_pago: 'efectivo',
        origen: 'cobro',
        folio: op.folio,
        vendedor_id: vendedorId,
      });
      expect(fechaTexto(abonos[0].fecha_pago)).toBe('2026-08-05');
      expect(fechaTexto(abonos[0].fecha_operacion)).toBe(FECHA_COBROS);
      expect(await statusDe(notas[0])).toBe('abonado');

      expect(await buzonDe(op.clave)).toEqual({
        id: res.resultados[0].id_servidor,
        entidad_tabla: 'cobranza_abono',
        entidad_id: abonos[0].id,
      });
    });

    it('reenviar la misma cobranza es duplicada y no cobra dos veces', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0]);

      const primero = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      const segundo = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;

      expect(segundo.resultados[0]).toMatchObject({
        estado: 'duplicada',
        id_servidor: primero.resultados[0].id_servidor,
      });
      expect(await abonosDe(notas[0])).toHaveLength(1);
    });

    it('una nota que no existe es nota-no-encontrada y no deja fila en ningun lado', async () => {
      const { clienteId: cli } = await clienteConNotas([]);
      const op = cobranzaValida(cli, randomUUID());

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'nota-no-encontrada',
      });
      expect(await buzonDe(op.clave)).toBeUndefined();
      expect(await saldoFavorDe(cli)).toEqual([]);
    });

    it('una cobranza sin folio es datos-invalidos', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '250.00', fecha: '2026-08-02' },
      ]);
      const op = cobranzaValida(cli, notas[0], {}, { folio: undefined });

      const res = (await push({ operaciones: [op] }).expect(200))
        .body as RespuestaPush;
      expect(res.resultados[0]).toMatchObject({
        estado: 'rechazada',
        codigo: 'datos-invalidos',
      });
      expect(res.resultados[0].motivo).toMatch(/^folio: /);
      expect(await abonosDe(notas[0])).toEqual([]);
    });
  });

  /* ================================================================ */
  /* Folios (T-14)                                                    */
  /* ================================================================ */
```

- [ ] **Step 10: Suites, build y lint**

```bash
npm test --workspace=apps/backend
npm run build --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
git status --short
```

Expected: `Tests: 309 passed` (304 − 1 + 1 + 5), 26 suites; build y lint limpios; e2e `Tests: 364 passed` (360 + 4), 14 suites; `git status --short` solo con los seis archivos.

- [ ] **Step 11: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/despacho-cobranza.ts \
        apps/backend/src/modules/sincronizacion/despacho-cobranza.spec.ts \
        apps/backend/src/modules/sincronizacion/despacho.ts \
        apps/backend/src/modules/sincronizacion/despacho.spec.ts \
        apps/backend/src/modules/sincronizacion/sincronizacion.service.ts \
        apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(t-20): el push proyecta la cobranza con CobranzasService

despacho-cobranza.ts valida folio, cliente y datos y traduce
nota-no-encontrada; cobranza va al final de la union y del switch
(acuerdo con T-40). proyectar() llama a registrarCobranza en la
transaccion de la operacion y aplicar() traduce CobranzaRechazada. El
smoke de 6 tipos y el it.each de despacho.spec dejan de usar cobranza
como sobre generico. e2e base: aplicada con entidad en el buzon,
duplicada, nota-no-encontrada sin fila y sin folio.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 7: `pull` — saldo derivado, abonos, saldo a favor y notas cerradas + contrato §5 + e2e

**Modelo:** implementador `sonnet` · revisor `opus`

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (`clientes` y `notasPendientes`)
- Modify: `apps/backend/src/modules/sincronizacion/contrato.ts`
- Modify: `apps/tablet/src/sincronizacion/contrato.ts`
- Modify: `apps/tablet/src/datos/pruebas-apoyo.ts` (`respuestaPullDePrueba`)
- Modify: `docs/contrato-sincronizacion.md` (§5)
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts`

**Interfaces:**
- Consumes: `MetodoPago` del contrato (Task 4); `saldo_favor_movimiento` y `cobranza_abono` vivas (Task 1); `clienteConNotas`, `cobranzaValida`, `saldoFavorDe` del e2e (Task 6).
- Produces (idéntico en los dos `contrato.ts`):
  - `interface AbonoPull { fecha_pago: string; monto_centavos: number; metodo_pago: MetodoPago }`
  - `NotaPendientePull.abonos: AbonoPull[]` (vivos, por `fecha_pago` y creación)
  - `ClientePull.saldo_favor_centavos: number`
  - `NotaPendientePull.status` **sigue** siendo `'pendiente' | 'abonado'`.

**Contexto y rulings de esta tarea:**
- **Saldo derivado (D7, D12):** `saldo_centavos = monto_total − Σ abonos vivos`, nunca negativo. Deja de leerse `saldo_pendiente`.
- **Notas cerradas con `desde` (D12):** con `desde`, bajan también las notas **a crédito** cambiadas desde `desde` que ya no están `pendiente`/`abonado` (o que se borraron), con `activo: 0`. Una nota de contado nunca fue cobrable y no se manda.
- **Ruling propuesto — el status de una nota cerrada:** la tablet guarda `nota_pendiente` con `check (status in ('pendiente','abonado'))` y aplica el snapshot en **una** transacción. Una tablet vieja que recibiera `status: "pagada"` fallaría el CHECK y perdería el pull entero. Por eso el contrato no se ensancha: una nota cerrada viaja como `abonado` si tiene abonos vivos y como `pendiente` si no, siempre con `activo: 0`. Lo que la saca de la tablet es `activo: 0`, no el status.
- **Tablet que aún no tiene la migración 005:** estos campos nuevos se ignoran (el upsert solo escribe `COLUMNAS`), así que una tablet vieja no se rompe. La Task 9 los guarda.

- [ ] **Step 1: e2e — pruebas que fallan**

En `apps/backend/test/sincronizacion.e2e-spec.ts`, en la prueba `'baja los catalogos de SU sucursal, los precios resueltos y las notas pendientes'`, reemplaza:

```ts
      expect(cliente?.activo).toBe(1);
```

por:

```ts
      expect(cliente?.activo).toBe(1);
      // T-20: sin movimientos, el saldo a favor es 0.
      expect(cliente?.saldo_favor_centavos).toBe(0);
```

y reemplaza:

```ts
      // Notas pendientes, en centavos y con el saldo del ultimo abono.
      const nota = cuerpo.notas_pendientes.find((n) => n.id === notaId);
      expect(nota).toBeDefined();
      expect(nota?.status).toBe('abonado');
      expect(nota?.monto_total_centavos).toBe(25000);
      expect(nota?.saldo_centavos).toBe(15000);
      expect(nota?.cliente_id).toBe(clienteId);
```

por:

```ts
      // Notas pendientes, en centavos, con el saldo derivado (T-20, D7) y sus abonos.
      const nota = cuerpo.notas_pendientes.find((n) => n.id === notaId);
      expect(nota).toBeDefined();
      expect(nota?.status).toBe('abonado');
      expect(nota?.monto_total_centavos).toBe(25000);
      expect(nota?.saldo_centavos).toBe(15000);
      expect(nota?.cliente_id).toBe(clienteId);
      expect(nota?.abonos).toEqual([
        { fecha_pago: '2026-08-03', monto_centavos: 10000, metodo_pago: 'efectivo' },
      ]);
```

Reemplaza (el encabezado que dejó la Task 6):

```ts
  /* ================================================================ */
  /* Folios (T-14)                                                    */
  /* ================================================================ */
```

por:

```ts
  /* ================================================================ */
  /* Pull (T-20): saldo derivado, abonos, saldo a favor               */
  /* ================================================================ */

  describe('pull (T-20)', () => {
    it('el saldo es derivado de los abonos vivos, no de la foto saldo_pendiente', async () => {
      const { notas } = await clienteConNotas([
        { monto: '300.00', fecha: '2026-08-02', status: 'abonado', abonos: ['100.00', '50.00'] },
      ]);
      // Un abono borrado no cuenta.
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: notas[0],
          fecha_pago: '2026-08-02',
          fecha_operacion: '2026-08-02',
          vendedor_id: vendedorId,
          monto: '25.00',
          tipo: 'abono',
          saldo_pendiente: '0.00',
          metodo_pago: 'cheque',
          deleted_at: new Date(),
        })
        .execute();

      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      const nota = cuerpo.notas_pendientes.find((n) => n.id === notas[0]);
      expect(nota).toMatchObject({
        status: 'abonado',
        monto_total_centavos: 30000,
        saldo_centavos: 15000,
        activo: 1,
      });
      expect(nota?.abonos).toEqual([
        { fecha_pago: '2026-08-02', monto_centavos: 10000, metodo_pago: 'efectivo' },
        { fecha_pago: '2026-08-02', monto_centavos: 5000, metodo_pago: 'efectivo' },
      ]);
    });

    it('el cliente baja con su saldo a favor: la suma de sus movimientos vivos', async () => {
      const { clienteId: cli } = await clienteConNotas([]);
      await db
        .insertInto('saldo_favor_movimiento')
        .values([
          { cliente_id: cli, vendedor_id: vendedorId, monto: '120.50', origen: 'excedente_cobro', fecha_operacion: FECHA_COBROS },
          { cliente_id: cli, vendedor_id: vendedorId, monto: '30.00', origen: 'excedente_cobro', fecha_operacion: FECHA_COBROS },
          { cliente_id: cli, vendedor_id: vendedorId, monto: '99.00', origen: 'excedente_cobro', fecha_operacion: FECHA_COBROS, deleted_at: new Date() },
        ])
        .execute();

      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      const cliente = cuerpo.catalogos.clientes.find((c) => c.id === cli);
      expect(cliente?.saldo_favor_centavos).toBe(15050);
    });

    it('con desde, una nota liquidada o cancelada baja con activo 0 y un status que una tablet vieja acepta', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '100.00', fecha: '2026-08-03' },
        { monto: '70.00', fecha: '2026-08-04' },
      ]);
      const corte = ((await pull().expect(200)).body as RespuestaPull).servidor_en;

      await push({
        operaciones: [cobranzaValida(cli, notas[0], { monto_centavos: 10000 })],
      }).expect(200);
      await db
        .updateTable('venta_nota')
        .set({ status: 'cuenta_perdida' })
        .where('id', '=', notas[1])
        .execute();

      const cuerpo = (await pull({ desde: corte }).expect(200)).body as RespuestaPull;
      const liquidada = cuerpo.notas_pendientes.find((n) => n.id === notas[0]);
      const perdida = cuerpo.notas_pendientes.find((n) => n.id === notas[1]);

      expect(liquidada).toMatchObject({ activo: 0, status: 'abonado', saldo_centavos: 0 });
      expect(liquidada?.abonos).toEqual([
        { fecha_pago: FECHA_COBROS, monto_centavos: 10000, metodo_pago: 'efectivo' },
      ]);
      expect(perdida).toMatchObject({ activo: 0, status: 'pendiente', saldo_centavos: 7000, abonos: [] });
    });

    it('con desde, el cliente baja cuando un cobro le deja saldo a favor', async () => {
      const { clienteId: cli, notas } = await clienteConNotas([
        { monto: '100.00', fecha: '2026-08-03' },
      ]);
      const corte = ((await pull().expect(200)).body as RespuestaPull).servidor_en;

      await push({
        operaciones: [cobranzaValida(cli, notas[0], { monto_centavos: 15000 })],
      }).expect(200);

      const cuerpo = (await pull({ desde: corte }).expect(200)).body as RespuestaPull;
      const cliente = cuerpo.catalogos.clientes.find((c) => c.id === cli);
      expect(cliente?.saldo_favor_centavos).toBe(5000);
    });

    it('sin desde, las notas cerradas no bajan', async () => {
      const { notas } = await clienteConNotas([
        { monto: '80.00', fecha: '2026-08-03', status: 'pagada' },
      ]);
      const cuerpo = (await pull().expect(200)).body as RespuestaPull;
      expect(cuerpo.notas_pendientes.some((n) => n.id === notas[0])).toBe(false);
    });
  });

  /* ================================================================ */
  /* Folios (T-14)                                                    */
  /* ================================================================ */
```

Run: `npm run test:e2e --workspace=apps/backend -- sincronizacion`
Expected: FAIL — ts-jest no encuentra `saldo_favor_centavos` ni `abonos` en los tipos del contrato (y, si compilara, las aserciones nuevas fallarían).

- [ ] **Step 2: Contrato del backend**

En `apps/backend/src/modules/sincronizacion/contrato.ts`, reemplaza:

```ts
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
}

/**
 * Precio **ya resuelto** para un cliente y una presentacion, en centavos.
```

por:

```ts
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
  /**
   * Saldo a favor del cliente, en centavos: la suma de sus movimientos vivos de
   * `saldo_favor_movimiento` (T-20, D5). La tablet solo lo muestra; usarlo es del
   * portal. Aditivo: una tablet vieja lo ignora.
   */
  saldo_favor_centavos: number;
}

/**
 * Precio **ya resuelto** para un cliente y una presentacion, en centavos.
```

Reemplaza:

```ts
/**
 * Nota pendiente por cobrar, para poder seleccionarla al cobrar/abonar sin red.
 *
 * > [!warning] `saldo_centavos` viene de un campo almacenado
 * > Sale del `saldo_pendiente` del ultimo [[Cobranza-Abono|abono]] de la nota, y
 * > del monto total si aun no tiene ninguno. [[Cobranza-Abono]] deja
 * > **pendiente de confirmar** si el saldo debe ser almacenado o derivado
 * > (monto − Σ abonos); T-20 lo cerrara. Aqui se lee lo que hay, no se inventa
 * > un calculo.
 */
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  num_nota: string;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
}
```

por:

```ts
/** Un abono vivo de una nota, para mostrar los pagos previos al cobrar (T-20). */
export interface AbonoPull {
  fecha_pago: string;
  monto_centavos: number;
  metodo_pago: MetodoPago;
}

/**
 * Nota por cobrar, para poder seleccionarla al cobrar/abonar sin red.
 *
 * - `saldo_centavos` es **derivado** (T-20, D7): `monto_total − Σ abonos vivos`,
 *   nunca negativo. `cobranza_abono.saldo_pendiente` es solo una foto.
 * - Con `desde`, tambien bajan las notas a credito que dejaron de estar
 *   pendientes (pagadas, canceladas, borradas) con `activo: 0`, para que la
 *   tablet deje de ofrecerlas.
 * - `status` **no se ensancha**: una nota cerrada viaja como `abonado` si tiene
 *   abonos y como `pendiente` si no. Una tablet vieja guarda esta tabla con un
 *   CHECK de esos dos valores y perderia el pull entero con otro.
 */
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  num_nota: string;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
  /** Vivos, por fecha de pago. Aditivo: una tablet vieja lo ignora. */
  abonos: AbonoPull[];
}
```

- [ ] **Step 3: Contrato de la tablet**

En `apps/tablet/src/sincronizacion/contrato.ts`, reemplaza:

```ts
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
}

export interface PrecioPull extends FilaSincronizable {
```

por:

```ts
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
  /** T-20: suma de los movimientos vivos de saldo a favor, en centavos. Solo se muestra. */
  saldo_favor_centavos: number;
}

export interface PrecioPull extends FilaSincronizable {
```

Reemplaza:

```ts
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  num_nota: string;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
}
```

por:

```ts
/** Un abono vivo de una nota (T-20). */
export interface AbonoPull {
  fecha_pago: string;
  monto_centavos: number;
  metodo_pago: MetodoPago;
}

/**
 * Nota por cobrar. T-20: `saldo_centavos` es derivado (monto − Σ abonos vivos);
 * con `desde` bajan tambien las notas cerradas con `activo: 0`, y su `status`
 * sigue siendo `pendiente`/`abonado` para no romper el CHECK local.
 */
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  num_nota: string;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
  abonos: AbonoPull[];
}
```

(`MetodoPago` ya está declarado más abajo en el mismo archivo desde la Task 4; un `type` se puede usar antes de su declaración.)

- [ ] **Step 4: El pull de prueba de la tablet sigue compilando**

En `apps/tablet/src/datos/pruebas-apoyo.ts`, reemplaza:

```ts
      clientes: s.clientes ?? [],
      precios: s.precios ?? [],
    },
    notas_pendientes: s.notas ?? [],
```

por:

```ts
      // T-20: el snapshot local aun no guarda estos campos (llegan en la migracion 005).
      clientes: (s.clientes ?? []).map((c) => ({ ...c, saldo_favor_centavos: 0 })),
      precios: s.precios ?? [],
    },
    notas_pendientes: (s.notas ?? []).map((n) => ({ ...n, abonos: [] })),
```

- [ ] **Step 5: El repositorio — clientes con saldo a favor**

En `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts`, dentro de `async clientes(`, reemplaza:

```ts
        'sucursal_id',
        'deleted_at',
      ])
      .where('sucursal_id', '=', sucursalId);
    if (desde) q = q.where('updated_at', '>', desde);
```

por:

```ts
        'sucursal_id',
        'deleted_at',
      ])
      // T-20 (D5): el saldo a favor es la suma de los movimientos vivos. Con
      // `desde`, un cliente vuelve a bajar porque `registrarCobranza` le toca
      // `updated_at` al crearle un movimiento.
      .select((eb) =>
        eb
          .selectFrom('saldo_favor_movimiento as sf')
          .select(sql<string>`coalesce(sum(sf.monto), 0)::text`.as('total'))
          .whereRef('sf.cliente_id', '=', 'cliente.id')
          .where('sf.deleted_at', 'is', null)
          .as('saldo_favor'),
      )
      .where('sucursal_id', '=', sucursalId);
    if (desde) q = q.where('updated_at', '>', desde);
```

y, en el `map` del mismo método, reemplaza:

```ts
      lng: aNumero(f.lng),
      sucursal_id: f.sucursal_id,
      activo: bandera(true, f.deleted_at),
    }));
  }
```

por:

```ts
      lng: aNumero(f.lng),
      sucursal_id: f.sucursal_id,
      saldo_favor_centavos: aCentavos(f.saldo_favor),
      activo: bandera(true, f.deleted_at),
    }));
  }
```

(`aCentavos` acepta `null`: un cliente sin movimientos da 0.)

- [ ] **Step 6: El repositorio — notas con saldo derivado, abonos y cerradas**

En el mismo archivo, reemplaza todo el método `notasPendientes` — desde:

```ts
  async notasPendientes(
    sucursalId: string,
    desde: Date | null,
  ): Promise<NotaPendientePull[]> {
```

hasta su `}` de cierre, justo antes de

```ts
  /* ---------------------------------------------------------------- */
  /* Push                                                              */
```

— por:

```ts
  async notasPendientes(
    sucursalId: string,
    desde: Date | null,
  ): Promise<NotaPendientePull[]> {
    const filas = await sql<{
      id: string;
      folio: string;
      num_nota: string;
      fecha: string;
      cliente_id: string;
      status: string;
      monto_total: string;
      abonado: string;
      abonos: { fecha_pago: string; monto: string; metodo_pago: string }[];
      borrada: Date | null;
    }>`
      select vn.id, vn.folio, vn.num_nota,
             to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, vn.status, vn.monto_total,
             coalesce(a.abonado, 0)::text as abonado,
             coalesce(a.abonos, '[]'::json) as abonos,
             vn.deleted_at as borrada
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        left join lateral (
          select sum(ca.monto) as abonado,
                 json_agg(
                   json_build_object(
                     'fecha_pago', to_char(ca.fecha_pago, 'YYYY-MM-DD'),
                     'monto', ca.monto::text,
                     'metodo_pago', ca.metodo_pago
                   ) order by ca.fecha_pago, ca.created_at
                 ) as abonos
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where c.sucursal_id = ${sucursalId}
         and ${
           desde
             ? // Incremental: lo que cambio, incluidas las notas a credito que
               // se cerraron (D12). Una de contado nunca fue cobrable.
               sql`vn.updated_at > ${desde}
                   and (vn.status in ('pendiente', 'abonado') or vn.contado_credito = 'credito')`
             : sql`vn.status in ('pendiente', 'abonado')`
         }
       order by vn.fecha, vn.folio
    `.execute(this.db);

    return filas.rows.map((f) => {
      const abierta = f.status === 'pendiente' || f.status === 'abonado';
      return {
        id: f.id,
        folio: f.folio,
        num_nota: f.num_nota,
        fecha: f.fecha,
        cliente_id: f.cliente_id,
        // Una nota cerrada viaja con un status que el CHECK de una tablet vieja
        // acepta; lo que la saca de la tablet es `activo: 0` (ver contrato).
        status: abierta
          ? (f.status as 'pendiente' | 'abonado')
          : f.abonos.length > 0
            ? 'abonado'
            : 'pendiente',
        monto_total_centavos: aCentavos(f.monto_total),
        // D7: derivado, nunca de la foto `saldo_pendiente`.
        saldo_centavos: Math.max(
          0,
          aCentavos(f.monto_total) - aCentavos(f.abonado),
        ),
        abonos: f.abonos.map((a) => ({
          fecha_pago: a.fecha_pago,
          monto_centavos: aCentavos(a.monto),
          metodo_pago: a.metodo_pago as MetodoPago,
        })),
        activo: abierta && f.borrada === null ? 1 : 0,
      };
    });
  }
```

Y en los imports del archivo, reemplaza:

```ts
import type {
  ClientePull,
  NotaPendientePull,
```

por:

```ts
import type {
  ClientePull,
  MetodoPago,
  NotaPendientePull,
```

- [ ] **Step 7: `docs/contrato-sincronizacion.md` §5**

En el ejemplo de respuesta, reemplaza:

```jsonc
                         "lat": 32.5149, "lng": -117.0382, "sucursal_id": "…", "activo": 1 }],
```

por:

```jsonc
                         "lat": 32.5149, "lng": -117.0382, "sucursal_id": "…",
                         "saldo_favor_centavos": 0, "activo": 1 }],
```

y reemplaza:

```jsonc
                          "monto_total_centavos": 25000, "saldo_centavos": 15000,
                          "activo": 1 }]
```

por:

```jsonc
                          "monto_total_centavos": 25000, "saldo_centavos": 15000,
                          "abonos": [{ "fecha_pago": "2026-08-03", "monto_centavos": 10000,
                                       "metodo_pago": "efectivo" }],
                          "activo": 1 }]
```

Reemplaza la sección entera:

```markdown
### `saldo_centavos` — pendiente de confirmar

Sale del `saldo_pendiente` del **último abono** de la nota (y del monto total si
aún no tiene ninguno). `10-Dominio/Entidades/Cobranza-Abono.md` deja abierto si
ese saldo debería ser almacenado o derivado (`monto − Σ abonos`); **T-20 lo
cerrará**. Aquí se lee lo que hay, no se inventa un cálculo.
```

por:

```markdown
### Notas pendientes: saldo derivado, abonos y notas cerradas (T-20)

- **`saldo_centavos` es derivado:** `monto_total − Σ abonos vivos`, nunca negativo. La columna
  `cobranza_abono.saldo_pendiente` es una foto del saldo tras cada fila y no se lee como fuente.
- **`abonos`** trae los abonos vivos de la nota (`fecha_pago`, `monto_centavos`, `metodo_pago`),
  por fecha de pago, para mostrar los pagos previos al cobrar.
- **Con `desde`, bajan también las notas a crédito que dejaron de estar pendientes** (pagadas,
  canceladas, borradas) con `activo: 0`. Así la tablet deja de ofrecer una nota que liquidó otro
  dispositivo o el portal. Una nota cerrada viaja con `status` `abonado` si tiene abonos y
  `pendiente` si no: una tablet anterior a T-20 guarda esta tabla con un CHECK de esos dos valores
  y, con otro, perdería el pull entero.
- **`saldo_favor_centavos`** de cada cliente es la suma de sus movimientos vivos de saldo a favor.
  Un cobro que deja saldo a favor le toca `updated_at` al cliente, así que vuelve a bajar en el
  pull incremental (y con él, la colección de precios completa: es su regla de siempre).
- Los tres campos son **aditivos**: una tablet vieja los ignora.
```

- [ ] **Step 8: Suites, build, lint y e2e**

```bash
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git status --short
```

Expected: build limpio; `Tests: 309 passed` (26 suites); lint sin cambios; e2e `Tests: 369 passed` (364 + 5), 14 suites; tablet `Tests: 227 passed` (16 suites), typecheck y lint limpios; `git status --short` solo con los seis archivos.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts \
        apps/backend/src/modules/sincronizacion/contrato.ts \
        apps/tablet/src/sincronizacion/contrato.ts \
        apps/tablet/src/datos/pruebas-apoyo.ts \
        docs/contrato-sincronizacion.md \
        apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(t-20): pull con saldo derivado, abonos, saldo a favor y notas cerradas

saldo_centavos pasa a monto_total menos los abonos vivos (D7) y cada
nota trae sus abonos; cada cliente trae saldo_favor_centavos (D5). Con
desde, bajan las notas a credito que se cerraron con activo 0 (D12),
con status pendiente/abonado para no romper el CHECK de una tablet
vieja. Aditivo en backend, tablet y docs §5.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 8: e2e de las reglas de cobranza

**Modelo:** implementador `sonnet` · revisor `opus`

**Files:**
- Modify: `apps/backend/test/sincronizacion.e2e-spec.ts`

**Interfaces:**
- Consumes: `clienteConNotas`, `cobranzaValida`, `abonosDe`, `statusDe`, `saldoFavorDe`, `FECHA_COBROS` (Task 6); `ventaValida`, `ventasConFolio`, `buzonDe` (T-16); todo el backend de las Tasks 1–7.
- Produces: 11 pruebas e2e que fijan D1, D8, D9, D10, D13 y la cobranza posterior a su venta. No cambia código de producción: si una prueba falla, **detente** y repórtalo (es un bug de las Tasks 5–7, no algo que se "arregle" en la prueba).

- [ ] **Step 1: Escribir las pruebas**

En `apps/backend/test/sincronizacion.e2e-spec.ts`, al final del `describe('cobranzas (T-20)')` de la Task 6, reemplaza:

```ts
      expect(res.resultados[0].motivo).toMatch(/^folio: /);
      expect(await abonosDe(notas[0])).toEqual([]);
    });
  });
```

por:

```ts
      expect(res.resultados[0].motivo).toMatch(/^folio: /);
      expect(await abonosDe(notas[0])).toEqual([]);
    });

    describe('reglas del reparto de punta a punta', () => {
      it('dos abonos seguidos: cada fila guarda la foto de su saldo y la nota queda abonado', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '250.00', fecha: '2026-08-02' },
        ]);
        await push({
          operaciones: [cobranzaValida(cli, notas[0], { monto_centavos: 10000 })],
        }).expect(200);
        await push({
          operaciones: [cobranzaValida(cli, notas[0], { monto_centavos: 5000 })],
        }).expect(200);

        const abonos = await abonosDe(notas[0]);
        expect(abonos.map((a) => [a.monto, a.tipo, a.saldo_pendiente])).toEqual([
          ['100.00', 'abono', '150.00'],
          ['50.00', 'abono', '100.00'],
        ]);
        expect(await statusDe(notas[0])).toBe('abonado');
      });

      it('liquidar exacto deja la nota pagada y la fila es tipo cobranza', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '250.00', fecha: '2026-08-02', status: 'abonado', abonos: ['100.00'] },
        ]);
        const op = cobranzaValida(cli, notas[0], { monto_centavos: 15000, metodo_pago: 'transferencia' });
        await push({ operaciones: [op] }).expect(200);

        const abonos = await abonosDe(notas[0]);
        expect(abonos[abonos.length - 1]).toMatchObject({
          monto: '150.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'transferencia',
          folio: op.folio,
        });
        expect(await statusDe(notas[0])).toBe('pagada');
        expect(await saldoFavorDe(cli)).toEqual([]);
      });

      it('el excedente va a las otras notas de la mas vieja a la mas nueva, con el mismo folio (D1)', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-05' }, // la elegida
          { monto: '50.00', fecha: '2026-08-01' },
          { monto: '80.00', fecha: '2026-08-03' },
        ]);
        const [elegida, vieja, media] = notas;
        const op = cobranzaValida(cli, elegida, { monto_centavos: 20000 });
        const res = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('aplicada');

        const [aElegida] = await abonosDe(elegida);
        const [aVieja] = await abonosDe(vieja);
        const [aMedia] = await abonosDe(media);
        expect([aElegida.monto, aElegida.tipo, aElegida.folio]).toEqual(['100.00', 'cobranza', op.folio]);
        expect([aVieja.monto, aVieja.tipo, aVieja.folio]).toEqual(['50.00', 'cobranza', op.folio]);
        expect([aMedia.monto, aMedia.tipo, aMedia.saldo_pendiente, aMedia.folio]).toEqual([
          '50.00',
          'abono',
          '30.00',
          op.folio,
        ]);
        expect(await statusDe(elegida)).toBe('pagada');
        expect(await statusDe(vieja)).toBe('pagada');
        expect(await statusDe(media)).toBe('abonado');
        expect(await saldoFavorDe(cli)).toEqual([]);

        // El buzon apunta a la primera fila: la de la nota elegida.
        expect(await buzonDe(op.clave)).toMatchObject({
          entidad_tabla: 'cobranza_abono',
          entidad_id: aElegida.id,
        });
      });

      it('lo que sobra de todas las notas queda como saldo a favor del cliente', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-02' },
        ]);
        const op = cobranzaValida(cli, notas[0], { monto_centavos: 13050 });
        await push({ operaciones: [op] }).expect(200);

        expect(await statusDe(notas[0])).toBe('pagada');
        const favor = await saldoFavorDe(cli);
        expect(favor).toHaveLength(1);
        expect(favor[0]).toMatchObject({
          monto: '30.50',
          origen: 'excedente_cobro',
          folio: op.folio,
          vendedor_id: vendedorId,
        });
        expect(fechaTexto(favor[0].fecha_operacion)).toBe(FECHA_COBROS);
      });

      it('una nota ya pagada en el servidor no rechaza el cobro: el dinero va a las otras y a favor (D9)', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-01', status: 'pagada', abonos: ['100.00'] },
          { monto: '60.00', fecha: '2026-08-02' },
        ]);
        const [pagada, otra] = notas;
        const op = cobranzaValida(cli, pagada, { monto_centavos: 10000 });
        const res = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('aplicada');

        expect(await abonosDe(pagada)).toHaveLength(1); // solo el abono previo
        const [aOtra] = await abonosDe(otra);
        expect([aOtra.monto, aOtra.tipo]).toEqual(['60.00', 'cobranza']);
        expect(await statusDe(otra)).toBe('pagada');
        expect((await saldoFavorDe(cli)).map((f) => f.monto)).toEqual(['40.00']);
        expect(await buzonDe(op.clave)).toMatchObject({
          entidad_tabla: 'cobranza_abono',
          entidad_id: aOtra.id,
        });
      });

      it('si no hay nota que reciba dinero, el buzon apunta al movimiento de saldo a favor', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-01', status: 'pagada', abonos: ['100.00'] },
        ]);
        const op = cobranzaValida(cli, notas[0], { monto_centavos: 5000 });
        await push({ operaciones: [op] }).expect(200);

        const favor = await saldoFavorDe(cli);
        expect(favor.map((f) => f.monto)).toEqual(['50.00']);
        expect(await buzonDe(op.clave)).toMatchObject({
          entidad_tabla: 'saldo_favor_movimiento',
          entidad_id: favor[0].id,
        });
      });

      it('una nota de otra sucursal es nota-no-encontrada y no deja fila', async () => {
        const { clienteId: cli } = await clienteConNotas([]);
        const notaAjena = (
          await db
            .insertInto('venta_nota')
            .values({
              folio: `EA${SUFIJO}`.slice(0, 20),
              fecha: '2026-08-02',
              cliente_id: clienteAjenoId,
              vendedor_id: vendedorAjenoId,
              monto_total: '90.00',
              num_nota: '901',
              contado_credito: 'credito',
              semana: 32,
              mes: 8,
              status: 'pendiente',
              sucursal_id: sucursalAjenaId,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;

        const op = cobranzaValida(cli, notaAjena);
        const res = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
        expect(res.resultados[0]).toMatchObject({ estado: 'rechazada', codigo: 'nota-no-encontrada' });
        expect(await buzonDe(op.clave)).toBeUndefined();
        expect(await abonosDe(notaAjena)).toEqual([]);
        expect(await statusDe(notaAjena)).toBe('pendiente');
      });

      it('una nota de otro cliente de la misma sucursal es nota-no-encontrada', async () => {
        const uno = await clienteConNotas([]);
        const otro = await clienteConNotas([{ monto: '90.00', fecha: '2026-08-02' }]);

        const op = cobranzaValida(uno.clienteId, otro.notas[0]);
        const res = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
        expect(res.resultados[0]).toMatchObject({ estado: 'rechazada', codigo: 'nota-no-encontrada' });
        expect(await buzonDe(op.clave)).toBeUndefined();
        expect(await abonosDe(otro.notas[0])).toEqual([]);
      });

      it('una fecha de pago posterior a la fecha de operacion es datos-invalidos', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '90.00', fecha: '2026-08-02' },
        ]);
        const op = cobranzaValida(cli, notas[0], { fecha_pago: '2026-08-10' });
        const res = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
        expect(res.resultados[0]).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
        expect(res.resultados[0].motivo).toMatch(/^fecha_pago: /);
      });

      it('una cobranza sobre una venta que subio en un lote anterior se aplica', async () => {
        // Es el orden real: el motor de la tablet sube por fuente, primero las
        // ventas y despues las cobranzas, en lotes distintos.
        const { clienteId: cli } = await clienteConNotas([]);
        const venta = ventaValida({ cliente_id: cli });
        await push({ operaciones: [venta] }).expect(200);
        const [nota] = await ventasConFolio(venta.folio as string);
        expect(nota.monto_total).toBe('192.00');

        const op = cobranzaValida(cli, nota.id, { monto_centavos: 19200 });
        const res = (await push({ operaciones: [op] }).expect(200)).body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('aplicada');
        expect(await statusDe(nota.id)).toBe('pagada');
      });

      it('dos cobros simultaneos sobre la misma nota no reparten el mismo saldo (D13)', async () => {
        const { clienteId: cli, notas } = await clienteConNotas([
          { monto: '100.00', fecha: '2026-08-03' },
        ]);
        const a = cobranzaValida(cli, notas[0], { monto_centavos: 10000 });
        const b = cobranzaValida(cli, notas[0], { monto_centavos: 10000 });

        const [ra, rb] = await Promise.all([
          push({ operaciones: [a] }).expect(200),
          push({ operaciones: [b] }).expect(200),
        ]);
        expect((ra.body as RespuestaPush).resultados[0].estado).toBe('aplicada');
        expect((rb.body as RespuestaPush).resultados[0].estado).toBe('aplicada');

        // Gane quien gane el candado: una liquida la nota y la otra queda a favor.
        expect((await abonosDe(notas[0])).map((x) => x.monto)).toEqual(['100.00']);
        expect((await saldoFavorDe(cli)).map((f) => f.monto)).toEqual(['100.00']);
        expect(await statusDe(notas[0])).toBe('pagada');
      });
    });
  });
```

- [ ] **Step 2: Correr el e2e**

Run: `npm run test:e2e --workspace=apps/backend -- sincronizacion`
Expected: PASS. Si alguna falla, **detente** y reporta la salida al controlador.

- [ ] **Step 3: Suite completa y lint**

```bash
npm run test:e2e --workspace=apps/backend
npm run lint --workspace=apps/backend
git status --short
```

Expected: e2e `Tests: 380 passed` (369 + 11), 14 suites; lint sin cambios; `git status --short` solo con el e2e.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/test/sincronizacion.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(t-20): e2e de las reglas de cobranza en push

Foto del saldo por fila, liquidacion, excedente por fecha con el mismo
folio, saldo a favor, nota ya pagada sin rechazo (D9), buzon apuntando
al movimiento cuando todo queda a favor, nota de otra sucursal o de otro
cliente (D10), fecha de pago futura, cobranza tras su venta en un lote
anterior y dos cobros simultaneos sobre la misma nota (D13).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 9: Tablet — migración 005 + tipos + snapshot

**Modelo:** implementador `sonnet` · revisor `sonnet`

**Files:**
- Create: `apps/tablet/src/datos/migraciones/005-cobranzas.ts`
- Test: `apps/tablet/src/datos/migraciones/005-cobranzas.spec.ts`
- Modify: `apps/tablet/src/datos/migraciones/index.ts`
- Modify: `apps/tablet/src/datos/migraciones/004-ventas.spec.ts`
- Modify: `apps/tablet/src/datos/tipos.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (`COLUMNAS`)
- Modify: `apps/tablet/src/datos/repositorios/catalogos.spec.ts`
- Modify: `apps/tablet/src/sincronizacion/motor.ts` (`aSnapshot`)
- Modify: `apps/tablet/src/sincronizacion/motor.spec.ts`
- Modify: `apps/tablet/src/datos/pruebas-apoyo.ts`

**Interfaces:**
- Consumes: `AbonoPull`, `ClientePull.saldo_favor_centavos`, `NotaPendientePull.abonos` del contrato de la tablet (Task 7).
- Produces:
  - Esquema local versión **5**: tabla `cobranza`; `nota_pendiente.abonos_json text not null default '[]'`; `cliente.saldo_favor_centavos integer not null default 0`.
  - En `tipos.ts`: `type MetodoPago = 'efectivo' | 'transferencia' | 'cheque'`; `interface AbonoNota { fecha_pago: FechaISO; monto_centavos: number; metodo_pago: MetodoPago }`; `Cliente.saldo_favor_centavos: number`; `NotaPendiente.abonos_json: string`; `interface Cobranza { id; fecha; cliente_id; vendedor_id; sucursal_id; folio; venta_nota_id; monto_centavos; metodo_pago: MetodoPago; fecha_pago: FechaISO; grabada_en; sync_estado: SyncEstado; sync_error: string | null; sincronizado_en: MomentoISO | null }`.
  - `aSnapshot` convierte `abonos` en `abonos_json` y pone 0 / `'[]'` si el servidor no los manda.

**Contexto:** una migración publicada no se edita (regla de `migraciones/index.ts`): se agrega la 005. `nota_pendiente.status` conserva su CHECK `('pendiente','abonado')`: el pull no manda otro valor (Task 7) y el reparto local marca `activo = 0` en vez de inventar `pagada`. `004-ventas.spec.ts` afirmaba "exactamente 4 migraciones"; pasa a afirmar lo suyo (que la 004 está y dejó sus tablas) sin fijar el total.

- [ ] **Step 1: Escribir las pruebas que fallan de la migración**

Crea `apps/tablet/src/datos/migraciones/005-cobranzas.spec.ts`:

```ts
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/** Base migrada al dia con el catalogo de prueba (cli-1, ven-1, suc-tj, nota-1). */
function montar() {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

const INSERTAR_COBRANZA = `insert into cobranza
  (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, venta_nota_id,
   monto_centavos, metodo_pago, fecha_pago, grabada_en)
  values ($id, '2026-08-07', 'cli-1', 'ven-1', 'suc-tj', $folio, 'nota-1',
          $monto_centavos, $metodo_pago, '2026-08-07', '2026-08-07T15:00:00.000Z')`;

const cobro = (extra: Record<string, string | number> = {}) => ({
  $id: 'cob-1',
  $folio: 'TJ260807AP01',
  $monto_centavos: 5000,
  $metodo_pago: 'efectivo',
  ...extra,
});

describe('migracion 005: cobranzas (T-20)', () => {
  it('deja la base en la version 5, con la tabla cobranza', () => {
    const bd = montar();
    expect(migraciones).toHaveLength(5);
    expect(versionEsquema(bd)).toBe(5);
    const tablas = bd.getAllSync<{ name: string }>(
      `select name from sqlite_master where type = 'table' and name = 'cobranza'`,
    );
    expect(tablas.map((t) => t.name)).toEqual(['cobranza']);
  });

  it('las columnas nuevas de notas y clientes son obligatorias y nacen vacias', () => {
    const bd = montar();
    const abonos = bd.getFirstSync<{ notnull: number; dflt_value: string }>(
      `select "notnull", dflt_value from pragma_table_info('nota_pendiente') where name = 'abonos_json'`,
    );
    const saldo = bd.getFirstSync<{ notnull: number; dflt_value: string }>(
      `select "notnull", dflt_value from pragma_table_info('cliente') where name = 'saldo_favor_centavos'`,
    );
    expect(abonos).toEqual({ notnull: 1, dflt_value: "'[]'" });
    expect(saldo).toEqual({ notnull: 1, dflt_value: '0' });
  });

  it('un cobro nace pendiente de subir y sin error', () => {
    const bd = montar();
    bd.runSync(INSERTAR_COBRANZA, cobro());
    expect(
      bd.getFirstSync<{ sync_estado: string; sync_error: string | null }>(
        `select sync_estado, sync_error from cobranza where id = 'cob-1'`,
      ),
    ).toEqual({ sync_estado: 'pendiente', sync_error: null });
  });

  it('no acepta un cobro de $0', () => {
    const bd = montar();
    expect(() => bd.runSync(INSERTAR_COBRANZA, cobro({ $monto_centavos: 0 }))).toThrow();
  });

  it('no acepta un metodo de pago fuera del catalogo', () => {
    const bd = montar();
    expect(() => bd.runSync(INSERTAR_COBRANZA, cobro({ $metodo_pago: 'tarjeta' }))).toThrow();
  });

  it('el folio es unico', () => {
    const bd = montar();
    bd.runSync(INSERTAR_COBRANZA, cobro());
    expect(() => bd.runSync(INSERTAR_COBRANZA, cobro({ $id: 'cob-2' }))).toThrow();
  });
});
```

Run: `npm test --workspace=apps/tablet -- 005-cobranzas`
Expected: FAIL (la versión es 4 y no existe `cobranza`).

- [ ] **Step 2: La migración**

Crea `apps/tablet/src/datos/migraciones/005-cobranzas.ts`:

```ts
import type { Migracion } from './motor';

/**
 * La cobranza capturada en ruta (T-20).
 *
 * ## `cobranza`
 *
 * Un pago del cliente sobre UNA nota pendiente (D1). Como la venta: dinero en
 * centavos enteros, fechas como texto ISO, `id` = clave de idempotencia y
 * `operacion_clave` de su folio en `folio_emitido`. No se edita: solo cambia
 * su estado de sincronizacion.
 *
 * No guarda el reparto: el servidor lo recalcula al proyectar con la verdad de
 * Postgres. El reparto local vive en los saldos de `nota_pendiente` y en
 * `cliente.saldo_favor_centavos`, y el siguiente pull los pisa.
 *
 * ## `nota_pendiente.abonos_json`
 *
 * Los abonos previos de la nota tal como bajan del pull (`AbonoPull[]` en JSON),
 * mas los que la tablet agrega al cobrar sin red. Se muestran al cobrar
 * ([[Cobranza-Abono]]: "mostrar fechas de abonos previos y saldo pendiente").
 * Texto y no tabla: nadie consulta dentro, solo se pinta.
 *
 * ## `cliente.saldo_favor_centavos`
 *
 * El saldo a favor que manda el pull (D5), mas el excedente de los cobros
 * locales. Solo se muestra; usarlo es del portal.
 *
 * `nota_pendiente.status` conserva su CHECK: una nota que queda en saldo 0 se
 * marca `activo = 0`, no `pagada`.
 */
export const cobranzas: Migracion = {
  version: 5,
  nombre: 'cobranzas',
  sql: `
    create table cobranza (
      id               text primary key,          -- = clave de idempotencia
      fecha            text not null,             -- dia de trabajo, el del folio
      cliente_id       text not null references cliente(id),
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      folio            text not null unique,
      venta_nota_id    text not null references nota_pendiente(id),
      monto_centavos   integer not null check (monto_centavos > 0),
      metodo_pago      text not null check (metodo_pago in ('efectivo','transferencia','cheque')),
      fecha_pago       text not null,
      grabada_en       text not null,
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text
    );

    -- Lo que falta por subir (mismo patron que idx_venta_sync).
    create index idx_cobranza_sync on cobranza (sync_estado) where sync_estado <> 'sincronizado';
    -- "Cobros de hoy" del cliente.
    create index idx_cobranza_cliente_fecha on cobranza (cliente_id, fecha);

    alter table nota_pendiente add column abonos_json text not null default '[]';
    alter table cliente add column saldo_favor_centavos integer not null default 0;
  `,
};
```

En `apps/tablet/src/datos/migraciones/index.ts`, reemplaza:

```ts
import { ventas } from './004-ventas';
```

por:

```ts
import { ventas } from './004-ventas';
import { cobranzas } from './005-cobranzas';
```

y reemplaza:

```ts
  folios,
  ventas,
];
```

por:

```ts
  folios,
  ventas,
  cobranzas,
];
```

En `apps/tablet/src/datos/migraciones/004-ventas.spec.ts`, reemplaza:

```ts
  it('deja la base en la version 4, con venta y venta_linea', () => {
    const bd = montar();
    expect(migraciones).toHaveLength(4);
    expect(versionEsquema(bd)).toBe(4);
```

por:

```ts
  it('deja la base migrada, con venta y venta_linea (version 4 en adelante)', () => {
    const bd = montar();
    // T-20 agrego la 005: aqui solo se afirma lo de la 004.
    expect(migraciones[3]?.nombre).toBe('ventas');
    expect(versionEsquema(bd)).toBe(migraciones.length);
```

- [ ] **Step 3: Tipos**

En `apps/tablet/src/datos/tipos.ts`, reemplaza:

```ts
   * siempre. Ver la migracion `002-sincronizacion.ts`.
   */
  activo: Booleano;
  sincronizado_en: MomentoISO;
}

export interface ClientePrecio {
```

por:

```ts
   * siempre. Ver la migracion `002-sincronizacion.ts`.
   */
  activo: Booleano;
  /**
   * Saldo a favor en centavos (T-20, D5): el que manda el pull mas el excedente
   * de los cobros locales. Solo se muestra; usarlo es del portal.
   */
  saldo_favor_centavos: number;
  sincronizado_en: MomentoISO;
}

export interface ClientePrecio {
```

Reemplaza:

```ts
  monto_total_centavos: number;
  saldo_centavos: number;
  activo: Booleano;
  sincronizado_en: MomentoISO;
}

export type EstadoJornada = 'abierta' | 'cerrada';
```

por:

```ts
  monto_total_centavos: number;
  saldo_centavos: number;
  /**
   * `AbonoNota[]` en JSON (T-20): los del pull mas los cobrados sin red. Se lee
   * con `leerAbonos`, que tolera un texto corrupto.
   */
  abonos_json: string;
  activo: Booleano;
  sincronizado_en: MomentoISO;
}

export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

/** Un abono de una nota, para mostrar los pagos previos (T-20). */
export interface AbonoNota {
  fecha_pago: FechaISO;
  monto_centavos: number;
  metodo_pago: MetodoPago;
}

/**
 * Un cobro grabado en la tablet (T-20). Ver la migracion `005-cobranzas.ts`.
 *
 * No guarda el reparto: lo recalcula el servidor. No se edita.
 */
export interface Cobranza {
  /** uuid v4 generado al grabar. Es la clave de idempotencia del push. */
  id: string;
  /** Dia de trabajo, el del folio y de `fecha_operacion`. */
  fecha: FechaISO;
  cliente_id: string;
  vendedor_id: string;
  sucursal_id: string;
  folio: string;
  /** La nota que eligio el vendedor (id del servidor, bajado en el pull). */
  venta_nota_id: string;
  monto_centavos: number;
  metodo_pago: MetodoPago;
  fecha_pago: FechaISO;
  grabada_en: MomentoISO;
  sync_estado: SyncEstado;
  /** Motivo con el que el servidor lo rechazo, si `sync_estado = 'error'`. */
  sync_error: string | null;
  sincronizado_en: MomentoISO | null;
}

export type EstadoJornada = 'abierta' | 'cerrada';
```

- [ ] **Step 4: Snapshot — columnas, `aSnapshot` y datos de prueba**

En `apps/tablet/src/datos/repositorios/catalogos.ts`, dentro de `COLUMNAS.cliente`, reemplaza:

```ts
    'lng',
    'sucursal_id',
    'activo',
  ],
  cliente_precio: [
```

por:

```ts
    'lng',
    'sucursal_id',
    'activo',
    // T-20 (D5): solo se muestra.
    'saldo_favor_centavos',
  ],
  cliente_precio: [
```

y dentro de `COLUMNAS.nota_pendiente`, reemplaza:

```ts
    'monto_total_centavos',
    'saldo_centavos',
    'activo',
  ],
} as const;
```

por:

```ts
    'monto_total_centavos',
    'saldo_centavos',
    'activo',
    // T-20: los abonos previos, en JSON.
    'abonos_json',
  ],
} as const;
```

En `apps/tablet/src/sincronizacion/motor.ts`, reemplaza:

```ts
    clientes: c.clientes,
    precios: c.precios,
    notas: respuesta.notas_pendientes,
  };
}
```

por:

```ts
    // T-20: un servidor anterior a T-20 no manda estos campos; con `?? 0` y
    // `?? []` la tablet nueva no revienta el NOT NULL de su esquema.
    clientes: c.clientes.map((cliente) => ({
      ...cliente,
      saldo_favor_centavos: cliente.saldo_favor_centavos ?? 0,
    })),
    precios: c.precios,
    notas: respuesta.notas_pendientes.map(({ abonos, ...nota }) => ({
      ...nota,
      abonos_json: JSON.stringify(abonos ?? []),
    })),
  };
}
```

Y en el comentario de `FuenteOperaciones` del mismo archivo, reemplaza:

```ts
 * TODO: T-16/T-20/T-27/T-33/T-39 — una fuente por modulo.
```

por:

```ts
 * Hechas: jornada, venta (T-16) y cobranza (T-20).
 * TODO: T-27/T-33/T-39 — una fuente por modulo.
```

En `apps/tablet/src/datos/pruebas-apoyo.ts`:

(a) Reemplaza:

```ts
import type { RespuestaPull } from '@/sincronizacion/contrato';
```

por:

```ts
import type { AbonoPull, RespuestaPull } from '@/sincronizacion/contrato';
```

(b) En `cli-1`, reemplaza:

```ts
        lat: 32.5149,
        lng: -117.0382,
        sucursal_id: 'suc-tj',
        activo: 1,
      },
```

por:

```ts
        lat: 32.5149,
        lng: -117.0382,
        sucursal_id: 'suc-tj',
        activo: 1,
        saldo_favor_centavos: 0,
      },
```

(c) En `cli-2`, reemplaza:

```ts
        lat: null,
        lng: null,
        sucursal_id: 'suc-tj',
        activo: 1,
      },
```

por:

```ts
        lat: null,
        lng: null,
        sucursal_id: 'suc-tj',
        activo: 1,
        saldo_favor_centavos: 0,
      },
```

(d) En `nota-1`, reemplaza:

```ts
        monto_total_centavos: 25000,
        saldo_centavos: 15000,
        activo: 1,
      },
```

por:

```ts
        monto_total_centavos: 25000,
        saldo_centavos: 15000,
        abonos_json: JSON.stringify([
          { fecha_pago: '2026-08-03', monto_centavos: 10000, metodo_pago: 'efectivo' },
        ]),
        activo: 1,
      },
```

(e) En `nota-2`, reemplaza:

```ts
        monto_total_centavos: 10000,
        saldo_centavos: 10000,
        activo: 1,
      },
```

por:

```ts
        monto_total_centavos: 10000,
        saldo_centavos: 10000,
        abonos_json: '[]',
        activo: 1,
      },
```

(f) En `respuestaPullDePrueba`, reemplaza lo que dejó la Task 7:

```ts
      // T-20: el snapshot local aun no guarda estos campos (llegan en la migracion 005).
      clientes: (s.clientes ?? []).map((c) => ({ ...c, saldo_favor_centavos: 0 })),
      precios: s.precios ?? [],
    },
    notas_pendientes: (s.notas ?? []).map((n) => ({ ...n, abonos: [] })),
```

por:

```ts
      clientes: s.clientes ?? [],
      precios: s.precios ?? [],
    },
    // El pull manda los abonos como lista; el snapshot local, como JSON.
    notas_pendientes: (s.notas ?? []).map(({ abonos_json, ...n }) => ({
      ...n,
      abonos: JSON.parse(abonos_json) as AbonoPull[],
    })),
```

- [ ] **Step 5: Pruebas del snapshot y de `aSnapshot`**

En `apps/tablet/src/datos/repositorios/catalogos.spec.ts`, reemplaza:

```ts
    it('un cliente sin notas devuelve lista vacia, no null', () => {
      const { catalogos } = conCatalogos();
      expect(catalogos.notasPendientesDe('cli-2')).toEqual([]);
    });
```

por:

```ts
    it('un cliente sin notas devuelve lista vacia, no null', () => {
      const { catalogos } = conCatalogos();
      expect(catalogos.notasPendientesDe('cli-2')).toEqual([]);
    });

    it('guarda los abonos de cada nota y el saldo a favor del cliente (T-20)', () => {
      const { catalogos } = conCatalogos();
      expect(JSON.parse(catalogos.notasPendientesDe('cli-1')[0]!.abonos_json)).toEqual([
        { fecha_pago: '2026-08-03', monto_centavos: 10000, metodo_pago: 'efectivo' },
      ]);
      expect(catalogos.obtenerCliente('cli-1')?.saldo_favor_centavos).toBe(0);

      catalogos.guardarSnapshot({
        clientes: [{ ...snapshotDePrueba().clientes![0]!, saldo_favor_centavos: 4550 }],
      });
      expect(catalogos.obtenerCliente('cli-1')?.saldo_favor_centavos).toBe(4550);
    });
```

En `apps/tablet/src/sincronizacion/motor.spec.ts`, reemplaza:

```ts
import { crearMotorSincronizacion, type FuenteOperaciones } from './motor';
```

por:

```ts
import { aSnapshot, crearMotorSincronizacion, type FuenteOperaciones } from './motor';
```

Reemplaza:

```ts
import type { OperacionSaliente, RespuestaPull, RespuestaPush } from './contrato';
```

por:

```ts
import type {
  ClientePull,
  NotaPendientePull,
  OperacionSaliente,
  RespuestaPull,
  RespuestaPush,
} from './contrato';
```

Reemplaza el cuerpo de `respuestaPullSnapshot` — desde:

```ts
function respuestaPullSnapshot() {
  const r = respuestaPullDePrueba();
  return {
```

hasta el `}` que cierra la función (la línea `notas: r.notas_pendientes,` seguida de `  };` y `}`) — por:

```ts
function respuestaPullSnapshot() {
  // T-20: la conversion de abonos a abonos_json vive en aSnapshot; se reusa.
  return aSnapshot(respuestaPullDePrueba());
}

describe('aSnapshot (T-20)', () => {
  it('guarda los abonos como JSON y tolera un servidor anterior a T-20', () => {
    const respuesta = respuestaPullDePrueba();
    expect(aSnapshot(respuesta).notas?.map((n) => n.abonos_json)).toEqual(
      respuesta.notas_pendientes.map((n) => JSON.stringify(n.abonos)),
    );

    // Un servidor viejo no manda `abonos` ni `saldo_favor_centavos`.
    const vieja = JSON.parse(JSON.stringify(respuesta)) as RespuestaPull;
    for (const n of vieja.notas_pendientes) delete (n as Partial<NotaPendientePull>).abonos;
    for (const c of vieja.catalogos.clientes) delete (c as Partial<ClientePull>).saldo_favor_centavos;

    const snapshot = aSnapshot(vieja);
    expect(snapshot.notas?.map((n) => n.abonos_json)).toEqual(['[]', '[]']);
    expect(snapshot.clientes?.map((c) => c.saldo_favor_centavos)).toEqual([0, 0]);
  });
});
```

- [ ] **Step 6: Suite, typecheck y lint**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git status --short
```

Expected: `Tests: 235 passed` (227 + 6 + 1 + 1), 17 suites; typecheck y lint limpios; `git status --short` solo con los diez archivos.

- [ ] **Step 7: Commit**

```bash
git add apps/tablet/src/datos/migraciones/005-cobranzas.ts \
        apps/tablet/src/datos/migraciones/005-cobranzas.spec.ts \
        apps/tablet/src/datos/migraciones/index.ts \
        apps/tablet/src/datos/migraciones/004-ventas.spec.ts \
        apps/tablet/src/datos/tipos.ts \
        apps/tablet/src/datos/repositorios/catalogos.ts \
        apps/tablet/src/datos/repositorios/catalogos.spec.ts \
        apps/tablet/src/sincronizacion/motor.ts \
        apps/tablet/src/sincronizacion/motor.spec.ts \
        apps/tablet/src/datos/pruebas-apoyo.ts
git commit -m "$(cat <<'EOF'
feat(t-20): migracion local 005 de cobranzas y snapshot con abonos y saldo a favor

Tabla cobranza (clave = id, folio unico, monto > 0, metodo del
catalogo), nota_pendiente.abonos_json y cliente.saldo_favor_centavos
(D15). aSnapshot guarda los abonos del pull como JSON y tolera un
servidor anterior a T-20. La prueba de la 004 deja de fijar el total de
migraciones.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 10: Tablet — reparto puro duplicado + validación de la captura

**Modelo:** implementador `haiku` · revisor `sonnet`

**Files:**
- Create: `apps/tablet/src/datos/cobranzas-reglas.ts`
- Test: `apps/tablet/src/datos/cobranzas-reglas.spec.ts`
- Modify: `apps/tablet/src/datos/index.ts`

**Interfaces:**
- Consumes: `AbonoNota`, `FechaISO`, `MetodoPago` de `tipos.ts` (Task 9).
- Produces:
  - `NotaParaReparto`, `Aplicacion`, `Reparto`, `TipoAbono` y `repartirPago(montoCentavos, notaElegidaId, notas)` — **mismo código** que `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts` (Task 2).
  - `const MAX_CENTAVOS_COBRO = 999_999_999_999`
  - `leerMontoCentavos(texto: string): number | null` — `"150"`, `"150.5"`, `"150.50"` → centavos; vacío o ilegible → `null`.
  - `leerAbonos(json: string): AbonoNota[]` — un texto corrupto da `[]`.
  - `interface CapturaCobro { notaFecha: FechaISO | null; montoCentavos: number | null; metodoPago: MetodoPago | null; fechaPago: string; hoy: FechaISO }`
  - `problemasDeCobro(captura: CapturaCobro): string[]` — vacío si se puede grabar.

**Contexto:** duplicación deliberada (ver Global Constraints). `CASOS_REPARTO` y `repartirPago` son copia literal de la Task 2 (el texto de la tabla es idéntico; el revisor lo compara con `diff`). `problemasDeCobro` es el espejo de `normalizarDatosCobranza` más la regla que solo la tablet puede aplicar sin consultar: la fecha de pago no es anterior a la fecha de la nota (D4).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/tablet/src/datos/cobranzas-reglas.spec.ts`:

```ts
import {
  leerAbonos,
  leerMontoCentavos,
  problemasDeCobro,
  repartirPago,
  type CapturaCobro,
  type NotaParaReparto,
  type Reparto,
} from './cobranzas-reglas';

/**
 * CASOS COMPARTIDOS CON EL BACKEND (T-20, D1).
 *
 * Copia literal de la tabla de
 * `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.spec.ts`. Si cambias
 * un caso aqui, cambialo alla en el mismo commit.
 */
const nota = (
  id: string,
  fecha: string,
  folio: string,
  saldoCentavos: number,
  cobrable = true,
): NotaParaReparto => ({ id, fecha, folio, cobrable, saldoCentavos });

interface CasoReparto {
  nombre: string;
  monto: number;
  elegida: string;
  notas: NotaParaReparto[];
  esperado: Reparto;
}

const CASOS_REPARTO: CasoReparto[] = [
  {
    nombre: 'abono parcial a la nota elegida',
    monto: 5000,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 15000)],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 5000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 10000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'liquida exacto',
    monto: 15000,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 15000)],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 15000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'el excedente va a las otras notas, de la mas vieja a la mas nueva',
    monto: 15000,
    elegida: 'B',
    notas: [
      nota('C', '2026-08-03', 'TJ260803AP01', 4000),
      nota('B', '2026-08-05', 'TJ260805AP01', 10000),
      nota('A', '2026-08-01', 'TJ260801AP01', 3000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'A', montoCentavos: 3000, saldoAntesCentavos: 3000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'C', montoCentavos: 2000, saldoAntesCentavos: 4000, saldoDespuesCentavos: 2000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'misma fecha: desempata el folio',
    monto: 3000,
    elegida: 'X',
    notas: [
      nota('X', '2026-08-04', 'TJ260804AP09', 1000),
      nota('N2', '2026-08-01', 'TJ260801AP02', 5000),
      nota('N1', '2026-08-01', 'TJ260801AP01', 5000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'X', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'N1', montoCentavos: 2000, saldoAntesCentavos: 5000, saldoDespuesCentavos: 3000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'lo que sobra de todas las notas queda a favor',
    monto: 5000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 1000),
      nota('B', '2026-08-02', 'TJ260802AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'B', montoCentavos: 2000, saldoAntesCentavos: 2000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 2000,
    },
  },
  {
    nombre: 'nota elegida que ya no se puede cobrar: todo pasa a excedente (D9)',
    monto: 2000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 0, false),
      nota('B', '2026-08-02', 'TJ260802AP01', 3000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 2000, saldoAntesCentavos: 3000, saldoDespuesCentavos: 1000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'las otras notas que no se pueden cobrar se saltan aunque tengan saldo',
    monto: 2500,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-05', 'TJ260805AP01', 1000),
      nota('B', '2026-08-01', 'TJ260801AP01', 5000, false),
      nota('C', '2026-08-02', 'TJ260802AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'C', montoCentavos: 1500, saldoAntesCentavos: 2000, saldoDespuesCentavos: 500, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'sin otras notas, el excedente queda a favor',
    monto: 1500,
    elegida: 'A',
    notas: [nota('A', '2026-08-01', 'TJ260801AP01', 1000)],
    esperado: {
      aplicaciones: [
        { notaId: 'A', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 500,
    },
  },
  {
    nombre: 'una nota con saldo 0 no recibe nada',
    monto: 1000,
    elegida: 'A',
    notas: [
      nota('A', '2026-08-01', 'TJ260801AP01', 0),
      nota('B', '2026-08-02', 'TJ260802AP01', 1000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'la elegida va primero aunque sea la mas nueva',
    monto: 3000,
    elegida: 'N',
    notas: [
      nota('V', '2026-08-01', 'TJ260801AP01', 2000),
      nota('N', '2026-08-09', 'TJ260809AP01', 2000),
    ],
    esperado: {
      aplicaciones: [
        { notaId: 'N', montoCentavos: 2000, saldoAntesCentavos: 2000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'V', montoCentavos: 1000, saldoAntesCentavos: 2000, saldoDespuesCentavos: 1000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    },
  },
  {
    nombre: 'una nota elegida que no esta en la lista: todo es excedente',
    monto: 1000,
    elegida: 'Z',
    notas: [nota('B', '2026-08-02', 'TJ260802AP01', 1000)],
    esperado: {
      aplicaciones: [
        { notaId: 'B', montoCentavos: 1000, saldoAntesCentavos: 1000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
      ],
      saldoFavorCentavos: 0,
    },
  },
];

describe('repartirPago (duplicada del backend, D1)', () => {
  it.each(CASOS_REPARTO)('$nombre', ({ monto, elegida, notas, esperado }) => {
    expect(repartirPago(monto, elegida, notas)).toEqual(esperado);
  });

  it('no reordena ni modifica la lista que recibe', () => {
    const notas = [
      nota('C', '2026-08-03', 'TJ260803AP01', 4000),
      nota('B', '2026-08-05', 'TJ260805AP01', 10000),
    ];
    const copia = notas.map((n) => ({ ...n }));
    repartirPago(12000, 'B', notas);
    expect(notas).toEqual(copia);
  });

  it.each([0, -100, 15.5, Number.NaN])(
    'un monto de %p no es un pago: es un bug de quien llama',
    (monto) => {
      expect(() =>
        repartirPago(monto, 'A', [nota('A', '2026-08-01', 'TJ260801AP01', 1000)]),
      ).toThrow(Error);
    },
  );
});

describe('leerMontoCentavos', () => {
  it.each<[string, number | null]>([
    ['150', 15000],
    ['150.5', 15050],
    ['150.50', 15050],
    ['0.01', 1],
    ['', null],
    ['1,50', null],
    ['abc', null],
    ['1.234', null],
    ['-5', null],
  ])('%p son %p centavos', (texto, esperado) => {
    expect(leerMontoCentavos(texto)).toBe(esperado);
  });
});

describe('leerAbonos', () => {
  it('lee los abonos guardados', () => {
    expect(
      leerAbonos('[{"fecha_pago":"2026-08-03","monto_centavos":10000,"metodo_pago":"efectivo"}]'),
    ).toEqual([{ fecha_pago: '2026-08-03', monto_centavos: 10000, metodo_pago: 'efectivo' }]);
  });

  it('una nota sin abonos da lista vacia', () => {
    expect(leerAbonos('[]')).toEqual([]);
  });

  it('un texto corrupto no revienta la pantalla: da lista vacia', () => {
    expect(leerAbonos('no es json')).toEqual([]);
  });
});

describe('problemasDeCobro (D4, D14)', () => {
  const captura = (extra: Partial<CapturaCobro> = {}): CapturaCobro => ({
    notaFecha: '2026-08-01',
    montoCentavos: 5000,
    metodoPago: 'efectivo',
    fechaPago: '2026-08-05',
    hoy: '2026-08-07',
    ...extra,
  });

  it('una captura completa se puede grabar', () => {
    expect(problemasDeCobro(captura())).toEqual([]);
  });

  it('sin nota elegida', () => {
    expect(problemasDeCobro(captura({ notaFecha: null }))).toEqual(['Elige la nota que paga.']);
  });

  it('sin monto legible', () => {
    expect(problemasDeCobro(captura({ montoCentavos: null }))).toEqual([
      'Captura el monto cobrado, mayor que $0.00.',
    ]);
  });

  it('un monto de $0', () => {
    expect(problemasDeCobro(captura({ montoCentavos: 0 }))).toEqual([
      'Captura el monto cobrado, mayor que $0.00.',
    ]);
  });

  it('un monto que no cabe', () => {
    expect(problemasDeCobro(captura({ montoCentavos: 1_000_000_000_000 }))).toEqual([
      'El monto es demasiado grande.',
    ]);
  });

  it('sin metodo de pago', () => {
    expect(problemasDeCobro(captura({ metodoPago: null }))).toEqual(['Elige el método de pago.']);
  });

  it('una fecha de pago ilegible', () => {
    expect(problemasDeCobro(captura({ fechaPago: '2026-02-30' }))).toEqual([
      'La fecha de pago tiene que ser una fecha AAAA-MM-DD que exista.',
    ]);
  });

  it('una fecha de pago posterior a hoy', () => {
    expect(problemasDeCobro(captura({ fechaPago: '2026-08-08' }))).toEqual([
      'La fecha de pago no puede ser posterior a hoy.',
    ]);
  });

  it('una fecha de pago anterior a la nota', () => {
    expect(problemasDeCobro(captura({ fechaPago: '2026-07-31' }))).toEqual([
      'La fecha de pago no puede ser anterior a la fecha de la nota.',
    ]);
  });

  it('la fecha de pago puede ser la de la nota o la de hoy', () => {
    expect(problemasDeCobro(captura({ fechaPago: '2026-08-01' }))).toEqual([]);
    expect(problemasDeCobro(captura({ fechaPago: '2026-08-07' }))).toEqual([]);
  });
});
```

Run: `npm test --workspace=apps/tablet -- cobranzas-reglas`
Expected: FAIL con `Cannot find module './cobranzas-reglas'`.

- [ ] **Step 2: Implementar**

Crea `apps/tablet/src/datos/cobranzas-reglas.ts`:

```ts
import type { AbonoNota, FechaISO, MetodoPago } from './tipos';

/**
 * Reglas de la cobranza (T-20), sin SQLite ni React.
 *
 * > [!warning] `repartirPago` esta duplicada a proposito
 * > Es copia de `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts`
 * > (la tablet no puede importar del backend: Metro), con la misma tabla de
 * > casos de prueba. La tablet reparte al grabar para descontar el saldo sin
 * > red; el servidor vuelve a repartir al proyectar. Si divergen, el saldo local
 * > parpadea hasta el pull. Si cambias una, cambia la otra en el mismo commit.
 *
 * `problemasDeCobro` la usan la pantalla (avisos antes de revisar) y el
 * repositorio (que vuelve a validar antes de grabar).
 */

/** `numeric(12,2)` en centavos: lo que el servidor acepta en `monto_centavos`. */
export const MAX_CENTAVOS_COBRO = 999_999_999_999;

export type TipoAbono = 'cobranza' | 'abono';

/** Una nota del cliente tal como la ve el reparto. */
export interface NotaParaReparto {
  id: string;
  /** `AAAA-MM-DD`: el orden del excedente es por fecha y luego por folio. */
  fecha: string;
  folio: string;
  /** Solo `pendiente`/`abonado` y viva (D8, D9). */
  cobrable: boolean;
  saldoCentavos: number;
}

/** Lo que el pago deja en una nota. */
export interface Aplicacion {
  notaId: string;
  montoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  /** `cobranza` si la deja en 0; `abono` si no (D8). */
  tipo: TipoAbono;
  status: 'pagada' | 'abonado';
}

export interface Reparto {
  /** En orden: la elegida primero y despues las demas por fecha y folio. */
  aplicaciones: Aplicacion[];
  /** Lo que no cupo en ninguna nota (D1 paso 3). */
  saldoFavorCentavos: number;
}

function porFechaYFolio(a: NotaParaReparto, b: NotaParaReparto): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  // El id solo desempata para que el orden sea determinista.
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Reparte un pago (D1): primero la nota elegida hasta su saldo, despues las
 * otras notas cobrables del cliente de la mas vieja a la mas nueva (`fecha`,
 * luego `folio`), y lo que sobre queda como saldo a favor.
 *
 * @throws {Error} si `montoCentavos` no es un entero positivo.
 */
export function repartirPago(
  montoCentavos: number,
  notaElegidaId: string,
  notas: readonly NotaParaReparto[],
): Reparto {
  if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) {
    throw new Error(
      `repartirPago necesita un entero positivo de centavos, no ${montoCentavos}.`,
    );
  }

  const elegida = notas.find((n) => n.id === notaElegidaId);
  const otras = notas
    .filter((n) => n.id !== notaElegidaId)
    .sort(porFechaYFolio);
  const orden = elegida ? [elegida, ...otras] : otras;

  const aplicaciones: Aplicacion[] = [];
  let restante = montoCentavos;

  for (const n of orden) {
    if (restante === 0) break;
    if (!n.cobrable || n.saldoCentavos <= 0) continue;

    const monto = Math.min(restante, n.saldoCentavos);
    const despues = n.saldoCentavos - monto;
    aplicaciones.push({
      notaId: n.id,
      montoCentavos: monto,
      saldoAntesCentavos: n.saldoCentavos,
      saldoDespuesCentavos: despues,
      tipo: despues === 0 ? 'cobranza' : 'abono',
      status: despues === 0 ? 'pagada' : 'abonado',
    });
    restante -= monto;
  }

  return { aplicaciones, saldoFavorCentavos: restante };
}

/**
 * Texto del campo de monto a centavos, **sin coma flotante**.
 *
 * Solo digitos con punto y hasta 2 decimales: `150`, `150.5`, `150.50`. Una
 * coma, un signo o un tercer decimal son `null` — un "1,50" no puede volverse
 * $150 ni $1.50 en silencio.
 */
export function leerMontoCentavos(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros = '0', decimales = ''] = limpio.split('.');
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Los abonos guardados en `nota_pendiente.abonos_json`. Un texto corrupto da `[]`. */
export function leerAbonos(json: string): AbonoNota[] {
  try {
    const valor: unknown = JSON.parse(json);
    return Array.isArray(valor) ? (valor as AbonoNota[]) : [];
  } catch {
    return [];
  }
}

export interface CapturaCobro {
  /** Fecha de la nota elegida, o `null` si aun no eligio. */
  notaFecha: FechaISO | null;
  /** De `leerMontoCentavos`: `null` si el texto no se entiende. */
  montoCentavos: number | null;
  metodoPago: MetodoPago | null;
  /** Tal cual la escribio, `AAAA-MM-DD`. */
  fechaPago: string;
  /** `reloj.hoy()` de la tablet. */
  hoy: FechaISO;
}

function esFechaReal(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [anio = 0, mes = 0, dia = 0] = texto.split('-').map(Number);
  // Solo comprueba el calendario (un 30 de febrero se desborda); no deriva
  // ningun dia de trabajo de UTC.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/**
 * Lo que impide grabar el cobro, en el espanol del vendedor. Vacio: se puede.
 *
 * Espejo de `normalizarDatosCobranza` del servidor, mas la regla que solo la
 * tablet aplica sin consultar: la fecha de pago va de la fecha de la nota a hoy
 * (D4).
 */
export function problemasDeCobro(captura: CapturaCobro): string[] {
  const problemas: string[] = [];

  if (captura.notaFecha === null) {
    problemas.push('Elige la nota que paga.');
  }

  const monto = captura.montoCentavos;
  if (monto === null || !Number.isInteger(monto) || monto <= 0) {
    problemas.push('Captura el monto cobrado, mayor que $0.00.');
  } else if (monto > MAX_CENTAVOS_COBRO) {
    problemas.push('El monto es demasiado grande.');
  }

  if (captura.metodoPago === null) {
    problemas.push('Elige el método de pago.');
  }

  const fechaPago = captura.fechaPago.trim();
  if (!esFechaReal(fechaPago)) {
    problemas.push('La fecha de pago tiene que ser una fecha AAAA-MM-DD que exista.');
  } else if (fechaPago > captura.hoy) {
    problemas.push('La fecha de pago no puede ser posterior a hoy.');
  } else if (captura.notaFecha !== null && fechaPago < captura.notaFecha) {
    problemas.push('La fecha de pago no puede ser anterior a la fecha de la nota.');
  }

  return problemas;
}
```

- [ ] **Step 3: Exportar desde la capa de datos**

En `apps/tablet/src/datos/index.ts`, reemplaza:

```ts
export * from './tipos';
```

por:

```ts
export {
  leerAbonos,
  leerMontoCentavos,
  MAX_CENTAVOS_COBRO,
  problemasDeCobro,
  repartirPago,
} from './cobranzas-reglas';
export type {
  Aplicacion,
  CapturaCobro,
  NotaParaReparto,
  Reparto,
  TipoAbono,
} from './cobranzas-reglas';
export * from './tipos';
```

- [ ] **Step 4: Correr las pruebas y verlas pasar**

Run: `npm test --workspace=apps/tablet -- cobranzas-reglas`
Expected: PASS, **38** pruebas (11 + 1 + 4 · 9 · 3 · 10).

- [ ] **Step 5: Suite, typecheck y lint**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
git status --short
```

Expected: `Tests: 273 passed` (235 + 38), 18 suites; typecheck y lint limpios; `git status --short` solo con los tres archivos.

- [ ] **Step 6: Commit**

```bash
git add apps/tablet/src/datos/cobranzas-reglas.ts \
        apps/tablet/src/datos/cobranzas-reglas.spec.ts \
        apps/tablet/src/datos/index.ts
git commit -m "$(cat <<'EOF'
feat(t-20): reparto y validacion del cobro en la tablet

repartirPago duplicada del backend con la misma tabla CASOS_REPARTO
(D1), lectura del monto sin coma flotante, lectura tolerante de los
abonos guardados y problemasDeCobro: nota elegida, monto entero > 0 y
<= tope, metodo y fecha de pago entre la nota y hoy (D4, D14).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 11: Tablet — repositorio de cobranzas + `publicarCambio` + capa de datos

**Modelo:** implementador `sonnet` · revisor `sonnet`

**Files:**
- Create: `apps/tablet/src/datos/repositorios/cobranzas.ts`
- Test: `apps/tablet/src/datos/repositorios/cobranzas.spec.ts`
- Modify: `apps/tablet/src/datos/repositorios/catalogos.ts` (`publicarCambio`)
- Modify: `apps/tablet/src/datos/repositorios/catalogos.spec.ts`
- Modify: `apps/tablet/src/datos/inicializar.ts`
- Modify: `apps/tablet/src/datos/index.ts`

**Interfaces:**
- Consumes: `repartirPago`, `problemasDeCobro`, `leerAbonos`, `Reparto` (Task 10); `Cobranza`, `MetodoPago`, `AbonoNota` (Task 9); `RepositorioCatalogos.obtenerCliente/notasPendientesDe`; `RepositorioFolios.emitir` (T-14); `enTransaccion`.
- Produces:
  - `class ErrorCobranza extends Error`
  - `interface DatosRegistroCobranza { vendedorId: string; clienteId: string; ventaNotaId: string; montoCentavos: number; metodoPago: MetodoPago; fechaPago: string }`
  - `type RepositorioCobranzas = ReturnType<typeof crearRepositorioCobranzas>`
  - `crearRepositorioCobranzas(deps, { catalogos, folios })` con `previsualizar(clienteId, ventaNotaId, montoCentavos): Reparto`, `registrar(datos): Cobranza`, `porId(id): Cobranza | null`, `delDia(clienteId, fecha?): Cobranza[]`, `pendientesDeSincronizar(): Cobranza[]`, `marcarSincronizada(id): void`, `marcarError(id, motivo): void`
  - `RepositorioCatalogos.publicarCambio(): void` — sube la versión y avisa a los oyentes.
  - `CapaDatos.cobranzas: RepositorioCobranzas`

**Contexto:**
- `registrar` valida **antes** de abrir la transacción; dentro emite el folio (`savepoint`), inserta el cobro y aplica el reparto local con la misma función que el servidor (D15): descuenta `saldo_centavos`, deja `status = 'abonado'`, pone `activo = 0` si el saldo llega a 0, agrega el abono a `abonos_json` y suma el excedente a `cliente.saldo_favor_centavos`. Cualquier fallo revierte todo, incluido el contador de folios.
- Localmente todas las notas activas son cobrables (`activo = 1` ya es `pendiente`/`abonado` vivo).
- **`publicarCambio`:** grabar un cobro cambia `nota_pendiente` y `cliente`, que las pantallas leen con `versionCatalogos`. Sin avisar, la ficha y la venta seguirían mostrando el saldo viejo (el defecto del 2026-08-23). Se avisa **después** del `commit`, igual que `guardarSnapshot`.

- [ ] **Step 1: `publicarCambio` en catálogos — prueba que falla**

En `apps/tablet/src/datos/repositorios/catalogos.spec.ts`, reemplaza:

```ts
    it('guarda los abonos de cada nota y el saldo a favor del cliente (T-20)', () => {
```

por:

```ts
    it('publicarCambio sube la version y avisa, para quien escribe fuera del snapshot (T-20)', () => {
      const { catalogos } = conCatalogos();
      const antes = catalogos.version();
      let avisos = 0;
      const dejar = catalogos.suscribir(() => {
        avisos += 1;
      });

      catalogos.publicarCambio();

      expect(catalogos.version()).toBe(antes + 1);
      expect(avisos).toBe(1);
      dejar();
    });

    it('guarda los abonos de cada nota y el saldo a favor del cliente (T-20)', () => {
```

Run: `npm test --workspace=apps/tablet -- catalogos`
Expected: FAIL (ts-jest: `publicarCambio` no existe).

- [ ] **Step 2: `publicarCambio` en catálogos**

En `apps/tablet/src/datos/repositorios/catalogos.ts`, reemplaza:

```ts
  let version = 0;
  const oyentes = new Set<() => void>();

  return {
```

por:

```ts
  let version = 0;
  const oyentes = new Set<() => void>();

  /**
   * Publica la novedad. **Fuera de la transaccion, no dentro**: quien escucha
   * vuelve a consultar en cuanto le avisan, y desde dentro leeria un estado a
   * medio escribir. Sobre una copia del conjunto porque un oyente puede darse de
   * baja mientras se le avisa.
   */
  function avisar(): void {
    version += 1;
    for (const oyente of [...oyentes]) oyente();
  }

  return {
```

Reemplaza:

```ts
      if (filasEscritas === 0) return;

      // **Fuera de la transaccion, no dentro.** Quien escucha va a volver a
      // consultar en cuanto le avisen, y desde dentro leeria un estado a medio
      // escribir. Sobre una copia del conjunto porque un oyente puede darse de
      // baja mientras se le avisa (una pantalla que se desmonta al repintar).
      version += 1;
      for (const oyente of [...oyentes]) oyente();
    },
```

por:

```ts
      if (filasEscritas === 0) return;

      avisar();
    },

    /**
     * Avisa que cambio algo que las pantallas leen del catalogo, cuando lo
     * escribio otro repositorio (T-20: un cobro descuenta `nota_pendiente` y
     * suma al saldo a favor del cliente). Se llama despues del `commit`.
     */
    publicarCambio(): void {
      avisar();
    },
```

Run: `npm test --workspace=apps/tablet -- catalogos`
Expected: PASS.

- [ ] **Step 3: Pruebas que fallan del repositorio**

Crea `apps/tablet/src/datos/repositorios/cobranzas.spec.ts`:

```ts
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import {
  crearRepositorioCobranzas,
  ErrorCobranza,
  type DatosRegistroCobranza,
} from './cobranzas';
import type { DepsRepositorio } from './deps';
import { crearRepositorioFolios, ErrorFolio } from './folios';
import { crearRepositorioVentas } from './ventas';

/**
 * Cobranza en la tablet (T-20).
 *
 * Catalogo de prueba: cli-1 con nota-1 (2026-08-01, saldo 15000, un abono
 * previo) y nota-2 (2026-08-02, saldo 10000). Hoy es 2026-08-07.
 */

function montar(opciones: { sinSegmento?: boolean } = {}) {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  const snapshot = snapshotDePrueba();
  if (opciones.sinSegmento) {
    snapshot.vendedores = (snapshot.vendedores ?? []).map((v) => ({
      ...v,
      folio_segmento: null,
    }));
  }
  catalogos.guardarSnapshot(snapshot);
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    catalogos,
    folios,
    cobranzas: crearRepositorioCobranzas(deps, { catalogos, folios }),
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
  };
}

const cobro = (extra: Partial<DatosRegistroCobranza> = {}): DatosRegistroCobranza => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  ventaNotaId: 'nota-1',
  montoCentavos: 5000,
  metodoPago: 'efectivo',
  fechaPago: '2026-08-07',
  ...extra,
});

const cuantas = (deps: DepsRepositorio, tabla: 'cobranza' | 'folio_emitido') =>
  deps.bd.getFirstSync<{ n: number }>(`select count(*) as n from ${tabla}`)?.n;

const nota = (deps: DepsRepositorio, id: string) =>
  deps.bd.getFirstSync<{ saldo_centavos: number; status: string; activo: number; abonos_json: string }>(
    'select saldo_centavos, status, activo, abonos_json from nota_pendiente where id = $id',
    { $id: id },
  );

describe('repositorio de cobranzas (T-20)', () => {
  it('graba el cobro con el folio del dia y lo deja pendiente de subir', () => {
    const { deps, cobranzas } = montar();
    const c = cobranzas.registrar(cobro({ metodoPago: 'transferencia', fechaPago: '2026-08-05' }));

    expect(c).toEqual({
      id: 'id-1',
      fecha: '2026-08-07',
      cliente_id: 'cli-1',
      vendedor_id: 'ven-1',
      sucursal_id: 'suc-tj',
      folio: 'TJ260807AP01',
      venta_nota_id: 'nota-1',
      monto_centavos: 5000,
      metodo_pago: 'transferencia',
      fecha_pago: '2026-08-05',
      grabada_en: '2026-08-07T15:00:00.000Z',
      sync_estado: 'pendiente',
      sync_error: null,
      sincronizado_en: null,
    });
    expect(cuantas(deps, 'folio_emitido')).toBe(1);
  });

  it('un abono parcial descuenta el saldo local y agrega el abono a la nota', () => {
    const { deps, cobranzas } = montar();
    cobranzas.registrar(cobro());

    const n = nota(deps, 'nota-1');
    expect(n).toMatchObject({ saldo_centavos: 10000, status: 'abonado', activo: 1 });
    expect(JSON.parse(n!.abonos_json)).toEqual([
      { fecha_pago: '2026-08-03', monto_centavos: 10000, metodo_pago: 'efectivo' },
      { fecha_pago: '2026-08-07', monto_centavos: 5000, metodo_pago: 'efectivo' },
    ]);
  });

  it('liquidar saca la nota de las pendientes (activo 0)', () => {
    const { deps, catalogos, cobranzas } = montar();
    cobranzas.registrar(cobro({ montoCentavos: 15000 }));

    expect(nota(deps, 'nota-1')).toMatchObject({ saldo_centavos: 0, activo: 0 });
    expect(catalogos.notasPendientesDe('cli-1').map((x) => x.id)).toEqual(['nota-2']);
  });

  it('el excedente va a la otra nota y lo que sobra al saldo a favor del cliente', () => {
    const { deps, catalogos, cobranzas } = montar();
    cobranzas.registrar(cobro({ montoCentavos: 30000 }));

    expect(nota(deps, 'nota-1')).toMatchObject({ saldo_centavos: 0, activo: 0 });
    expect(nota(deps, 'nota-2')).toMatchObject({ saldo_centavos: 0, activo: 0 });
    expect(catalogos.obtenerCliente('cli-1')?.saldo_favor_centavos).toBe(5000);
  });

  it('previsualizar da el reparto de registrar sin escribir nada', () => {
    const { deps, cobranzas } = montar();
    expect(cobranzas.previsualizar('cli-1', 'nota-2', 12000)).toEqual({
      aplicaciones: [
        { notaId: 'nota-2', montoCentavos: 10000, saldoAntesCentavos: 10000, saldoDespuesCentavos: 0, tipo: 'cobranza', status: 'pagada' },
        { notaId: 'nota-1', montoCentavos: 2000, saldoAntesCentavos: 15000, saldoDespuesCentavos: 13000, tipo: 'abono', status: 'abonado' },
      ],
      saldoFavorCentavos: 0,
    });
    expect(cuantas(deps, 'cobranza')).toBe(0);
    expect(nota(deps, 'nota-2')?.saldo_centavos).toBe(10000);
  });

  it('si el folio no se puede emitir no queda ni cobro ni saldo descontado', () => {
    const { deps, cobranzas } = montar({ sinSegmento: true });
    expect(() => cobranzas.registrar(cobro())).toThrow(ErrorFolio);
    expect(cuantas(deps, 'cobranza')).toBe(0);
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
    expect(nota(deps, 'nota-1')?.saldo_centavos).toBe(15000);
  });

  it('un monto de $0 se rechaza antes de emitir folio', () => {
    const { deps, cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ montoCentavos: 0 }))).toThrow(ErrorCobranza);
    expect(cuantas(deps, 'folio_emitido')).toBe(0);
  });

  it('una fecha de pago anterior a la nota se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ fechaPago: '2026-07-31' }))).toThrow(
      'La fecha de pago no puede ser anterior a la fecha de la nota.',
    );
  });

  it('una nota que no es del cliente o ya no esta pendiente se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ ventaNotaId: 'nota-x' }))).toThrow(ErrorCobranza);
    expect(() => cobranzas.registrar(cobro({ clienteId: 'cli-2' }))).toThrow(ErrorCobranza);
  });

  it('un cliente fuera del catalogo se rechaza', () => {
    const { cobranzas } = montar();
    expect(() => cobranzas.registrar(cobro({ clienteId: 'cli-x' }))).toThrow(ErrorCobranza);
  });

  it('avisa a las pantallas que el catalogo cambio', () => {
    const { catalogos, cobranzas } = montar();
    const antes = catalogos.version();
    cobranzas.registrar(cobro());
    expect(catalogos.version()).toBe(antes + 1);
  });

  it('delDia devuelve los cobros del cliente de hoy, en el orden en que se grabaron', () => {
    const { cobranzas } = montar();
    const a = cobranzas.registrar(cobro());
    const b = cobranzas.registrar(cobro({ ventaNotaId: 'nota-2', montoCentavos: 1000 }));
    expect(cobranzas.delDia('cli-1').map((c) => c.id)).toEqual([a.id, b.id]);
    expect(cobranzas.delDia('cli-1', '2026-08-06')).toEqual([]);
  });

  it('un cobro rechazado sigue en la cola con su motivo; uno aceptado sale', () => {
    const { cobranzas } = montar();
    const c = cobranzas.registrar(cobro());

    cobranzas.marcarError(c.id, 'nota-no-encontrada: la nota no existe');
    expect(cobranzas.pendientesDeSincronizar()).toHaveLength(1);
    expect(cobranzas.porId(c.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'nota-no-encontrada: la nota no existe',
    });

    cobranzas.marcarSincronizada(c.id);
    expect(cobranzas.pendientesDeSincronizar()).toEqual([]);
    expect(cobranzas.porId(c.id)).toMatchObject({
      sync_estado: 'sincronizado',
      sync_error: null,
      sincronizado_en: '2026-08-07T15:00:00.000Z',
    });
  });

  it('ventas y cobros comparten el contador de folios del dia', () => {
    const { ventas, cobranzas } = montar();
    const v = ventas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      numNota: '2346',
      contadoCredito: 'credito',
      factura: 'N/A',
      comentarios: null,
      lineas: [{ presentacionId: 'pre-1', cantidad: 1, cantidadPromocion: 0 }],
    });
    const c = cobranzas.registrar(cobro());
    expect(v.folio).toBe('TJ260807AP01');
    expect(c.folio).toBe('TJ260807AP02');
  });
});
```

Run: `npm test --workspace=apps/tablet -- repositorios/cobranzas`
Expected: FAIL con `Cannot find module './cobranzas'`.

- [ ] **Step 4: Implementar el repositorio**

Crea `apps/tablet/src/datos/repositorios/cobranzas.ts`:

```ts
import { leerAbonos, problemasDeCobro, repartirPago, type Reparto } from '../cobranzas-reglas';
import type { AbonoNota, Cobranza, FechaISO, MetodoPago } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';
import { enTransaccion } from './deps';
import type { RepositorioFolios } from './folios';

/** Error de regla de negocio del cobro (no un fallo tecnico de SQLite). */
export class ErrorCobranza extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCobranza';
  }
}

/** Lo que captura la pantalla. */
export interface DatosRegistroCobranza {
  vendedorId: string;
  clienteId: string;
  /** La nota pendiente que eligio el vendedor. */
  ventaNotaId: string;
  montoCentavos: number;
  metodoPago: MetodoPago;
  /** `AAAA-MM-DD`. */
  fechaPago: string;
}

export type RepositorioCobranzas = ReturnType<typeof crearRepositorioCobranzas>;

/**
 * La cobranza en ruta (T-20): grabar con folio y reparto local, consultar y la
 * cola del push.
 *
 * Recibe `catalogos` y `folios` ya creados, como las ventas: `folios` es la
 * misma instancia de toda la capa (el contador del dia es compartido) y
 * `catalogos` es quien publica la version que observan las pantallas.
 */
export function crearRepositorioCobranzas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos, folios }: { catalogos: RepositorioCatalogos; folios: RepositorioFolios },
) {
  /** Las notas activas del cliente, como las ve el reparto: todas cobrables. */
  function notasParaReparto(clienteId: string) {
    return catalogos.notasPendientesDe(clienteId).map((n) => ({
      id: n.id,
      fecha: n.fecha,
      folio: n.folio,
      cobrable: true,
      saldoCentavos: n.saldo_centavos,
    }));
  }

  const repo = {
    /**
     * El reparto que hara `registrar`, sin escribir nada. Lo muestra la
     * pantalla en la revision (D16).
     */
    previsualizar(clienteId: string, ventaNotaId: string, montoCentavos: number): Reparto {
      return repartirPago(montoCentavos, ventaNotaId, notasParaReparto(clienteId));
    },

    /**
     * Graba un cobro, le emite su folio y aplica el reparto local, en **una
     * sola transaccion** (D15).
     *
     * Todo lo que puede fallar por una regla se comprueba ANTES de abrir la
     * transaccion. Lo que falla dentro (sin segmento, 99 operaciones del dia,
     * SQLite) hace `rollback` de todo, incluido el contador de folios.
     *
     * @throws {ErrorCobranza} si la captura no se puede grabar.
     * @throws {ErrorFolio} si el vendedor no tiene segmento o llego al tope del dia.
     */
    registrar(datos: DatosRegistroCobranza): Cobranza {
      const hoy = reloj.hoy();

      const cliente = catalogos.obtenerCliente(datos.clienteId);
      if (!cliente || cliente.activo !== 1) {
        throw new ErrorCobranza(
          'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de cobrarle.',
        );
      }

      const nota = catalogos
        .notasPendientesDe(datos.clienteId)
        .find((n) => n.id === datos.ventaNotaId);
      if (!nota) {
        throw new ErrorCobranza(
          'Esa nota ya no está pendiente para este cliente. Sincroniza y vuelve a intentarlo.',
        );
      }

      const problemas = problemasDeCobro({
        notaFecha: nota.fecha,
        montoCentavos: datos.montoCentavos,
        metodoPago: datos.metodoPago,
        fechaPago: datos.fechaPago,
        hoy,
      });
      if (problemas.length > 0) {
        throw new ErrorCobranza(problemas.join(' '));
      }

      const fechaPago = datos.fechaPago.trim();
      const reparto = repartirPago(datos.montoCentavos, datos.ventaNotaId, notasParaReparto(datos.clienteId));
      const id = generarId();
      const ahora = reloj.ahora();

      enTransaccion(bd, () => {
        const emitido = folios.emitir({ vendedorId: datos.vendedorId, claveOperacion: id });

        bd.runSync(
          `insert into cobranza (
             id, fecha, cliente_id, vendedor_id, sucursal_id, folio, venta_nota_id,
             monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado
           ) values (
             $id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $folio, $venta_nota_id,
             $monto_centavos, $metodo_pago, $fecha_pago, $grabada_en, 'pendiente'
           )`,
          {
            $id: id,
            // La fecha del folio: el servidor rechaza un folio cuya fecha no
            // coincide con `fecha_operacion`.
            $fecha: emitido.fecha,
            $cliente_id: datos.clienteId,
            $vendedor_id: datos.vendedorId,
            $sucursal_id: emitido.sucursal_id,
            $folio: emitido.folio,
            $venta_nota_id: datos.ventaNotaId,
            $monto_centavos: datos.montoCentavos,
            $metodo_pago: datos.metodoPago,
            $fecha_pago: fechaPago,
            $grabada_en: ahora,
          },
        );

        // Reparto local (D15): el siguiente pull lo pisa con la verdad del servidor.
        for (const a of reparto.aplicaciones) {
          const actual = bd.getFirstSync<{ abonos_json: string }>(
            'select abonos_json from nota_pendiente where id = $id',
            { $id: a.notaId },
          );
          const abonos: AbonoNota[] = [
            ...leerAbonos(actual?.abonos_json ?? '[]'),
            { fecha_pago: fechaPago, monto_centavos: a.montoCentavos, metodo_pago: datos.metodoPago },
          ];
          bd.runSync(
            `update nota_pendiente set
               saldo_centavos = $saldo,
               -- El CHECK local solo admite pendiente/abonado: una nota en 0
               -- se retira con activo = 0, no con 'pagada'.
               status = 'abonado',
               activo = $activo,
               abonos_json = $abonos_json
             where id = $id`,
            {
              $saldo: a.saldoDespuesCentavos,
              $activo: a.saldoDespuesCentavos === 0 ? 0 : 1,
              $abonos_json: JSON.stringify(abonos),
              $id: a.notaId,
            },
          );
        }

        if (reparto.saldoFavorCentavos > 0) {
          bd.runSync(
            `update cliente set saldo_favor_centavos = saldo_favor_centavos + $monto where id = $id`,
            { $monto: reparto.saldoFavorCentavos, $id: datos.clienteId },
          );
        }
      });

      // Despues del commit: la ficha y la venta releen notas y saldo a favor.
      catalogos.publicarCambio();

      const grabada = repo.porId(id);
      if (!grabada) throw new ErrorCobranza('No se pudo leer el cobro recién grabado.');
      return grabada;
    },

    porId(id: string): Cobranza | null {
      return bd.getFirstSync<Cobranza>('select * from cobranza where id = $id', { $id: id });
    },

    /** Cobros de un cliente en un dia, en el orden en que se grabaron ("Cobros de hoy", D16). */
    delDia(clienteId: string, fecha: FechaISO = reloj.hoy()): Cobranza[] {
      return bd.getAllSync<Cobranza>(
        `select * from cobranza
          where cliente_id = $cliente_id and fecha = $fecha
          order by grabada_en, rowid`,
        { $cliente_id: clienteId, $fecha: fecha },
      );
    },

    /**
     * Cobros que faltan por subir, incluidos los rechazados (patron D19 de
     * T-16): un `nota-no-encontrada` sobre una venta que aun no subio se
     * recupera solo cuando la venta entra. Reenviar es seguro: la clave no cambia.
     */
    pendientesDeSincronizar(): Cobranza[] {
      return bd.getAllSync<Cobranza>(
        `select * from cobranza
          where sync_estado in ('pendiente', 'error')
          order by fecha, grabada_en, rowid`,
      );
    },

    /** Marca un cobro como subido y limpia el error de un intento previo. */
    marcarSincronizada(id: string): void {
      bd.runSync(
        `update cobranza set
           sync_estado = 'sincronizado',
           sincronizado_en = $sincronizado_en,
           sync_error = null
         where id = $id`,
        { $sincronizado_en: reloj.ahora(), $id: id },
      );
    },

    /** El servidor lo rechazo: se guarda el motivo para mostrarlo. */
    marcarError(id: string, motivo: string): void {
      bd.runSync(`update cobranza set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
  };

  return repo;
}
```

- [ ] **Step 5: Capa de datos**

En `apps/tablet/src/datos/inicializar.ts`, reemplaza:

```ts
import { crearRepositorioCatalogos, type RepositorioCatalogos } from './repositorios/catalogos';
```

por:

```ts
import { crearRepositorioCatalogos, type RepositorioCatalogos } from './repositorios/catalogos';
import { crearRepositorioCobranzas, type RepositorioCobranzas } from './repositorios/cobranzas';
```

Reemplaza:

```ts
  /**
   * Emision offline de folios (T-14). La usa `ventas` dentro de su propia
   * transaccion (T-16); T-20 hara lo mismo con la cobranza.
   */
  folios: RepositorioFolios;
  /** Ventas capturadas en ruta (T-16). */
  ventas: RepositorioVentas;
```

por:

```ts
  /**
   * Emision offline de folios (T-14). La usan `ventas` (T-16) y `cobranzas`
   * (T-20) dentro de su propia transaccion, con el mismo contador del dia.
   */
  folios: RepositorioFolios;
  /** Ventas capturadas en ruta (T-16). */
  ventas: RepositorioVentas;
  /** Cobros y abonos capturados en ruta (T-20). */
  cobranzas: RepositorioCobranzas;
```

Reemplaza:

```ts
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    versionEsquema: versionFinal,
```

por:

```ts
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos, folios }),
    versionEsquema: versionFinal,
```

En `apps/tablet/src/datos/index.ts`, reemplaza:

```ts
export {
  leerAbonos,
```

por:

```ts
export { crearRepositorioCobranzas, ErrorCobranza } from './repositorios/cobranzas';
export type { DatosRegistroCobranza, RepositorioCobranzas } from './repositorios/cobranzas';
export {
  leerAbonos,
```

- [ ] **Step 6: Correr las pruebas y verlas pasar**

Run: `npm test --workspace=apps/tablet -- cobranzas catalogos`
Expected: PASS; `repositorios/cobranzas.spec.ts` con **14** pruebas y `catalogos.spec.ts` con 1 más.

- [ ] **Step 7: Suite, typecheck, lint y bundle**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status --short
```

Expected: `Tests: 288 passed` (273 + 14 + 1), 19 suites; typecheck y lint limpios; bundle sin errores; `git status --short` solo con los seis archivos (si `export` deja `apps/tablet/dist/`, no se agrega).

- [ ] **Step 8: Commit**

```bash
git add apps/tablet/src/datos/repositorios/cobranzas.ts \
        apps/tablet/src/datos/repositorios/cobranzas.spec.ts \
        apps/tablet/src/datos/repositorios/catalogos.ts \
        apps/tablet/src/datos/repositorios/catalogos.spec.ts \
        apps/tablet/src/datos/inicializar.ts \
        apps/tablet/src/datos/index.ts
git commit -m "$(cat <<'EOF'
feat(t-20): repositorio de cobranzas de la tablet con folio y reparto local

registrar valida antes de abrir la transaccion; dentro emite el folio
(savepoint, contador compartido con ventas), graba el cobro y aplica el
reparto local: descuenta saldos, retira con activo 0 la nota que queda
en cero, agrega el abono a abonos_json y suma el excedente al saldo a
favor (D15). Un fallo no quema folio. catalogos.publicarCambio avisa a
las pantallas tras el commit. CapaDatos.cobranzas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 12: Tablet — `fuenteCobranzas` + registro en la sesión + contadores

**Modelo:** implementador `haiku` · revisor `sonnet`

**Files:**
- Create: `apps/tablet/src/sincronizacion/fuente-cobranzas.ts`
- Test: `apps/tablet/src/sincronizacion/fuente-cobranzas.spec.ts`
- Modify: `apps/tablet/src/estado/proveedor-sesion.tsx`
- Modify: `apps/tablet/app/(jornada)/index.tsx`
- Modify: `apps/tablet/app/(jornada)/cerrar-dia.tsx`

**Interfaces:**
- Consumes: `RepositorioCobranzas` (`pendientesDeSincronizar`, `marcarSincronizada`, `marcarError`) de la Task 11; `DatosCobranza`, `OperacionSaliente` de `contrato.ts` (Task 4); `FuenteOperaciones` de `motor.ts`.
- Produces: `fuenteCobranzas(cobranzas: RepositorioCobranzas): FuenteOperaciones` con `tipo: 'cobranza'`; orden de fuentes del motor: jornadas, ventas, cobranzas (D15). Los "registros por subir" del menú de la jornada y de cerrar el día suman cobranzas.

**Contexto:** el motor sube **por fuente**, en el orden en que se registran, y cada lote confirma antes del siguiente. Registrar cobranzas después de ventas es lo que hace que un cobro nunca llegue antes que una venta del mismo día.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/tablet/src/sincronizacion/fuente-cobranzas.spec.ts`:

```ts
import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioCobranzas } from '@/datos/repositorios/cobranzas';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';

import { fuenteCobranzas } from './fuente-cobranzas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const cobranzas = crearRepositorioCobranzas(deps, {
    catalogos,
    folios: crearRepositorioFolios(deps),
  });
  return { cobranzas, fuente: fuenteCobranzas(cobranzas) };
}

const cobro = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  ventaNotaId: 'nota-1',
  montoCentavos: 5000,
  metodoPago: 'cheque' as const,
  fechaPago: '2026-08-06',
};

describe('fuente de cobranzas (T-20)', () => {
  it('sin cobros no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('cobranza');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre exacto del contrato: cliente y folio en el sobre, el pago en datos', () => {
    const { cobranzas, fuente } = montar();
    const c = cobranzas.registrar(cobro);

    expect(fuente.pendientes()).toEqual([
      {
        // La clave es el id de la fila: no cambia entre reintentos.
        clave: c.id,
        tipo: 'cobranza',
        fecha_operacion: '2026-08-07',
        ocurrido_en: '2026-08-07T15:00:00.000Z',
        cliente_id: 'cli-1',
        folio: 'TJ260807AP01',
        datos: {
          venta_nota_id: 'nota-1',
          monto_centavos: 5000,
          metodo_pago: 'cheque',
          fecha_pago: '2026-08-06',
        },
      },
    ]);
  });

  it('un cobro aceptado sale de la cola', () => {
    const { cobranzas, fuente } = montar();
    const c = cobranzas.registrar(cobro);
    fuente.marcarSincronizada(c.id);
    expect(fuente.pendientes()).toEqual([]);
    expect(cobranzas.porId(c.id)?.sync_estado).toBe('sincronizado');
  });

  it('un cobro rechazado guarda el motivo y se vuelve a mandar en la siguiente sincronizacion', () => {
    const { cobranzas, fuente } = montar();
    const c = cobranzas.registrar(cobro);
    fuente.marcarError(c.id, 'nota-no-encontrada: la nota no existe');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([c.id]);
    expect(cobranzas.porId(c.id)?.sync_error).toBe('nota-no-encontrada: la nota no existe');
  });
});
```

Run: `npm test --workspace=apps/tablet -- fuente-cobranzas`
Expected: FAIL con `Cannot find module './fuente-cobranzas'`.

- [ ] **Step 2: Implementar**

Crea `apps/tablet/src/sincronizacion/fuente-cobranzas.ts`:

```ts
import type { RepositorioCobranzas } from '@/datos/repositorios/cobranzas';

import type { DatosCobranza, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los cobros capturados en ruta, como operaciones del push (T-20).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y reenviar no duplica.
 * - **`fecha_operacion`** es la fecha con la que se emitio el folio.
 * - **`cliente_id` y `folio`** van en el sobre, no en `datos` (contrato §6).
 * - **`datos`** es el pago tal cual; el reparto lo hace el servidor.
 *
 * Se registra DESPUES de la fuente de ventas: el motor sube por fuente y en
 * orden, asi que un cobro nunca llega antes que las ventas del dia. Los
 * rechazados siguen en la cola y se reenvian (patron D19 de T-16).
 */
export function fuenteCobranzas(cobranzas: RepositorioCobranzas): FuenteOperaciones {
  return {
    tipo: 'cobranza',

    pendientes(): OperacionSaliente[] {
      return cobranzas.pendientesDeSincronizar().map((c) => {
        const datos: DatosCobranza = {
          venta_nota_id: c.venta_nota_id,
          monto_centavos: c.monto_centavos,
          metodo_pago: c.metodo_pago,
          fecha_pago: c.fecha_pago,
        };

        return {
          clave: c.id,
          tipo: 'cobranza',
          fecha_operacion: c.fecha,
          ocurrido_en: c.grabada_en,
          cliente_id: c.cliente_id,
          folio: c.folio,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => cobranzas.marcarSincronizada(clave),
    marcarError: (clave, motivo) => cobranzas.marcarError(clave, motivo),
  };
}
```

Run: `npm test --workspace=apps/tablet -- fuente-cobranzas`
Expected: PASS, 4 pruebas.

- [ ] **Step 3: Registrar la fuente en la sesión**

En `apps/tablet/src/estado/proveedor-sesion.tsx`, reemplaza:

```ts
import { fuenteVentas } from '@/sincronizacion/fuente-ventas';
```

por:

```ts
import { fuenteCobranzas } from '@/sincronizacion/fuente-cobranzas';
import { fuenteVentas } from '@/sincronizacion/fuente-ventas';
```

y reemplaza:

```ts
      // T-16: las ventas del dia suben despues de la jornada.
      fuentes: [fuenteJornadas(datos.jornadas), fuenteVentas(datos.ventas)],
```

por:

```ts
      // T-16: las ventas suben despues de la jornada. T-20: los cobros, al
      // final, para no llegar nunca antes que una venta del dia.
      fuentes: [
        fuenteJornadas(datos.jornadas),
        fuenteVentas(datos.ventas),
        fuenteCobranzas(datos.cobranzas),
      ],
```

- [ ] **Step 4: Contadores de "registros por subir"**

En `apps/tablet/app/(jornada)/index.tsx`, reemplaza:

```ts
  // Suma ventas: si quedan sin subir, la jornada no puede decir "listo" aunque
  // ella misma ya este sincronizada, o el vendedor cierra el dia sin WiFi
  // creyendo que ya subio todo.
  const pendientes =
    datos.jornadas.pendientesDeSincronizar().length + datos.ventas.pendientesDeSincronizar().length;
```

por:

```ts
  // Suma ventas y cobros (T-20): si quedan sin subir, la jornada no puede decir
  // "listo" aunque ella misma ya este sincronizada, o el vendedor cierra el dia
  // sin WiFi creyendo que ya subio todo.
  const pendientes =
    datos.jornadas.pendientesDeSincronizar().length +
    datos.ventas.pendientesDeSincronizar().length +
    datos.cobranzas.pendientesDeSincronizar().length;
```

En `apps/tablet/app/(jornada)/cerrar-dia.tsx`, reemplaza:

```ts
  // Suma ventas: si quedan sin subir, el cierre no puede decir "listo" aunque
  // la jornada misma ya este sincronizada, o el vendedor cierra el dia sin
  // WiFi creyendo que ya subio todo.
  const pendientes =
    datos.jornadas.pendientesDeSincronizar().length + datos.ventas.pendientesDeSincronizar().length;
```

por:

```ts
  // Suma ventas y cobros (T-20): si quedan sin subir, el cierre no puede decir
  // "listo" aunque la jornada misma ya este sincronizada, o el vendedor cierra
  // el dia sin WiFi creyendo que ya subio todo.
  const pendientes =
    datos.jornadas.pendientesDeSincronizar().length +
    datos.ventas.pendientesDeSincronizar().length +
    datos.cobranzas.pendientesDeSincronizar().length;
```

- [ ] **Step 5: Suite, typecheck, lint y bundle**

```bash
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status --short
```

Expected: `Tests: 292 passed` (288 + 4), 20 suites; typecheck y lint limpios; bundle sin errores; `git status --short` solo con los cinco archivos (sin `apps/tablet/dist/`).

- [ ] **Step 6: Commit**

```bash
git add apps/tablet/src/sincronizacion/fuente-cobranzas.ts \
        apps/tablet/src/sincronizacion/fuente-cobranzas.spec.ts \
        apps/tablet/src/estado/proveedor-sesion.tsx \
        "apps/tablet/app/(jornada)/index.tsx" \
        "apps/tablet/app/(jornada)/cerrar-dia.tsx"
git commit -m "$(cat <<'EOF'
feat(t-20): fuenteCobranzas sube los cobros despues de las ventas

Arma el sobre del contrato (cliente y folio en el sobre, el pago en
datos) y se registra al final del motor para que un cobro nunca llegue
antes que las ventas del dia (D15). Los rechazados se reenvian. Los
registros por subir del menu y de cerrar el dia suman cobranzas (D16).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 13: Tablet — pantalla `cobranza.tsx` + `ui/opcion.tsx`

**Modelo:** implementador `sonnet` · revisor `sonnet`

**Files:**
- Create: `apps/tablet/src/ui/opcion.tsx`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx` (reemplazo completo del placeholder)

**Interfaces:**
- Consumes: `datos.cobranzas.previsualizar/registrar/delDia` (Task 11); `problemasDeCobro`, `leerMontoCentavos`, `leerAbonos` (Task 10); `datos.catalogos.obtenerCliente/notasPendientesDe`; `useJawa()` → `{ datos, vendedor, versionCatalogos }`; `useSesion()` → `{ ultimaSincronizacion }`; `ErrorFolio`.
- Produces: `Opcion({ etiqueta, seleccionada, onPress })` en `@/ui/opcion` (la Task 14 la usa en `venta.tsx`); la pantalla de cobranza con captura → revisión → grabada y "Cobros de hoy" (D16).

**Reglas que el revisor comprueba a ojo:**
- Todo en `<Pantalla>`; toda cifra en `<Cifra>` y todo dinero con `pesos()`.
- Una sola acción primaria por paso: "Revisar" (captura), "Grabar cobro" (revisión), "Volver al cliente" (grabada). "Liquidar" y "Corregir" son `neutra`.
- "Corregir" y "Grabar cobro" difieren en glifo (`←` / `✓`), forma (contorno / relleno) y color.
- Las lecturas de catálogo (`obtenerCliente`, `notasPendientesDe`) están en `useMemo` con `versionCatalogos`; "Cobros de hoy" también con `vueltas` y `ultimaSincronizacion`.
- Ningún hook después del `return` temprano de "Cliente no encontrado".
- El monto se lee con `leerMontoCentavos` (sin coma flotante); "Liquidar" escribe el saldo con `textoMonto` (sin coma flotante).
- La revisión muestra el reparto previsto: nota elegida, otras notas y saldo a favor.

- [ ] **Step 1: `Opcion` como componente del sistema**

Crea `apps/tablet/src/ui/opcion.tsx`:

```tsx
import { Pressable, Text } from 'react-native';

import { useTema } from './tema';
import { colores, grosor } from './tokens';

/**
 * Una opcion de un grupo (contado/credito, factura, metodo de pago).
 *
 * No es un `<Boton>`: elegir no hace nada todavia, solo marca. La seleccion se
 * distingue por tres canales a la vez (borde, fondo y la palabra
 * "Seleccionado"), igual que el vehiculo en `abrir-dia.tsx`.
 *
 * Nacio dentro de `venta.tsx` (T-16); T-20 la necesito en la cobranza y la
 * movio aqui para que las dos pantallas marquen igual.
 */
export function Opcion({
  etiqueta,
  seleccionada,
  onPress,
}: {
  etiqueta: string;
  seleccionada: boolean;
  onPress: () => void;
}) {
  const { estilos } = useTema();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: seleccionada }}
      accessibilityLabel={etiqueta}
      onPress={onPress}
      style={({ pressed }) => [
        estilos.tarjeta,
        estilos.celdaRejilla,
        {
          borderWidth: grosor.fuerte,
          borderColor: seleccionada ? colores.primario : colores.borde,
        },
        seleccionada && { backgroundColor: colores.primarioTenue },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <Text style={estilos.textoTarjeta}>{etiqueta}</Text>
      {seleccionada ? <Text style={estilos.textoSuave}>Seleccionado</Text> : null}
    </Pressable>
  );
}
```

- [ ] **Step 2: La pantalla**

Reemplaza el contenido de `apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx` por:

```tsx
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  ErrorCobranza,
  ErrorFolio,
  leerAbonos,
  leerMontoCentavos,
  problemasDeCobro,
  type Cobranza,
  type MetodoPago,
  type NotaPendiente,
  type Reparto,
  type SyncEstado,
} from '@/datos';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra, pesos } from '@/ui/cifra';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Pastilla, Tarjeta, type Estado } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, grosor } from '@/ui/tokens';

/**
 * Los tres pasos del cobro (D16). Un cobro grabado no se edita en la tablet:
 * la revision es obligatoria y el folio se ensena en grande al final.
 */
type Paso = 'captura' | 'revision' | 'grabada';

const METODOS: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'cheque', etiqueta: 'Cheque' },
];

const NOMBRE_METODO: Record<MetodoPago, string> = {
  efectivo: 'efectivo',
  transferencia: 'transferencia',
  cheque: 'cheque',
};

/** Como se le dice al vendedor en que va cada cobro. */
const ETIQUETA_SYNC: Record<SyncEstado, string> = {
  pendiente: 'Por subir',
  enviando: 'Subiendo',
  sincronizado: 'Sincronizado',
  error: 'Con error',
};

const ESTADO_SYNC: Record<SyncEstado, Estado> = {
  pendiente: 'pendiente',
  enviando: 'pendiente',
  sincronizado: 'listo',
  error: 'error',
};

/** Centavos al texto del campo de monto, sin coma flotante ("150.50"). */
function textoMonto(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

/**
 * Una nota pendiente que se puede elegir: folio, # de nota, fecha, total, saldo
 * y abonos previos ([[Cobranza-Abono]]: "mostrar fechas de abonos previos y
 * saldo pendiente").
 */
function NotaSeleccionable({
  nota,
  seleccionada,
  onPress,
}: {
  nota: NotaPendiente;
  seleccionada: boolean;
  onPress: () => void;
}) {
  const { estilos } = useTema();
  const abonos = leerAbonos(nota.abonos_json);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: seleccionada }}
      accessibilityLabel={`Nota ${nota.num_nota}, folio ${nota.folio}`}
      onPress={onPress}
      style={({ pressed }) => [
        estilos.tarjeta,
        {
          gap: espacio.xs,
          borderWidth: grosor.fuerte,
          borderColor: seleccionada ? colores.primario : colores.borde,
        },
        seleccionada && { backgroundColor: colores.primarioTenue },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <Text style={estilos.textoTarjeta}>
        <Cifra valor={nota.folio} /> · nota <Cifra valor={nota.num_nota} /> · {nota.fecha}
      </Text>
      <Text style={estilos.textoSuave}>
        Total <Cifra valor={pesos(nota.monto_total_centavos)} tono="suave" /> · saldo{' '}
        <Cifra valor={pesos(nota.saldo_centavos)} tono="aviso" />
      </Text>
      {abonos.map((a, i) => (
        <Text key={`${a.fecha_pago}-${i}`} style={estilos.textoSuave}>
          Abono del {a.fecha_pago}: <Cifra valor={pesos(a.monto_centavos)} tono="suave" /> en{' '}
          {NOMBRE_METODO[a.metodo_pago] ?? a.metodo_pago}
        </Text>
      ))}
      {seleccionada ? <Text style={estilos.textoSuave}>Seleccionada</Text> : null}
    </Pressable>
  );
}

/**
 * Cobranza / abono de un cliente (T-20): elegir la nota, capturar el pago,
 * revisar el reparto y grabar con folio.
 *
 * El reparto (nota elegida → otras notas → saldo a favor) lo calcula el
 * repositorio con la misma funcion que el servidor; esta pantalla solo lo
 * muestra.
 */
export default function PantallaCobranza() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  // El dia de trabajo del reloj de la tablet: el mismo con el que se emite el folio.
  const hoy = datos.deps.reloj.hoy();

  // `versionCatalogos` en las lecturas: grabar un cobro descuenta saldos y el
  // pull los reescribe; sin ella la pantalla no lo veria (defecto 2026-08-23).
  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const notas = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.notasPendientesDe(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  // "Cobros de hoy": se relee al volver a la pantalla y cuando el push cambia
  // su estado.
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  const cobrosDeHoy = useMemo(() => {
    void vueltas;
    void ultimaSincronizacion;
    void versionCatalogos;
    return datos.cobranzas.delDia(clienteId);
  }, [datos, clienteId, vueltas, ultimaSincronizacion, versionCatalogos]);

  const [paso, setPaso] = useState<Paso>('captura');
  const [notaId, setNotaId] = useState<string | null>(null);
  const [montoTexto, setMontoTexto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [fechaPago, setFechaPago] = useState(hoy);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [reparto, setReparto] = useState<Reparto | null>(null);
  const [grabado, setGrabado] = useState<Cobranza | null>(null);

  // Antes de este punto solo hay hooks: se llaman siempre, en el mismo orden.
  if (!cliente || !vendedor) {
    return (
      <Pantalla
        titulo="Cliente no encontrado"
        subtitulo="No está en el catálogo local de esta tablet."
      >
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const vendedorId = vendedor.id;
  const nombreCliente = cliente.nombre;
  const nota: NotaPendiente | null = notas.find((n) => n.id === notaId) ?? null;
  const montoCentavos = leerMontoCentavos(montoTexto);

  function elegirNota(id: string) {
    setNotaId(id);
    setProblemas([]);
  }

  function liquidar() {
    if (nota) setMontoTexto(textoMonto(nota.saldo_centavos));
  }

  function revisar() {
    const encontrados = problemasDeCobro({
      notaFecha: nota?.fecha ?? null,
      montoCentavos,
      metodoPago: metodo,
      fechaPago,
      hoy,
    });
    setProblemas(encontrados);
    if (encontrados.length > 0 || nota === null || montoCentavos === null) return;
    setReparto(datos.cobranzas.previsualizar(clienteId, nota.id, montoCentavos));
    setPaso('revision');
  }

  function grabar() {
    // `revisar` no deja llegar aqui sin nota ni monto; la comprobacion es para el tipo.
    if (nota === null || montoCentavos === null) return;
    try {
      const cobro = datos.cobranzas.registrar({
        vendedorId,
        clienteId,
        ventaNotaId: nota.id,
        montoCentavos,
        metodoPago: metodo,
        fechaPago,
      });
      setProblemas([]);
      setGrabado(cobro);
      setPaso('grabada');
    } catch (e) {
      setProblemas([
        e instanceof ErrorCobranza || e instanceof ErrorFolio
          ? e.message
          : 'No se pudo grabar el cobro. No se consumió ningún folio; intenta de nuevo.',
      ]);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 3. Grabada: el folio en grande                                    */
  /* ---------------------------------------------------------------- */

  if (paso === 'grabada' && grabado) {
    return (
      <Pantalla
        titulo="Cobro grabado"
        subtitulo={`${nombreCliente} · anota este folio en el recibo del cliente.`}
      >
        <Tarjeta estado="listo" etiqueta="Folio">
          <Cifra valor={grabado.folio} tamano="grande" />
          <Text style={estilos.textoSuave}>
            <Cifra valor={pesos(grabado.monto_centavos)} tono="suave" /> en{' '}
            {NOMBRE_METODO[grabado.metodo_pago]} · pagado el {grabado.fecha_pago}
          </Text>
          <Text style={estilos.textoSuave}>
            Quedó guardado en la tablet y sube solo al sincronizar. Si otra tablet o la oficina ya
            cobró esa nota, el servidor pasa el dinero a las otras notas o al saldo a favor.
          </Text>
        </Tarjeta>

        {/* Unica accion de este paso. */}
        <Boton
          etiqueta="Volver al cliente"
          glifo="←"
          onPress={() => router.back()}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Revision: el reparto previsto                                  */
  /* ---------------------------------------------------------------- */

  if (paso === 'revision' && reparto && nota && montoCentavos !== null) {
    const folioDe = (id: string) => notas.find((n) => n.id === id)?.folio ?? id;
    return (
      <Pantalla
        titulo="Revisa el cobro"
        subtitulo={`${nombreCliente} · un cobro grabado no se puede editar.`}
      >
        <Tarjeta estado="accion" etiqueta="Cobro">
          <Cifra valor={pesos(montoCentavos)} tamano="grande" />
          <Text style={estilos.textoSuave}>
            En {NOMBRE_METODO[metodo]} · pagado el {fechaPago.trim()} · nota{' '}
            <Cifra valor={nota.num_nota} tono="suave" />
          </Text>
        </Tarjeta>

        <Tarjeta etiqueta="Cómo se reparte">
          {reparto.aplicaciones.map((a) => (
            <Text key={a.notaId} style={estilos.textoTarjeta}>
              <Cifra valor={folioDe(a.notaId)} /> · <Cifra valor={pesos(a.montoCentavos)} /> ·{' '}
              {a.saldoDespuesCentavos === 0 ? (
                'queda pagada'
              ) : (
                <>
                  queda debiendo <Cifra valor={pesos(a.saldoDespuesCentavos)} tono="aviso" />
                </>
              )}
            </Text>
          ))}
          {reparto.saldoFavorCentavos > 0 ? (
            <Text style={estilos.textoTarjeta}>
              Saldo a favor del cliente:{' '}
              <Cifra valor={pesos(reparto.saldoFavorCentavos)} tono="exito" />
            </Text>
          ) : null}
        </Tarjeta>

        {problemas.map((p) => (
          <Text key={p} style={estilos.error}>
            {p}
          </Text>
        ))}

        {/*
          Opuestas en tres ejes (sistema de diseno): Grabar es relleno naranja con
          ✓; Corregir es contorno neutro con ←. Grabar es la unica primaria.
        */}
        <View style={estilos.filaAcciones}>
          <Boton etiqueta="Corregir" tono="neutra" glifo="←" onPress={() => setPaso('captura')} />
          <Boton etiqueta="Grabar cobro" glifo="✓" onPress={grabar} />
        </View>
      </Pantalla>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 1. Captura                                                        */
  /* ---------------------------------------------------------------- */

  // Lo mas grave manda: un error sobre "falta subir", y "falta subir" sobre "todo subido".
  const estadoCobros: Estado = cobrosDeHoy.some((c) => c.sync_estado === 'error')
    ? 'error'
    : cobrosDeHoy.some((c) => c.sync_estado !== 'sincronizado')
      ? 'pendiente'
      : cobrosDeHoy.length > 0
        ? 'listo'
        : 'neutro';

  return (
    <Pantalla
      formulario
      titulo={`Cobranza · ${nombreCliente}`}
      subtitulo="Elige la nota que paga. Si paga de más, el resto va a sus otras notas y después a saldo a favor."
    >
      {cliente.saldo_favor_centavos > 0 ? (
        <Tarjeta estado="listo" etiqueta="Saldo a favor">
          <Cifra valor={pesos(cliente.saldo_favor_centavos)} tamano="destacado" tono="exito" />
          <Text style={estilos.textoSuave}>Lo aplica la oficina desde el portal.</Text>
        </Tarjeta>
      ) : null}

      <Text style={estilos.seccion}>Notas pendientes</Text>
      {notas.length === 0 ? (
        <Tarjeta etiqueta="Sin notas">
          <Text style={estilos.textoTarjeta}>Este cliente no tiene notas pendientes en la tablet.</Text>
          <Text style={estilos.textoSuave}>Las notas bajan del portal al sincronizar.</Text>
        </Tarjeta>
      ) : (
        notas.map((n) => (
          <NotaSeleccionable
            key={n.id}
            nota={n}
            seleccionada={n.id === notaId}
            onPress={() => elegirNota(n.id)}
          />
        ))
      )}

      {nota ? (
        <>
          <Text style={estilos.seccion}>Pago</Text>
          <View style={estilos.filaAcciones}>
            <View style={{ flex: 1 }}>
              <Campo
                etiqueta="Monto cobrado"
                cifra
                value={montoTexto}
                onChangeText={setMontoTexto}
                invalido={montoTexto.trim() !== '' && montoCentavos === null}
                placeholder="0.00"
                // `cifra` pone `number-pad`, que en Android no tiene punto: el
                // monto lleva centavos. `Campo` aplica las props despues.
                keyboardType="decimal-pad"
              />
            </View>
            <Boton
              etiqueta="Liquidar"
              tono="neutra"
              glifo="="
              ancho="ajustado"
              onPress={liquidar}
            />
          </View>

          <Text style={estilos.seccion}>Método de pago</Text>
          <View style={estilos.rejilla}>
            {METODOS.map((m) => (
              <Opcion
                key={m.valor}
                etiqueta={m.etiqueta}
                seleccionada={metodo === m.valor}
                onPress={() => setMetodo(m.valor)}
              />
            ))}
          </View>

          <View style={{ marginTop: espacio.lg }}>
            <Campo
              etiqueta="Fecha de pago"
              value={fechaPago}
              onChangeText={setFechaPago}
              maxLength={10}
              placeholder="AAAA-MM-DD"
              ayuda={`Entre ${nota.fecha} y ${hoy}.`}
            />
          </View>
        </>
      ) : null}

      {problemas.map((p) => (
        <Text key={p} style={estilos.error}>
          {p}
        </Text>
      ))}

      {/* Unica accion primaria de la captura. */}
      <Boton
        etiqueta="Revisar"
        glifo="→"
        onPress={revisar}
        deshabilitado={notas.length === 0}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.lg }}
      />

      <Tarjeta estado={estadoCobros} etiqueta="Cobros de hoy">
        {cobrosDeHoy.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no le has cobrado hoy.</Text>
        ) : (
          cobrosDeHoy.map((c) => (
            <View key={c.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={c.folio} /> · <Cifra valor={pesos(c.monto_centavos)} /> ·{' '}
                {NOMBRE_METODO[c.metodo_pago]}
              </Text>
              <Pastilla texto={ETIQUETA_SYNC[c.sync_estado]} estado={ESTADO_SYNC[c.sync_estado]} />
              {c.sync_estado === 'error' && c.sync_error ? (
                <Text style={estilos.error}>{c.sync_error}</Text>
              ) : null}
            </View>
          ))
        )}
      </Tarjeta>
    </Pantalla>
  );
}
```

- [ ] **Step 3: Typecheck, lint, pruebas y bundle**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status --short
```

Expected: typecheck y lint limpios (ningún aviso de `react-hooks/exhaustive-deps` ni de `react-hooks/rules-of-hooks`); `Tests: 292 passed` (sin cambios); bundle sin errores; `git status --short` solo con los dos archivos. Si `Campo` no acepta `ayuda` como `string`, **detente** y avisa (su firma está en `apps/tablet/src/ui/campo.tsx`).

- [ ] **Step 4: Recorrer las reglas de la pantalla**

Lee el archivo contra "Reglas que el revisor comprueba a ojo" y confirma cada punto en tu reporte. Anota que **la pantalla no se ha visto en un dispositivo**.

- [ ] **Step 5: Commit**

```bash
git add apps/tablet/src/ui/opcion.tsx \
        "apps/tablet/app/(jornada)/operacion/[clienteId]/cobranza.tsx"
git commit -m "$(cat <<'EOF'
feat(t-20): pantalla de cobranza de la tablet — nota, pago, reparto y folio

Notas pendientes con folio, numero, fecha, total, saldo y abonos
previos; saldo a favor del cliente; monto con Liquidar, metodo (efectivo
por default) y fecha de pago. La revision muestra el reparto previsto
(nota elegida, otras notas, saldo a favor) antes de grabar, y el folio
sale en grande (D16). Cobros de hoy con su estado de sincronizacion.
Opcion pasa a ui/ para compartirla con la venta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 14: Tablet — consignación en `venta.tsx` + saldo a favor en la ficha

**Modelo:** implementador `sonnet` · revisor `sonnet`

**Files:**
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`
- Modify: `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`

**Interfaces:**
- Consumes: `Opcion` de `@/ui/opcion` (Task 13); la ruta `/(jornada)/operacion/[clienteId]/cobranza` (Task 13); `Cliente.saldo_favor_centavos` (Task 9).
- Produces: en el paso "grabada" de la venta, si el cliente tiene notas pendientes, la acción neutra **"Cobrar notas pendientes (N)"** que abre la cobranza del mismo cliente (D6); la ficha del cliente muestra su saldo a favor (D5).

**Reglas que el revisor comprueba a ojo:**
- En "grabada" la primaria sigue siendo "Volver al cliente" (relleno, `←`); "Cobrar notas pendientes (N)" es `neutra` (contorno, `$`). Sin notas pendientes, solo aparece "Volver al cliente", igual que en T-16.
- "Cobrar notas pendientes" usa `router.replace`: al volver de la cobranza se regresa a la ficha, no a una venta ya grabada.
- `venta.tsx` ya no define `Opcion` ni importa `Pressable`, `colores` ni `grosor`.

- [ ] **Step 1: `venta.tsx` usa la `Opcion` compartida**

En `apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx`, reemplaza:

```tsx
import { Pressable, Text, View } from 'react-native';
```

por:

```tsx
import { Text, View } from 'react-native';
```

Reemplaza:

```tsx
import { Cifra, pesos } from '@/ui/cifra';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, grosor } from '@/ui/tokens';
```

por:

```tsx
import { Cifra, pesos } from '@/ui/cifra';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';
```

Borra la definición local completa — desde:

```tsx
/**
 * Una opcion de un grupo (contado/credito, factura).
```

hasta el `}` que cierra `function Opcion(...)` (la línea que sigue a `    </Pressable>` y `  );`), dejando intacto el bloque que empieza por `/**\n * Venta a un cliente (T-16): captura, revision y folio.`.

- [ ] **Step 2: La acción de consignación en "grabada"**

En el mismo archivo, reemplaza:

```tsx
        {/* Unica accion de este paso. */}
        <Boton
          etiqueta="Volver al cliente"
          glifo="←"
          onPress={() => router.back()}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }
```

por:

```tsx
        {/*
          D6 (T-20): consignacion. Si el cliente tiene notas pendientes, se
          ofrece cobrarlas en un paso aparte. Es neutra (contorno, $) para que
          la primaria siga siendo volver (relleno, ←). `replace` y no `push`:
          al terminar el cobro, "Volver al cliente" regresa a la ficha y no a
          esta venta ya grabada.
        */}
        {notas.length > 0 ? (
          <View style={[estilos.filaAcciones, { marginTop: espacio.lg, marginBottom: espacio.xl }]}>
            <Boton
              etiqueta={`Cobrar notas pendientes (${notas.length})`}
              tono="neutra"
              glifo="$"
              onPress={() =>
                router.replace({
                  pathname: '/(jornada)/operacion/[clienteId]/cobranza',
                  params: { clienteId },
                })
              }
            />
            <Boton etiqueta="Volver al cliente" glifo="←" onPress={() => router.back()} />
          </View>
        ) : (
          <Boton
            etiqueta="Volver al cliente"
            glifo="←"
            onPress={() => router.back()}
            estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
          />
        )}
      </Pantalla>
    );
  }
```

Y en la tarjeta de notas de la captura, reemplaza:

```tsx
          <Text style={estilos.textoSuave}>Se cobran desde «Cobranza / abono».</Text>
```

por:

```tsx
          <Text style={estilos.textoSuave}>
            Se cobran desde «Cobranza / abono», también al terminar esta venta.
          </Text>
```

Run: `grep -n "colores\|grosor\|Pressable\|function Opcion" "apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx"`
Expected: sin salida.

- [ ] **Step 3: Saldo a favor en la ficha del cliente**

En `apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx`, reemplaza:

```tsx
          descripcion="Seleccionar las notas pendientes que paga o abona"
```

por:

```tsx
          descripcion="Cobrar o abonar una nota pendiente; lo que sobre va a sus otras notas"
```

y reemplaza:

```tsx
      <Tarjeta estado={estadoVentas} etiqueta="Ventas de hoy">
```

por:

```tsx
      {/* T-20 (D5): se crea al cobrar de mas; usarlo es del portal. */}
      {cliente.saldo_favor_centavos > 0 ? (
        <Tarjeta estado="listo" etiqueta="Saldo a favor">
          <Cifra valor={pesos(cliente.saldo_favor_centavos)} tamano="destacado" tono="exito" />
          <Text style={estilos.textoSuave}>Lo aplica la oficina desde el portal.</Text>
        </Tarjeta>
      ) : null}

      <Tarjeta estado={estadoVentas} etiqueta="Ventas de hoy">
```

(La ficha lee `cliente` en cada render, y `useFocusEffect` la repinta al volver de la cobranza: el saldo nuevo se ve sin tocar nada más.)

- [ ] **Step 4: Typecheck, lint, pruebas y bundle**

```bash
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm test --workspace=apps/tablet
npm run export --workspace=apps/tablet
git status --short
```

Expected: typecheck y lint limpios; `Tests: 292 passed` (sin cambios); bundle sin errores; `git status --short` solo con los dos archivos.

- [ ] **Step 5: Recorrer las reglas**

Confirma en tu reporte cada punto de "Reglas que el revisor comprueba a ojo" y anota que **no se ha visto en un dispositivo**.

- [ ] **Step 6: Commit**

```bash
git add "apps/tablet/app/(jornada)/operacion/[clienteId]/venta.tsx" \
        "apps/tablet/app/(jornada)/operacion/[clienteId]/index.tsx"
git commit -m "$(cat <<'EOF'
feat(t-20): cobrar notas pendientes al grabar la venta y saldo a favor en la ficha

En el paso grabada de la venta, si el cliente tiene notas pendientes,
aparece la accion neutra "Cobrar notas pendientes (N)" que abre la
cobranza del mismo cliente; la primaria sigue siendo volver (D6). La
ficha muestra el saldo a favor (D5). venta.tsx usa ui/opcion.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

---
### Task 15: Cierre — verificación completa, `docs/` §7 y §9, vault

**Modelo:** implementador `sonnet` · revisor `sonnet`

**Files:**
- Modify: `docs/contrato-sincronizacion.md` (§7 y §9)
- **VAULT** (repo aparte, `/Users/marioburgos/iocusdev/JAWA/Obsidian Memory`):
  - Modify: `10-Dominio/Entidades/Cobranza-Abono.md`
  - Modify: `10-Dominio/Reglas/Status de venta.md`
  - Modify: `10-Dominio/Modulos/Ventas y Cobranza.md`
  - Modify: `30-Decisiones/ADR-0009 Proyección de operaciones sincronizadas a los módulos de dominio.md`
  - Modify: `20-Arquitectura/App Tablet.md`
  - Modify: `20-Arquitectura/Sincronización offline.md`
  - Modify: `00-Inicio/Estado del proyecto.md`
  - Modify: `40-Equipo/Bitácora/2026-09-14.md` (ya existe: la creó T-40; se **agrega** una sección)

**Interfaces:**
- Consumes: todo lo anterior, ya commiteado.
- Produces: la rama verificada contra la línea base, el contrato documentado y el vault al día (empujado a `main` del vault). La rama del repo **no** se empuja aquí.

- [ ] **Step 1: Verificación completa contra la línea base**

Avisa al controlador antes de correr la e2e (base local compartida).

```bash
git status --short
npx supabase test db
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm run build --workspace=apps/backend
npm run lint --workspace=apps/backend
git status --short
npm test --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet
npm run lint --workspace=apps/tablet
npm run export --workspace=apps/tablet
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "select version from supabase_migrations.schema_migrations where version in ('20260914120000','20260914160000') order by version;"
git log --oneline feature/t-16-venta-app..HEAD
```

Expected, comparado con `.superpowers/sdd/t-20-cobranza/linea-base.txt`:

| Suite | Línea base | Ahora | Diferencia |
|---|---|---|---|
| pgTAP | 129, `PASS` | **155**, `Result: PASS` | +26 (Task 1) |
| Backend unit | 243 (22 suites) | **309** (26 suites) | +24 · +24 · +13 · +5 |
| Backend e2e | 359 (14 suites) | **380** (14 suites) | +1 · +4 · +5 · +11 |
| Tablet | 227 (16 suites) | **292** (20 suites) | +8 · +38 · +15 · +4 |
| Typecheck tablet, lint backend y tablet, build backend, bundle de Metro | limpios | limpios | — |

- Los dos `git status --short` salen **vacíos**.
- La consulta a la base local devuelve **las dos** versiones (la de T-40 sigue ahí).
- `git log` muestra el commit del spec, el de este plan y los 14 de las Tasks 1–14.
- Si la e2e falla **solo** por el 401 de `auth-vendedor.e2e-spec.ts`, repítela una vez.

Si algún número no coincide, **detente** y repórtalo con la salida.

- [ ] **Step 2: `docs/contrato-sincronizacion.md` §7**

Reemplaza:

```markdown
Cuando un `tipo` tiene un módulo de dominio que lo proyecta (hoy solo `venta`),
cada operación del lote se aplica **en su propia transacción**:
```

por:

```markdown
Cuando un `tipo` tiene un módulo de dominio que lo proyecta (hoy `venta` y
`cobranza`), cada operación del lote se aplica **en su propia transacción**:
```

Reemplaza:

```markdown
2. El módulo dueño escribe sus tablas (`VentasService.registrarVenta` → `venta_nota` +
   `venta_nota_detalle`) y el buzón anota `entidad_tabla` / `entidad_id`.
3. `commit` → `aplicada`. Si el dominio rechaza (`presentacion-inactiva`,
   `precio-no-asignado`), `rollback`: no queda **ni** la venta **ni** la fila del buzón.

Los tipos sin módulo todavía (`jornada`, `cobranza`, `gasto`, `merma`, `ruta`) se
```

por:

```markdown
2. El módulo dueño escribe sus tablas y el buzón anota `entidad_tabla` / `entidad_id`:
   - `VentasService.registrarVenta` → `venta_nota` + `venta_nota_detalle` (y, si es de contado
     con monto > 0, su fila `cobranza_abono` de origen `venta_contado`); la entidad es la
     `venta_nota`.
   - `CobranzasService.registrarCobranza` → bloquea `for update`, en orden de `id`, las notas
     cobrables del cliente y la elegida; reparte; escribe una fila `cobranza_abono` por nota que
     recibe dinero (mismo folio), su `status` y, si sobra, un `saldo_favor_movimiento`. La entidad
     es la primera fila `cobranza_abono` o, si todo quedó a favor, el movimiento.
3. `commit` → `aplicada`. Si el dominio rechaza (`presentacion-inactiva`,
   `precio-no-asignado`, `nota-no-encontrada`), `rollback`: no queda **ni** la fila de negocio
   **ni** la del buzón.

Los tipos sin módulo todavía (`jornada`, `gasto`, `merma`, `ruta`) se
```

Reemplaza:

```markdown
   `unique` en T-05). **No se re-emite.** Implementado en T-16 para `venta`
   (T-20 hará lo mismo con `cobranza`): un reenvío no vuelve a proyectar y
```

por:

```markdown
   `unique` en T-05). **No se re-emite.** Implementado en T-16 para `venta`; en
   `cobranza` (T-20) se copia a cada fila `cobranza_abono` del cobro, donde **no** es
   `unique` (la unicidad vive en el buzón). Un reenvío no vuelve a proyectar y
```

- [ ] **Step 3: `docs/contrato-sincronizacion.md` §9**

Reemplaza:

```markdown
| Forma de `datos` para cobranza / gasto / merma / ruta (la de venta ya está, §6) | **T-20 / T-27 / T-33 / T-39** |
| Proyección de `cobranza`, `gasto`, `merma`, `ruta` y `jornada` a sus tablas de negocio (la de `venta` ya existe, §7) | Los mismos, y **T-38** para `jornada` |
```

por:

```markdown
| Forma de `datos` para gasto / merma / ruta (las de venta y cobranza ya están, §6) | **T-27 / T-33 / T-39** |
| Proyección de `gasto`, `merma`, `ruta` y `jornada` a sus tablas de negocio (las de `venta` y `cobranza` ya existen, §7) | Los mismos, y **T-38** para `jornada` |
| Usar el saldo a favor, eliminar una cobranza con autorización, cobranza desde el portal | **T-21 / T-34** |
```

- [ ] **Step 4: Commit de `docs/`**

```bash
git add docs/contrato-sincronizacion.md
git commit -m "$(cat <<'EOF'
docs(t-20): contrato §7 y §9 con la proyeccion de cobranza

§7: la cobranza se proyecta en su transaccion con candado, reparto y
entidad en el buzon; la venta de contado deja su cobro; el folio se
copia a cada fila del cobro. §9: cobranza deja de estar pendiente.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
```

- [ ] **Step 5: VAULT — preparar el repo del vault**

> Todo lo que sigue es en el **vault**, un repo distinto. No mezcles sus archivos con los commits de `proyecto-sinmex-t20`.

```bash
VAULT="/Users/marioburgos/iocusdev/JAWA/Obsidian Memory"
git -C "$VAULT" status --short
git -C "$VAULT" pull --ff-only origin main
```

Expected: `status` vacío y `pull` sin conflictos. Si hay cambios sin commitear, **detente**.

En **cada** nota que modifiques, pon `actualizado: 2026-09-14` en el frontmatter (en `Estado del proyecto` y en la bitácora ya lo dice).

- [ ] **Step 6: VAULT — `Cobranza-Abono`, `Status de venta`, `Ventas y Cobranza`**

En `10-Dominio/Entidades/Cobranza-Abono.md`, reemplaza:

```markdown
> [!warning] Pendiente de confirmar
> - **Saldo pendiente** puede ser un valor derivado (monto de la nota − Σ abonos) en lugar de un campo almacenado; confirmar si se persiste por registro.
```

por:

```markdown
> [!success] Resuelto en T-20 (2026-09-14) — saldo derivado, folio, origen y saldo a favor
> - **El saldo es derivado:** `monto de la nota − Σ abonos vivos`, calculado por el servidor.
>   `saldo_pendiente` se sigue guardando como **foto** del saldo tras cada fila, nunca como fuente.
> - Columnas nuevas: **`folio`** (el que emite la tablet; se repite en todas las filas de un mismo
>   cobro), **`origen`** (`venta_contado` | `cobro`) y **`fecha_operacion`** (el corte del día suma
>   por ella; `fecha_pago` es informativa).
> - **Una venta de contado deja su cobro** automático (`origen = venta_contado`, efectivo, saldo 0).
> - **Un cobro elige una nota y reparte:** la nota elegida, después las otras notas pendientes del
>   cliente de la más vieja a la más nueva, y lo que sobre queda como **saldo a favor**
>   (`saldo_favor_movimiento`). Un pago mayor al saldo se acepta. Usar el saldo a favor es del portal.
> - Una nota ya pagada o cancelada **no rechaza** el cobro: el dinero va a las otras notas o a favor.
> - En la app: método efectivo por default (transferencia y cheque elegibles) y fecha de pago entre
>   la fecha de la nota y hoy. La app no marca cuenta perdida ni registra otro cobrador.
```

En `10-Dominio/Reglas/Status de venta.md`, reemplaza:

```markdown
- **Ventas a consignación**: cuando se surte un pedido se paga el pedido anterior; al registrar la venta debe poder marcarse la cobranza de notas pendientes/abonadas en la misma operación.
```

por:

```markdown
- **Ventas a consignación**: cuando se surte un pedido se paga el pedido anterior. En la app (T-20) es un **paso aparte al terminar la venta**: "Cobrar notas pendientes (N)" abre la cobranza del mismo cliente, y cada cobro es su propia operación con su folio.
- **Cómo cambia el status al cobrar (T-20)**: tras aplicar un pago, saldo 0 → `pagada`; saldo menor al total → `abonado`. Solo las notas `pendiente`/`abonado` reciben dinero; una ya `pagada`, `cuenta_perdida` o `promocion` no, y lo que le tocaba pasa a las otras notas o a saldo a favor.
```

En `10-Dominio/Modulos/Ventas y Cobranza.md`, reemplaza:

```markdown
> [!info] Cómo se reparte en la app (spec de T-16, 2026-09-12)
> T-16 muestra las notas pendientes del cliente en la pantalla de venta, **solo lectura**. **T-20**
> agrega ahí mismo el cobro/abono como operaciones `cobranza` separadas en el mismo lote. El flujo
> ágil que pide el cliente sigue **pendiente de definir** en T-20.
```

por:

```markdown
> [!success] Cómo quedó en la app (T-20, 2026-09-14)
> T-16 muestra las notas pendientes en la pantalla de venta, solo lectura. **T-20** agrega, al
> grabar la venta, la acción **"Cobrar notas pendientes (N)"**, que abre la cobranza del mismo
> cliente. Ahí el vendedor elige **una** nota, captura el monto (con "Liquidar"), método y fecha de
> pago, revisa el reparto y graba con folio. Si paga de más, el excedente se aplica a sus otras
> notas de la más vieja a la más nueva y lo que sobre queda como **saldo a favor**, visible en su
> ficha. Una venta de contado deja su cobro sola. Decidido con Mario en el spec de T-20.
```

y reemplaza:

```markdown
> [!warning] Mostrar el total con abonos parciales
> El cliente duda si conviene mostrar el total del monto, dado el caso de que solo se abone una parte de la cuenta. Pendiente decidir cómo presentar saldo total vs. saldo pendiente con abonos.
```

por:

```markdown
> [!warning] Mostrar el total con abonos parciales
> El cliente duda si conviene mostrar el total del monto, dado el caso de que solo se abone una parte de la cuenta. Pendiente decidir cómo presentar saldo total vs. saldo pendiente con abonos.
>
> En la app, T-20 muestra **las dos cosas** por nota —total y saldo— más los abonos previos con su
> fecha. Sigue pendiente de confirmar con el cliente si así le sirve.
```

- [ ] **Step 7: VAULT — ADR-0009, `App Tablet`, `Sincronización offline`**

En `30-Decisiones/ADR-0009 Proyección de operaciones sincronizadas a los módulos de dominio.md`, reemplaza la fila:

```markdown
| `cobranza` | `ventas-cobranza/` | `CobranzasService.registrarCobranza` | `cobranza_abono`, status de `venta_nota` | T-20 |
```

por:

```markdown
| `cobranza` | `ventas-cobranza/` | `CobranzasService.registrarCobranza` | `cobranza_abono`, status de `venta_nota`, `saldo_favor_movimiento` — **implementado** (T-20, 2026-09-14) | T-20 |
```

y, justo después del bloque `> [!success] Enmienda 2026-09-13 (T-16) — la cobranza de notas pendientes sale de la operación \`venta\`` (tras su última línea, que termina en `llegue después de ella.`), inserta:

```markdown

> [!success] Nota 2026-09-14 (T-20) — cómo quedó la proyección de `cobranza`
> - `despacho-cobranza.ts` valida la forma y traduce `nota-no-encontrada`; `cobranza` va al final
>   de la unión y del `switch` (acuerdo con T-40, que agrega `prospecto` después de `venta`).
> - `registrarCobranza` bloquea `for update`, en orden de `id`, las notas cobrables del cliente y la
>   elegida antes de leer saldos (§2.3: dos cobros simultáneos no reparten el mismo saldo).
> - La entidad del buzón (§2.4) es la primera fila `cobranza_abono`; si todo el pago quedó como
>   saldo a favor, es el `saldo_favor_movimiento`.
> - `contexto` es el mismo de la venta (`sucursalId`, `fechaOperacion`, `vendedorId`, `folio`,
>   `usuarioId`).
> - Una venta de contado (`registrarVenta`) escribe su propio cobro `venta_contado`: es el mismo
>   hecho de negocio, no una segunda operación.
```

En `20-Arquitectura/App Tablet.md`, justo **después** de la última línea del callout de T-16 (la que termina en `` `chore/limpieza-numeracion-tickets`, otra sesión). ``), inserta:

```markdown

> [!info] T-20 — cobranza y abono en ruta (2026-09-14, rama `feature/t-20-cobranza-app`)
> Ya existe la **pantalla de cobranza**: las notas pendientes del cliente con folio, # de nota,
> fecha, total, saldo y abonos previos; el saldo a favor del cliente; monto con **"Liquidar"**,
> método (efectivo por default) y fecha de pago. La **revisión** muestra cómo se reparte el pago
> (nota elegida, otras notas, saldo a favor) antes de grabar, y el **folio** sale en grande. El cobro
> emite su folio **en la misma transacción** (mismo contador del día que las ventas) y descuenta los
> saldos locales con la misma función de reparto que el servidor; el siguiente pull los corrige.
> Al grabar una venta aparece **"Cobrar notas pendientes (N)"** (consignación). La ficha muestra el
> saldo a favor, y los "registros por subir" suman cobranzas. **Sigue sin probarse en una tablet.**
```

En `20-Arquitectura/Sincronización offline.md`, reemplaza:

```markdown
> rechazada no deja fila en ninguna de las dos. `cobranza`, `gasto`, `merma`, `ruta` y `jornada`
> siguen guardándose solo en el buzón hasta sus tickets (T-20, T-31, T-27, T-39, T-38).
```

por:

```markdown
> rechazada no deja fila en ninguna de las dos. **`cobranza`** ya llega a `cobranza_abono` (T-20,
> 2026-09-14), con reparto a otras notas y saldo a favor. `gasto`, `merma`, `ruta` y `jornada`
> siguen guardándose solo en el buzón hasta sus tickets (T-31, T-27, T-39, T-38).
>
> T-20 cambió también el **pull**: el saldo de cada nota es **derivado** (monto − abonos vivos), cada
> nota trae sus abonos, cada cliente su saldo a favor, y con `desde` bajan con `activo: 0` las notas
> que otro dispositivo o el portal cerraron.
```

- [ ] **Step 8: VAULT — `Estado del proyecto`**

En `00-Inicio/Estado del proyecto.md`:

(a) Justo después de la fila de la tabla que empieza por `| T-40 | Registro de Prospectos (App) |`, agrega:

```markdown
| T-20 | Cobranza / Abono — App Tablet | ✅ Hecho (2026-09-14, agente vía subagentes) — rama `feature/t-20-cobranza-app`, apilada sobre #89 (T-16). PR tras la revisión final de rama. `db push` a `sinmex dev`: ver detalle abajo. Ver detalle abajo |
```

(b) Reemplaza:

```markdown
- **Siguiente:** T-20, que agrega el cobro en esta misma pantalla.
```

por:

```markdown
- **Siguiente:** T-20, que agrega el cobro en esta misma pantalla. ✅ Hecho el 2026-09-14 (abajo).

**T-20 — detalle de lo hecho (2026-09-14, agente vía subagentes):**

- **Cobranza por el despachador de ADR-0009:** `CobranzasService.registrarCobranza` bloquea las
  notas del cliente `for update`, reparte el pago (nota elegida → otras notas por fecha → saldo a
  favor) y escribe `cobranza_abono` con folio, `origen` y `fecha_operacion`. Único rechazo del
  dominio: `nota-no-encontrada`. Una nota ya pagada en el servidor no rechaza el cobro.
- **Venta de contado:** deja su cobro `venta_contado` en la misma transacción.
- **Pull:** saldo derivado, abonos por nota, saldo a favor por cliente y notas cerradas con
  `activo: 0` (con un `status` que una tablet vieja acepta).
- **Migración** `20260914160000_cobranza_saldo_favor.sql` (+ tabla `saldo_favor_movimiento`).
  **`db push` a `sinmex dev`:** anotar aquí si se corrió (con pre-flight, junto con
  `20260912120000` de T-16) o si sigue pendiente por falta de acceso desde esta máquina.
- **Tablet:** migración local 005, reparto duplicado con los mismos casos de prueba que el
  servidor, pantalla de cobranza, "Cobrar notas pendientes (N)" al grabar la venta, saldo a favor en
  la ficha, `fuenteCobranzas` después de ventas.
- **Pruebas:** 155 pgTAP (129 + 26) · 309 unitarias (243 + 66) · 380 e2e (359 + 21) · 292 tablet
  (227 + 65). **Sin probar en tablet física.**
- **Pendiente con el cliente:** si mostrar total y saldo por nota le sirve (ver [[Ventas y Cobranza]]).
- **Para T-21/T-34:** usar el saldo a favor y eliminar una cobranza con autorización.
```

El reporte al controlador dice si el paso SINMEX DEV se corrió; el controlador corrige esa línea con el resultado real antes de abrir el PR.

- [ ] **Step 9: VAULT — Bitácora del día (agregar, no crear)**

Al **final** de `40-Equipo/Bitácora/2026-09-14.md`, agrega:

```markdown

## T-20 · Cobranza / Abono — App Tablet

Implementado por el agente vía subagentes con spec aprobado por Mario (2026-09-14) y plan
`docs/superpowers/plans/2026-09-14-t20-cobranza-app.md`. Rama `feature/t-20-cobranza-app`, apilada
sobre T-16 (#89). Detalle en [[Estado del proyecto]].

**Decisiones con Mario:** una venta de contado deja su cobro (desglosable por `origen`); un abono
mayor al saldo se acepta y el excedente va a las otras notas y luego a saldo a favor; consignación
como paso aparte al grabar la venta; en la app se elige método y fecha de pago; el efectivo cuenta en
el corte del día en que se captura; cada migración va a `sinmex dev` en cuanto pasa sus pruebas.

**Rulings del plan a validar en la revisión:** si todo el pago queda a favor, el buzón apunta al
movimiento de saldo a favor; una nota cerrada baja en el pull con `activo: 0` y `status`
`pendiente`/`abonado` para no romper tablets viejas; el backfill de `fecha_operacion` se prueba
simulado; el candado toma solo las notas cobrables y la elegida.

**Coordinación con T-40:** `cobranza` quedó al final de la unión, del `switch` y de
`CODIGOS_RECHAZO`, como se acordó arriba.

**Sigue sin verse:** la pantalla de cobranza en un dispositivo.
```

- [ ] **Step 10: VAULT — commit y push a `main` del vault**

```bash
VAULT="/Users/marioburgos/iocusdev/JAWA/Obsidian Memory"
git -C "$VAULT" status --short
git -C "$VAULT" add \
  "10-Dominio/Entidades/Cobranza-Abono.md" \
  "10-Dominio/Reglas/Status de venta.md" \
  "10-Dominio/Modulos/Ventas y Cobranza.md" \
  "30-Decisiones/ADR-0009 Proyección de operaciones sincronizadas a los módulos de dominio.md" \
  "20-Arquitectura/App Tablet.md" \
  "20-Arquitectura/Sincronización offline.md" \
  "00-Inicio/Estado del proyecto.md" \
  "40-Equipo/Bitácora/2026-09-14.md"
git -C "$VAULT" commit -m "$(cat <<'EOF'
T-20: cobranza y abono en la app tablet

Cobranza-Abono con saldo derivado, folio, origen y saldo a favor;
Status de venta con la consignacion y el cambio de status al cobrar;
Ventas y Cobranza con el flujo que quedo; ADR-0009 con la proyeccion de
cobranza implementada; App Tablet, Sincronizacion offline, Estado del
proyecto y bitacora del dia.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kpm3oXaH3JLPKWvRsfH8tm
EOF
)"
git -C "$VAULT" push origin main
```

Expected: `status` antes del `add` muestra exactamente esos ocho archivos; el `push` sube sin rechazo (si lo rechaza por cambios remotos: `git -C "$VAULT" pull --rebase origin main` y vuelve a empujar; si hay conflicto, **detente**).

- [ ] **Step 11: Reporte al controlador**

Incluye: la tabla de conteos del Step 1, los hashes (repo y vault), y lo que queda fuera o pendiente — paso SINMEX DEV (corrido o pendiente), pantallas sin probar en dispositivo, duda con el cliente sobre total y saldo, rulings a validar.

---
## Verificación final de la rama

No es una tarea de implementador. Con la Task 15 aprobada, **el controlador** despacha la revisión de **toda la rama** (`feature/t-16-venta-app..feature/t-20-cobranza-app`) en **`opus`** (o `fable`), con el spec y este plan como referencia. Lo que tiene que mirar con más cuidado, porque ninguna revisión por tarea lo ve entero:

- **Reparto duplicado:** `repartirPago` y `CASOS_REPARTO` son idénticos en `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts` (+ spec) y `apps/tablet/src/datos/cobranzas-reglas.ts` (+ spec).
- **Contrato duplicado:** `MetodoPago`, `DatosCobranza`, `AbonoPull`, `abonos`, `saldo_favor_centavos` y `nota-no-encontrada` coinciden en los dos `contrato.ts` y en `docs/contrato-sincronizacion.md`; `CONTRATO_ACTUAL` sigue en 1.
- **Tablet vieja:** el `pull` no manda ningún `status` fuera de `pendiente`/`abonado`; los campos nuevos son aditivos.
- **Tablet y servidor validan lo mismo:** lo que `problemasDeCobro` deja pasar no es `datos-invalidos` en `normalizarDatosCobranza`.
- **D13 completo:** candado `for update` en orden de `id` antes de leer saldos; la prueba de cobros simultáneos pasa.
- **Rechazos sin fila:** `nota-no-encontrada` y `datos-invalidos` no dejan buzón, `cobranza_abono` ni `saldo_favor_movimiento`.
- **Ningún camino de `cobranzas.registrar()` quema un folio**, y el contador del día es el mismo que el de las ventas.
- **`fecha_operacion` nunca re-derivada de UTC** en `cobranza_abono`, `saldo_favor_movimiento` ni en el folio.
- **`schema.d.ts`** no trae los hunks de `Cliente` de T-40.
- **Coordinación con T-40:** `cobranza` al final de `Proyeccion` y del `switch`; `nota-no-encontrada` al final de `CODIGOS_RECHAZO`.

Con la revisión aprobada y sus hallazgos corregidos, el controlador empuja la rama, abre el PR contra `feature/t-16-venta-app` (nunca lo mergea) y actualiza en el vault la fila de T-20 de `Estado del proyecto` con el número de PR. Si el paso **SINMEX DEV (controlador)** de la Task 1 sigue pendiente por falta de acceso, lo dice en el PR.

---

## Discrepancias spec ↔ código y rulings

| # | Qué | Cómo lo resuelve el plan | Tarea |
|---|---|---|---|
| 1 | D13 dice "`case` propio en `aplicar`"; el `switch` por tipo vive en `proyectar()` y el `catch` en `aplicar()` | `case 'cobranza'` en `proyectar`; rama `CobranzaRechazada` en el `catch` de `aplicar` | 6 |
| 2 | D13 dice "`marcarProyectada` con la **primera** fila `cobranza_abono`"; con D9 un cobro puede no crear ninguna (el check `monto > 0` impide una de $0) | **Ruling propuesto:** la entidad es el `saldo_favor_movimiento` | 5, 8 |
| 3 | D12 pide bajar notas cerradas con `activo: false`; el contrato usa `0 \| 1` y la tablet guarda `status` con CHECK `('pendiente','abonado')`, que tumbaría el pull entero de una tablet vieja | **Ruling propuesto:** `activo: 0` y `status` `abonado` (si tiene abonos) o `pendiente`; solo notas a crédito; el contrato no se ensancha y no hay que reconstruir la tabla local | 7 |
| 4 | Los tipos del `pull` (`abonos`, `saldo_favor_centavos`) no pueden ir en la tarea de contrato sin romper la compilación | Van en la Task 7, con el repositorio; `pruebas-apoyo` los mapea en la Task 7 y los guarda en la Task 9 | 4, 7, 9 |
| 5 | Una tablet nueva contra un servidor anterior a T-20 no recibe esos campos y chocaría con el `NOT NULL` local | `aSnapshot` pone `saldo_favor_centavos ?? 0` y `JSON.stringify(abonos ?? [])` | 9 |
| 6 | El spec pide pgTAP del backfill de `fecha_operacion`, que tras migrar ya no tiene filas | **Ruling propuesto:** se simula dentro de la transacción de la prueba (quitar `not null`, insertar, mismo `update`, volver a poner) | 1 |
| 7 | D17 dice que la URL de `sinmex dev` sale de `.env.development`; el registro de decisiones y la instrucción dicen `.env.sinmex-dev` (y Mario lo crearía en `proyecto-sinmex/`, que no se toca) | `.env.sinmex-dev` en la raíz del worktree de T-20; si no está ahí, se pide a Mario y se detiene; la URL nunca se imprime | 1 |
| 8 | `db push` puede necesitar `--include-all` (la migración de T-16 es anterior a versiones remotas) y la base remota puede tener versiones sin archivo local (T-40) o faltarle las de T-62 | **Ruling propuesto:** solo se empuja si el `--dry-run` lista exactamente `20260912120000` y `20260914160000`; cualquier otra cosa (o una versión remota sin archivo) detiene el paso; nunca `migration repair` | 1 |
| 9 | La consulta de pre-flight de T-16 del vault usa `comentarios`, que no existe antes de esa migración | Se quita esa parte y se agrega la comprobación de que las columnas no existen | 1 |
| 10 | `004-ventas.spec.ts` fija "exactamente 4 migraciones" | Pasa a afirmar la 004 sin fijar el total | 9 |
| 11 | Tocar `cliente.updated_at` (D12) hace que `preciosCambiaron` reenvíe todos los precios en el siguiente pull incremental | Costo aceptado y documentado en el contrato §5 | 5, 7 |
| 12 | D13 "bloquear las notas del cliente": ¿todas? | **Ruling propuesto:** las cobrables vivas y la elegida, en orden de `id`; las pagadas no elegidas no pueden recibir dinero | 5 |
| 13 | D2 no fija `fecha_pago` del cobro de contado | **Ruling propuesto:** la `fecha_operacion` de la venta | 5 |
| 14 | El e2e usaba `clienteId` para todo, y ese cliente acumula ventas de T-16; `ventaValida` gasta el tope de 99 folios de `FECHA_VENTAS` | **Ruling propuesto:** cada prueba de cobranza crea su cliente con `clienteConNotas` y usa `FECHA_COBROS` con su propio contador | 6 |
| 15 | Desde D2, las ventas de contado del e2e dejan `cobranza_abono` y el `afterAll` solo borraba el de `notaId` | La limpieza borra los cobros de todas las notas de los vendedores de prueba y el saldo a favor de los clientes de cobranza | 5, 6 |
| 16 | La tabla de tareas del spec junta pantalla de cobranza y consignación | Se parten en las Tasks 13 y 14 | 13, 14 |
| 17 | Un cobro local cambia `nota_pendiente` y `cliente` fuera de `guardarSnapshot`, y las pantallas no se enterarían | `catalogos.publicarCambio()` tras el `commit` | 11 |
| 18 | `Opcion` vivía dentro de `venta.tsx` y la cobranza la necesita | Pasa a `apps/tablet/src/ui/opcion.tsx` | 13, 14 |

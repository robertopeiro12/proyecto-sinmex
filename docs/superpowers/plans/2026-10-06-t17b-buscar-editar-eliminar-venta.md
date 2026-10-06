# T-17 (parte 2) · Buscar, editar y eliminar ventas desde el Portal — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la oficina busque ventas por rango de fechas, cliente y # de nota, vea su detalle, y las corrija (editar), las elimine (borrado lógico) o las marque como cuenta perdida desde el Portal, para ventas de la tablet y del portal por igual.

**Architecture:** Una migración (`20261006180000_venta_edicion`) agrega la auditoría (`actualizado_por_usuario_id`, `eliminado_por_usuario_id`) y vuelve **parcial** el único de línea por presentación. En el backend, `ventas-cobranza/` gana un lado de lectura (`VentasConsultaService` + `VentasConsultaRepository`: `GET /ventas`, `GET /ventas/:id`) y uno de escritura (`VentasEdicionService` + `VentasEdicionRepository`: `PATCH`, `DELETE`, `POST /:id/cuenta-perdida`), con las decisiones puras en `acciones-venta.ts` y `edicion-venta.ts`. Toda escritura bloquea la venta con `select … for update of vn` dentro de una transacción y reutiliza las reglas compartidas (`normalizarDatosVenta`, `revisarLineas`, `statusInicial`, `montoTotalCentavos`). En el portal, la pantalla nueva `/operacion/ventas` (búsqueda → detalle → edición), y el formulario de "Registrar venta" se parte en piezas compartidas que usa también la edición.

**Tech Stack:** NestJS 11 · Kysely · Postgres 17 (Supabase local) · pgTAP · Jest 30 + supertest (backend) · Next.js 15 / React 19 · Vitest 3 + Testing Library (portal)

**Spec:** `docs/superpowers/specs/2026-10-06-t17b-buscar-editar-eliminar-venta-design.md` — se cita como §N. La parte 1 (`docs/superpowers/specs/2026-10-06-t17a-registrar-venta-portal-design.md`, ya en `main`) es la base. Donde el plan decide algo que el spec no fija, lo marca **Decisión del plan** (resumen al final).

## Global Constraints

- **Rama:** `feature/t-17b-editar-venta`, en `/Users/robertopeiro/Dev/personal/proyecto-sinmex`. No se cambia de rama, no se hace `push` ni PR dentro de las tareas.
- **Comandos desde la raíz** del repo con `--workspace=`, nunca entrando a `apps/*` (CLAUDE.md).
- **Idioma:** identificadores, comentarios y mensajes en español; **sin acentos en identificadores ni en comentarios de código** del backend (sí en los textos que lee el usuario). Los comentarios explican *por qué*.
- **Supabase local con el `--`:** `npm run supabase -- migration up --local` (sin el `--`, npm se come `--local` y aplica al destino equivocado). Nunca `db reset` sin avisar al controlador. **Nunca nada contra `sinmex dev`** (`.env.development` / `SINMEX_DEV_DB_URL`): la nube refleja `main` y la migración la empuja Roberto al mergear (CLAUDE.md).
- **`psql` no está en el host:** `docker exec -i supabase_db_proyecto-sinmex psql -U postgres -At -c "…"`.
- **`schema.d.ts` nunca se edita a mano:** se regenera con `npm run db:types --workspace=apps/backend` después de `npm run supabase -- migration up --local`.
- **El contrato de sincronización NO cambia** (§4.5): no se tocan `apps/backend/src/modules/sincronizacion/contrato.ts`, `apps/tablet/src/sincronizacion/contrato.ts` ni `docs/contrato-sincronizacion.md`; `CONTRATO_ACTUAL` sigue en 1. La tablet se entera de una edición/eliminación/cuenta perdida por el pull de notas por cobrar que ya existe (`updated_at` lo pone el trigger).
- **Folios (CLAUDE.md, ADR-0007):** una edición **nunca** cambia el folio, el cliente, la fecha, la sucursal, el origen ni `capturo_usuario_id`. Un folio eliminado **no se reutiliza**: ni la edición ni el borrado tocan `folio_oficina_contador`.
- **Fechas:** "hoy" es `hoyEnTijuana()` en servidor y portal; las fechas se leen de la base con `to_char(…, 'YYYY-MM-DD')` y se comparan como texto `AAAA-MM-DD`. La fecha de una venta nunca se re-deriva de UTC.
- **Permisos:** `PATCH /ventas/:id`, `DELETE /ventas/:id` y `POST /ventas/:id/cuenta-perdida` llevan `@RequierePermiso('venta.editar_eliminar')` (la clave ya existe en la semilla). `GET /ventas` y `GET /ventas/:id` solo exigen sesión y validan alcance de sucursal. Las banderas del detalle (`editable`, `motivoNoEditable`, `puedeMarcarPerdida`) describen **la venta**, no al usuario: la pantalla las combina con `puede('venta.editar_eliminar')`.
- **Códigos HTTP (§4.1):** 404 si la venta no existe o está eliminada; 403 si su sucursal está fuera del alcance; 409 regla de negocio (cobros, # de nota, precio, status); 400 forma (DTO, repartidor inválido, venta de tablet sin vendedor, fechas de búsqueda).
- **Escrituras:** una transacción por petición (`VentasPortalRepository.enTransaccion`), y lo primero dentro es `select … for update of vn` de la venta (§4.2 paso 1): serializa contra un cobro de la tablet en vuelo.
- **Dinero:** centavos enteros en lógica y cable; `numeric(12,2)` en Postgres; frontera `aCentavos`/`aPesos` de `apps/backend/src/modules/sincronizacion/dinero.ts`.
- **E2e:** toda suite arranca con `iniciarEnLocal(app)` de `./apoyo-servidor`, nunca `app.init()`. Datos con `SUFIJO = \`${Date.now()}-${process.pid}\`` y borrados en `afterAll`. Jest e2e corre las suites **en paralelo**: este archivo usa fechas de **marzo de 2024** que ninguna otra suite usa (`ventas.e2e-spec.ts` usa 2025 y `2024-12-31`; `sincronizacion.e2e-spec.ts`, agosto de 2026).
- **Gotcha conocido de pgTAP:** `supabase/tests/30_precios_test.sql` truena si en la base local quedan precios extra de "Lista 1"/TJ. Toda prueba (pgTAP y e2e) limpia sus propios datos; el pgTAP nuevo **no inserta precios**; los datos sembrados para la verificación manual (Task 7) se borran al terminar y se vuelve a correr `npm run supabase -- test db`.
- **`npm run lint --workspace=apps/backend` corre con `--fix`:** después, `git status --short` solo puede mostrar archivos de la tarea. ESLint usa `recommendedTypeChecked`: en las e2e, `res.body` siempre se castea (`res.body as T`).
- **Portal:** los tipos de `apps/portal/src/lib/ventas.ts` son **copia normativa** de las formas del backend (mismo trato que en la parte 1): un cambio de forma en un lado exige el equivalente en el otro.
- **Commits:** `T-17: <qué>` y terminan con una línea en blanco y `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Editar una venta cuya presentación ya se dio de baja** (o su producto se inactivó): corregir la cantidad de otra línea no debe fallar con `presentacion-inactiva`; la línea existente se conserva con su precio guardado. → prueba "una línea existente se conserva aunque su presentación ya no se venda" (Task 3, unit).
2. **Editar una venta cuyo vendedor ya está inactivo** sin cambiar de repartidor: debe grabar, y la pantalla no debe cambiarle el repartidor en silencio. → e2e "si el repartidor no cambia no se vuelve a validar" (Task 3) y vitest "conserva como opción al repartidor actual aunque ya no esté activo" (Task 5).
3. **Una línea de pura promoción (precio $0) a la que se le capturan piezas vendidas**: debe tomar el precio de la lista a la fecha, no reventar con "precio 0". → prueba "una línea de promoción que gana piezas toma la lista" (Task 3, unit).
4. **Grabar la edición conservando el mismo # de nota** (o con otras mayúsculas/espacios): no es un "Ya existe la nota" contra sí misma. → e2e "conservar el propio # de nota no es duplicado" (Task 3).
5. **Doble clic en Guardar (edición) o en Eliminar**: una sola petición. → vitest "doble clic en Guardar graba una sola vez" (Task 5) y "Eliminar confirmado llama una sola vez" (Task 6).

---

## Antes de la Task 1 (no es una tarea: solo comprobar)

```bash
git branch --show-current            # feature/t-17b-editar-venta
git status --short                   # vacío
docker context ls                    # el contexto con * (colima o desktop-linux) — no asumas cuál
npm run supabase -- status           # stack local arriba; si no: npm run supabase start
npm run supabase -- migration list --local   # la última aplicada en local es 20261006120000
```

Si algo no coincide, **detente** y avisa al controlador.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `supabase/migrations/20261006180000_venta_edicion.sql` | Crear: columnas de auditoría + índice único parcial de línea | 1 |
| `supabase/tests/99_venta_edicion_test.sql` | Crear: pgTAP de la migración | 1 |
| `apps/backend/src/database/schema.d.ts` | Regenerar con `db:types` | 1 |
| `apps/backend/src/modules/ventas-cobranza/venta-portal.ts` (+ spec) | Modificar: exporta `esFechaReal` | 2 |
| `apps/backend/src/modules/ventas-cobranza/acciones-venta.ts` (+ spec) | Crear: `accionesDeVenta`, `bloqueoDeEdicion`, `sePuedeMarcarPerdida` — puro | 2 |
| `apps/backend/src/modules/ventas-cobranza/alcance-venta.ts` (+ spec) | Crear: `exigirAlcanceSobre` (extraído de `VentasPortalService`) | 2 |
| `apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts` | Modificar: usa `exigirAlcanceSobre` | 2 |
| `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts` | Modificar: exporta `recortar` (2); base `CamposVentaDto` (3) | 2, 3 |
| `apps/backend/src/modules/ventas-cobranza/dto/buscar-ventas.dto.ts` | Crear: query de `GET /ventas` | 2 |
| `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts` | Crear: búsqueda, cabecera, líneas, cobros | 2 |
| `apps/backend/src/modules/ventas-cobranza/ventas-consulta.service.ts` | Crear: `buscar`, `detalle` (2); `leerDetalle` (3) | 2, 3 |
| `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts` | Modificar: `GET /ventas`, `GET /:id` (2); `PATCH` (3); `DELETE`, `POST /:id/cuenta-perdida` (4) | 2, 3, 4 |
| `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` | Modificar: providers nuevos | 2, 3 |
| `apps/backend/test/ventas-editar.e2e-spec.ts` | Crear: e2e de §7 (2); PATCH (3); DELETE y cuenta perdida (4) | 2, 3, 4 |
| `apps/backend/src/modules/ventas-cobranza/edicion-venta.ts` (+ spec) | Crear: `armarVentaEditada`, `pctComisionTrasEdicion`, `planDetalle` — puro | 3 |
| `apps/backend/src/modules/ventas-cobranza/dto/editar-venta.dto.ts` | Crear: cuerpo de `PATCH` | 3 |
| `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts` | Crear: candado, líneas, cabecera, cobro de contado (3); eliminar, cuenta perdida (4) | 3, 4 |
| `apps/backend/src/modules/ventas-cobranza/ventas-edicion.service.ts` | Crear: `editar` (3); `eliminar`, `marcarCuentaPerdida` (4) | 3, 4 |
| `apps/portal/src/lib/ventas.ts` (+ test) | Modificar: tipos y API de búsqueda/detalle/edición; utilidades puras de la captura | 5 |
| `apps/portal/src/components/ventas/buscador-cliente.tsx` | Crear: búsqueda incremental de cliente (extraída) | 5 |
| `apps/portal/src/components/ventas/selector-repartidor.tsx` | Crear: desplegable de repartidor (extraído) | 5 |
| `apps/portal/src/components/ventas/tabla-productos-venta.tsx` | Crear: tabla de captura de productos (extraída) | 5 |
| `apps/portal/src/components/ventas/campos-condiciones-venta.tsx` | Crear: # nota, contado/crédito, método, factura, comentarios (extraídos) | 5 |
| `apps/portal/src/components/ventas/pantalla-registrar-venta.tsx` | Modificar: usa las piezas compartidas (sin cambio de comportamiento) | 5 |
| `apps/portal/src/components/ventas/formulario-editar-venta.tsx` (+ test) | Crear: modo edición | 5 |
| `apps/portal/src/components/ventas/detalle-venta.tsx` (+ test) | Crear: detalle y botones | 6 |
| `apps/portal/src/components/ventas/pantalla-ventas.tsx` (+ test) | Crear: búsqueda → detalle → edición | 6 |
| `apps/portal/src/app/(portal)/operacion/ventas/page.tsx` | Crear: la ruta | 6 |
| `apps/portal/src/components/layout/nav-config.ts` | Modificar: entrada "Ventas" | 6 |
| `CLAUDE.md` | Modificar: nota de edición/eliminación de ventas | 7 |

**Por qué este reparto del portal (Decisión del plan).** "Registrar" y "Editar" difieren en **de dónde sale la cabecera** (el usuario elige fecha y cliente, contra una venta fija con líneas ya guardadas) y **a dónde se graba** (`POST` contra `PATCH`). Lo que comparten —la tabla de captura, el bloque de condiciones, el desplegable de repartidor, la búsqueda de cliente y, sobre todo, las reglas que convierten lo tecleado en líneas del payload— tiene que ser **idéntico**, porque es lo que decide qué viaja al servidor. Un solo componente con `modo` entrelazaría dos flujos de carga distintos con condicionales en cada bloque; copiar el formulario duplicaría las reglas del payload. Se extraen las piezas (componentes de presentación sin estado de red) y las reglas puras a `lib/ventas.ts`, y cada pantalla conserva su propio flujo de datos.

---

## Task 1: Migración `venta_edicion` + pgTAP + `db:types`

**Files:**
- Create: `supabase/tests/99_venta_edicion_test.sql`
- Create: `supabase/migrations/20261006180000_venta_edicion.sql`
- Modify (regenerado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Consumes: nada.
- Produces (base de datos, la usan las Tasks 2–4):
  - `venta_nota.actualizado_por_usuario_id uuid null references usuario(id)`.
  - `venta_nota.eliminado_por_usuario_id uuid null references usuario(id)`.
  - `uq_venta_detalle_presentacion` deja de ser constraint de tabla y pasa a **índice único parcial** `(venta_nota_id, presentacion_id) where deleted_at is null` (mismo nombre).
  - En `schema.d.ts`: `VentaNota.actualizado_por_usuario_id: string | null` y `VentaNota.eliminado_por_usuario_id: string | null`.

- [ ] **Step 1: Escribir el pgTAP que falla**

Crear `supabase/tests/99_venta_edicion_test.sql`:

```sql
begin;
select plan(9);

-- Buscar, editar y eliminar ventas desde el portal (T-17, parte 2, §5).
--
-- Lo que la BASE garantiza aunque un script entre por debajo del servicio:
-- la auditoria de quien edito/elimino, y que una presentacion tenga una sola
-- linea VIVA por venta (una edicion puede quitarla y volver a agregarla).
--
-- Nombres con prefijo `zz-pgtap`/`ZZ-pgtap`. NO inserta precios:
-- `30_precios_test.sql` cuenta los de "Lista 1".

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t17b', 'Vendedor pgTAP T-17b', 'x', id
    from sucursal where codigo = 'TJ';
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t17b-portal', 'Usuario pgTAP T-17b', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('ZZ-pgtap-T17b Jamaica');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'ZZ-pgtap-T17b Jamaica';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T17b Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
     contado_credito, semana, mes, status, sucursal_id)
  select 'ZZPGTAPT1711', '2026-10-06', c.id, v.id, 240.00, 'zz-t17b-1',
         'credito', 41, 10, 'pendiente', c.sucursal_id
    from cliente c, vendedor v
   where c.nombre = 'ZZ-pgtap-T17b Cliente' and v.login = 'zz-pgtap-t17b';

create temporary table _t17b on commit drop as
select
  (select id from venta_nota where folio = 'ZZPGTAPT1711') as venta,
  (select id from usuario where login = 'zz-pgtap-t17b-portal') as usuario,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'ZZ-pgtap-T17b Jamaica') as pre;

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_column('venta_nota', 'actualizado_por_usuario_id',
  'la venta guarda el ultimo usuario del portal que la edito');
select has_column('venta_nota', 'eliminado_por_usuario_id',
  'la venta guarda quien la elimino');
select fk_ok('venta_nota', 'actualizado_por_usuario_id', 'usuario', 'id');
select fk_ok('venta_nota', 'eliminado_por_usuario_id', 'usuario', 'id');
select has_index('venta_nota_detalle', 'uq_venta_detalle_presentacion',
  'la unicidad de la linea por presentacion es un indice');
select is(
  (select count(*)::int from pg_constraint
    where conname = 'uq_venta_detalle_presentacion'),
  0,
  'la unicidad por presentacion ya no es una constraint total'
);

------------------------------------------------------------------
-- Una linea VIVA por presentacion
------------------------------------------------------------------

insert into venta_nota_detalle
    (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
  select venta, pre, 24, 10.00, 0 from _t17b;

select throws_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select venta, pre, 5, 10.00, 0 from _t17b$$,
  '23505',
  null,
  'sigue impidiendo dos lineas vivas de la misma presentacion'
);

update venta_nota_detalle set deleted_at = now()
 where venta_nota_id = (select venta from _t17b);

select lives_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select venta, pre, 5, 10.00, 0 from _t17b$$,
  'una edicion puede volver a agregar una presentacion cuya linea quito'
);

select lives_ok(
  $$update venta_nota
       set actualizado_por_usuario_id = (select usuario from _t17b),
           eliminado_por_usuario_id = (select usuario from _t17b),
           deleted_at = now()
     where id = (select venta from _t17b)$$,
  'la auditoria acepta al usuario del portal'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_venta_edicion_test.sql` (las columnas no existen y `pg_constraint` todavía tiene `uq_venta_detalle_presentacion`). Los demás archivos siguen en verde; si `30_precios_test.sql` falla, hay precios de "Lista 1"/TJ sobrantes de otra corrida: **detente** y avisa al controlador.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20261006180000_venta_edicion.sql`:

```sql
-- Buscar, editar y eliminar ventas desde el portal (T-17, parte 2).
-- Spec: docs/superpowers/specs/2026-10-06-t17b-buscar-editar-eliminar-venta-design.md (§5)
--
-- Pre-flight antes de empujar a `sinmex dev` (protocolo de CLAUDE.md): no hay
-- checks, `not null` ni `unique` nuevos que puedan fallar. El indice parcial es
-- MAS permisivo que la constraint total que reemplaza: toda fila que hoy cumple
-- la total cumple la parcial. Igual se anota `migration list` antes y despues.

-- Historial minimo (§2): quien y cuando. `updated_at` ya dice cuando se edito
-- y `deleted_at` cuando se elimino; aqui solo falta el quien.
alter table venta_nota
  -- Ultimo usuario del portal que la edito o la marco como cuenta perdida.
  add column actualizado_por_usuario_id uuid references usuario(id),
  -- Quien la elimino (borrado logico).
  add column eliminado_por_usuario_id uuid references usuario(id);

-- Una presentacion, una linea VIVA por venta. La constraint total de T-16
-- impediria volver a agregar una presentacion que una edicion quito (su linea
-- queda con `deleted_at`). Se conserva el nombre: es el que nombran
-- `despacho.spec.ts` y `datos-venta.ts`.
alter table venta_nota_detalle drop constraint uq_venta_detalle_presentacion;
create unique index uq_venta_detalle_presentacion
  on venta_nota_detalle (venta_nota_id, presentacion_id)
  where deleted_at is null;
```

- [ ] **Step 4: Aplicarla en local y ver el pgTAP en verde**

```bash
npm run supabase -- migration up --local
npm run supabase -- test db
```

Expected: la migración `20261006180000` aplicada; `99_venta_edicion_test.sql .. ok` y todos los demás archivos en verde (incluido `99_venta_integridad_test.sql`, cuyo "rechaza la misma presentacion dos veces" sigue valiendo: las dos líneas están vivas).

- [ ] **Step 5: Regenerar `schema.d.ts`**

```bash
npm run db:types --workspace=apps/backend
git diff --stat apps/backend/src/database/schema.d.ts
git diff apps/backend/src/database/schema.d.ts
```

Expected: el único cambio es en `interface VentaNota`, dos líneas nuevas:

```ts
  actualizado_por_usuario_id: string | null;
  eliminado_por_usuario_id: string | null;
```

Si aparece cualquier otro cambio, la base local está atrasada o adelantada respecto a `main`: **detente** y avisa al controlador.

- [ ] **Step 6: Comprobar que nada del backend se rompe**

```bash
npm run build --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- ventas.e2e-spec sincronizacion.e2e-spec
```

Expected: build sin errores; las dos suites en verde (la constraint convertida en índice no cambia ningún comportamiento existente).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261006180000_venta_edicion.sql supabase/tests/99_venta_edicion_test.sql apps/backend/src/database/schema.d.ts
git commit -m "$(cat <<'EOF'
T-17: migracion venta_edicion — auditoria y linea unica solo entre vivas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Lado de lectura — `GET /ventas` (búsqueda) y `GET /ventas/:id` (detalle con banderas)

**Files:**
- Modify: `apps/backend/src/modules/ventas-cobranza/venta-portal.ts` (exporta `esFechaReal`)
- Modify: `apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/acciones-venta.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/acciones-venta.spec.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/alcance-venta.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/alcance-venta.spec.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts` (usa `exigirAlcanceSobre`)
- Modify: `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts` (exporta `recortar`)
- Create: `apps/backend/src/modules/ventas-cobranza/dto/buscar-ventas.dto.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.service.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`
- Test: `apps/backend/test/ventas-editar.e2e-spec.ts` (crear)

**Interfaces:**
- Consumes: columnas de la Task 1 (no las lee todavía; las escribe la Task 3).
- Produces:
  - `esFechaReal(fecha: string): boolean` en `venta-portal.ts`.
  - En `acciones-venta.ts`: `interface AccionesVenta { editable: boolean; motivoNoEditable: string | null; puedeMarcarPerdida: boolean }`, `accionesDeVenta(status: string, abonosDeCobroVivos: number): AccionesVenta`, `bloqueoDeEdicion(status: string, abonosDeCobroVivos: number, accion: 'editar' | 'eliminar'): string | null`, `sePuedeMarcarPerdida(status: string): boolean`, constantes `MOTIVO_CON_COBROS`, `MOTIVO_CUENTA_PERDIDA`, `MOTIVO_NO_PERDIBLE`.
  - `exigirAlcanceSobre(usuario: { codigo: string | null } | undefined, codigoSucursal: string): void` en `alcance-venta.ts` (lanza 401/403).
  - `recortar` exportado de `dto/registrar-venta.dto.ts`.
  - `VentasConsultaRepository`: `buscar(filtro: FiltroBusquedaVentas, limite: number): Promise<VentaEncontrada[]>`, `cabecera(id: string): Promise<CabeceraVenta | undefined>`, `lineas(id: string): Promise<LineaDeVenta[]>`, `cobros(id: string): Promise<CobroDeVenta[]>` y esas cuatro interfaces.
  - `VentasConsultaService`: `buscar(usuarioId, consulta: BuscarVentasDto): Promise<ResultadoBusquedaVentas>`, `detalle(usuarioId, id): Promise<VentaDetalle>`; exporta `TOPE_BUSQUEDA_VENTAS = 200`, `ResultadoBusquedaVentas { ventas: VentaEncontrada[]; hayMas: boolean }`, `LineaDetalleVenta`, `VentaDetalle`.
  - En la e2e: helpers `registrar`, `buscar`, `detalle`, `abonar`, `ventaPorId`, `ventaDeTablet`, `nota` y los datos sembrados (los usan las Tasks 3 y 4).

- [ ] **Step 1: Pruebas puras que fallan**

En `apps/backend/src/modules/ventas-cobranza/venta-portal.spec.ts`, cambiar la importación de la primera línea por:

```ts
import { armarVentaPortal, esFechaReal, revisarFechaVenta } from './venta-portal';
```

y agregar al final del archivo:

```ts
describe('esFechaReal (T-17 parte 2)', () => {
  it.each(['2024-03-04', '2024-02-29'])('%s es un dia que existe', (fecha) => {
    expect(esFechaReal(fecha)).toBe(true);
  });

  it.each(['2024-02-30', '2023-02-29', '2024-13-01', '24-03-04', ''])(
    '%j no existe o no tiene el formato',
    (fecha) => {
      expect(esFechaReal(fecha)).toBe(false);
    },
  );
});
```

Crear `apps/backend/src/modules/ventas-cobranza/acciones-venta.spec.ts`:

```ts
import {
  MOTIVO_CON_COBROS,
  MOTIVO_CUENTA_PERDIDA,
  accionesDeVenta,
  bloqueoDeEdicion,
  sePuedeMarcarPerdida,
  type AccionesVenta,
} from './acciones-venta';

describe('accionesDeVenta: lo que se puede hacer con una venta viva (T-17 parte 2, §3.2)', () => {
  const casos: [string, number, AccionesVenta][] = [
    ['pendiente', 0, { editable: true, motivoNoEditable: null, puedeMarcarPerdida: true }],
    ['pagada', 0, { editable: true, motivoNoEditable: null, puedeMarcarPerdida: false }],
    ['promocion', 0, { editable: true, motivoNoEditable: null, puedeMarcarPerdida: false }],
    ['abonado', 1, { editable: false, motivoNoEditable: MOTIVO_CON_COBROS, puedeMarcarPerdida: true }],
    // Credito liquidada con cobros de la tablet: pagada, pero con abonos.
    ['pagada', 2, { editable: false, motivoNoEditable: MOTIVO_CON_COBROS, puedeMarcarPerdida: false }],
    ['cuenta_perdida', 0, { editable: false, motivoNoEditable: MOTIVO_CUENTA_PERDIDA, puedeMarcarPerdida: false }],
    ['cuenta_perdida', 1, { editable: false, motivoNoEditable: MOTIVO_CON_COBROS, puedeMarcarPerdida: false }],
  ];

  it.each(casos)('%s con %i abonos de cobranza', (status, abonos, esperado) => {
    expect(accionesDeVenta(status, abonos)).toEqual(esperado);
  });

  it('el motivo con cobros es el texto que pide el spec', () => {
    expect(MOTIVO_CON_COBROS).toBe(
      'Esta venta tiene cobros registrados: no se puede editar ni eliminar. Para quitar un cobro, ver Peticiones.',
    );
  });
});

describe('bloqueoDeEdicion: el 409 de PATCH y DELETE', () => {
  it('viva y sin abonos de cobranza: se puede', () => {
    expect(bloqueoDeEdicion('pagada', 0, 'editar')).toBeNull();
    expect(bloqueoDeEdicion('pendiente', 0, 'eliminar')).toBeNull();
  });

  it('con abonos de cobranza: dice que accion no se puede', () => {
    expect(bloqueoDeEdicion('abonado', 1, 'editar')).toBe(
      'Tiene cobros registrados: no se puede editar.',
    );
    expect(bloqueoDeEdicion('abonado', 1, 'eliminar')).toBe(
      'Tiene cobros registrados: no se puede eliminar.',
    );
  });

  it('una cuenta perdida no se edita ni se elimina (no hay deshacer, §6)', () => {
    expect(bloqueoDeEdicion('cuenta_perdida', 0, 'editar')).toBe(
      'Está marcada como cuenta perdida: no se puede editar.',
    );
  });
});

describe('sePuedeMarcarPerdida (§4.4)', () => {
  const casos: [string, boolean][] = [
    ['pendiente', true],
    ['abonado', true],
    ['pagada', false],
    ['promocion', false],
    ['cuenta_perdida', false],
  ];

  it.each(casos)('%s → %s', (status, esperado) => {
    expect(sePuedeMarcarPerdida(status)).toBe(esperado);
  });
});
```

Crear `apps/backend/src/modules/ventas-cobranza/alcance-venta.spec.ts`:

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { exigirAlcanceSobre } from './alcance-venta';

describe('exigirAlcanceSobre: alcance contra la sucursal YA LEIDA', () => {
  it('un usuario General alcanza cualquier sucursal', () => {
    expect(() => exigirAlcanceSobre({ codigo: null }, 'MX')).not.toThrow();
  });

  it('un usuario de Tijuana alcanza Tijuana', () => {
    expect(() => exigirAlcanceSobre({ codigo: 'TJ' }, 'TJ')).not.toThrow();
  });

  it('un usuario de Tijuana no alcanza Mexicali: 403', () => {
    expect(() => exigirAlcanceSobre({ codigo: 'TJ' }, 'MX')).toThrow(
      ForbiddenException,
    );
  });

  it('un usuario borrado o inexistente: 401', () => {
    expect(() => exigirAlcanceSobre(undefined, 'TJ')).toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `npm test --workspace=apps/backend -- venta-portal.spec acciones-venta.spec alcance-venta.spec`
Expected: FAIL — `esFechaReal` no se exporta; `./acciones-venta` y `./alcance-venta` no existen.

- [ ] **Step 3: Implementar lo puro**

En `apps/backend/src/modules/ventas-cobranza/venta-portal.ts`, reemplazar el bloque desde `const RE_FECHA` hasta el final del archivo por:

```ts
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const FECHA_MINIMA = '2000-01-01';

/**
 * `AAAA-MM-DD` y un dia que existe en el calendario (no `2025-02-30`). Postgres
 * revienta con un 22008 ante un dia imposible: esto lo convierte en un 400.
 */
export function esFechaReal(fecha: string): boolean {
  if (!RE_FECHA.test(fecha)) return false;
  const comprobacion = new Date(`${fecha}T00:00:00Z`);
  return (
    !Number.isNaN(comprobacion.getTime()) &&
    comprobacion.toISOString().slice(0, 10) === fecha
  );
}

/**
 * La fecha de la venta: hoy o un dia pasado, nunca futura (§3).
 *
 * `hoy` es `hoyEnTijuana()`: a las 23:30 de Tijuana en UTC ya es manana, y
 * compararla con el reloj UTC dejaria pasar una venta de "manana". Se compara
 * como texto `AAAA-MM-DD`, que ordena igual que las fechas.
 *
 * @returns el motivo del rechazo, o `null` si la fecha vale.
 */
export function revisarFechaVenta(fecha: string, hoy: string): string | null {
  if (!RE_FECHA.test(fecha))
    return 'La fecha debe tener el formato AAAA-MM-DD.';
  if (!esFechaReal(fecha)) return 'Esa fecha no existe.';
  // El folio solo lleva AAMMDD: 1926 y 2026 darian el mismo y el unique
  // global lo convertiria en un 500.
  if (fecha < FECHA_MINIMA) {
    return 'La fecha de la venta no puede ser anterior al 2000-01-01.';
  }
  if (fecha > hoy) return 'La fecha de la venta no puede ser futura.';
  return null;
}
```

Crear `apps/backend/src/modules/ventas-cobranza/acciones-venta.ts`:

```ts
/**
 * Que se puede hacer con una venta VIVA desde el portal (T-17, parte 2, §3.2).
 *
 * Pura y en un solo sitio: la usa el detalle (para que la pantalla pinte los
 * botones) y la usan la edicion y el borrado (para negarse con 409). Asi la
 * pantalla y el servidor no pueden discrepar.
 *
 * El permiso `venta.editar_eliminar` NO entra aqui: lo exige el guard en la
 * escritura y la pantalla lo combina con `puede()`. Una venta eliminada nunca
 * llega aqui: es 404 antes.
 */
export interface AccionesVenta {
  editable: boolean;
  motivoNoEditable: string | null;
  puedeMarcarPerdida: boolean;
}

export const MOTIVO_CON_COBROS =
  'Esta venta tiene cobros registrados: no se puede editar ni eliminar. Para quitar un cobro, ver Peticiones.';

export const MOTIVO_CUENTA_PERDIDA =
  'Esta venta está marcada como cuenta perdida: no se puede editar ni eliminar.';

export const MOTIVO_NO_PERDIBLE =
  'Solo una venta pendiente o abonada se puede marcar como cuenta perdida.';

/** §4.4: solo lo que todavia se le debe cobrar. Aunque tenga abonos. */
export function sePuedeMarcarPerdida(status: string): boolean {
  return status === 'pendiente' || status === 'abonado';
}

/**
 * @param abonosDeCobroVivos abonos vivos con `origen = 'cobro'`. El cobro
 * automatico de contado (`venta_contado`) NO cuenta: la edicion lo reescribe.
 */
export function accionesDeVenta(
  status: string,
  abonosDeCobroVivos: number,
): AccionesVenta {
  // Una cuenta perdida no se edita: recalcular el status la devolveria a
  // `pendiente`, y deshacer una cuenta perdida no entra en esta version (§6).
  const motivo =
    abonosDeCobroVivos > 0
      ? MOTIVO_CON_COBROS
      : status === 'cuenta_perdida'
        ? MOTIVO_CUENTA_PERDIDA
        : null;
  return {
    editable: motivo === null,
    motivoNoEditable: motivo,
    puedeMarcarPerdida: sePuedeMarcarPerdida(status),
  };
}

/** El mensaje del 409 de PATCH (§4.2 paso 2) y DELETE (§4.3 paso 1), o `null` si se puede. */
export function bloqueoDeEdicion(
  status: string,
  abonosDeCobroVivos: number,
  accion: 'editar' | 'eliminar',
): string | null {
  if (abonosDeCobroVivos > 0)
    return `Tiene cobros registrados: no se puede ${accion}.`;
  if (status === 'cuenta_perdida')
    return `Está marcada como cuenta perdida: no se puede ${accion}.`;
  return null;
}
```

Crear `apps/backend/src/modules/ventas-cobranza/alcance-venta.ts`:

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { resolverAlcance } from '../sucursales/alcance-sucursal';

/**
 * Exige que el usuario alcance la sucursal de algo YA LEIDO de la base (el
 * cliente de una venta nueva, una venta existente). Misma doctrina que
 * `ClientesService.obtener`: se compara contra el hecho, nunca contra un query
 * param.
 *
 * Extraida de `VentasPortalService` (T-17 parte 1) porque la busqueda, el
 * detalle y la edicion de la parte 2 necesitan exactamente la misma regla.
 *
 * @param usuario lo que devuelve `buscarSucursalUsuario`; `undefined` = el
 * usuario no existe o esta dado de baja.
 */
export function exigirAlcanceSobre(
  usuario: { codigo: string | null } | undefined,
  codigoSucursal: string,
): void {
  if (!usuario) throw new UnauthorizedException('Sesion invalida.');
  const alcance = resolverAlcance(usuario.codigo, null);
  if (alcance.tipo === 'una' && alcance.codigo !== codigoSucursal) {
    throw new ForbiddenException('No tienes acceso a esa sucursal.');
  }
}
```

En `apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts`:

1. Reemplazar el bloque de importación de `@nestjs/common` por:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

2. Borrar la línea `import { resolverAlcance } from '../sucursales/alcance-sucursal';` y agregar, junto a las demás importaciones locales:

```ts
import { exigirAlcanceSobre } from './alcance-venta';
```

3. Reemplazar el método privado `exigirAlcance` completo (con su comentario) por:

```ts
  /** Misma doctrina que `ClientesService.obtener`: el alcance se compara con la sucursal YA LEIDA. */
  private async exigirAlcance(
    usuarioId: string,
    codigoSucursal: string,
  ): Promise<void> {
    exigirAlcanceSobre(
      await this.repo.buscarSucursalUsuario(usuarioId),
      codigoSucursal,
    );
  }
```

- [ ] **Step 4: Correr las pruebas puras**

Run: `npm test --workspace=apps/backend -- venta-portal.spec acciones-venta.spec alcance-venta.spec`
Expected: PASS.

- [ ] **Step 5: Escribir la e2e de lectura que falla**

En `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts`, cambiar

```ts
const recortar = ({ value }: { value: unknown }): unknown =>
```

por

```ts
export const recortar = ({ value }: { value: unknown }): unknown =>
```

(la usa también el DTO de búsqueda).

Crear `apps/backend/test/ventas-editar.e2e-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import {
  CONTRATO_ACTUAL,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';
import { MOTIVO_CON_COBROS } from './../src/modules/ventas-cobranza/acciones-venta';
import type {
  ResultadoBusquedaVentas,
  VentaDetalle,
} from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * Buscar, editar y eliminar ventas desde el portal (T-17, parte 2): §7 del
 * spec, de punta a punta.
 *
 * Fechas de MARZO DE 2024 exclusivas de este archivo: Jest corre las suites en
 * paralelo y el contador del folio OF es por sucursal y dia. Las ventas del
 * portal de estas fechas (y su contador) se limpian antes (restos de una
 * corrida que trono) y despues.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-ved-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-ved-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-ved-sin-${SUFIJO}`;
const LOGIN_APP = `e2e-ved-app-${SUFIJO}`;

const FECHA_A = '2024-03-04';
const FECHA_B = '2024-03-05';
const FECHA_EDICION = '2024-03-06';
const FECHA_TOPE = '2024-03-07';
const FECHA_TABLET = '2024-03-08';
const FECHA_BORRADO = '2024-03-11';
const FECHA_PERDIDA = '2024-03-12';
const FECHA_CAMBIO_LISTA = '2024-03-13';
const FECHAS = [
  FECHA_A,
  FECHA_B,
  FECHA_EDICION,
  FECHA_TOPE,
  FECHA_TABLET,
  FECHA_BORRADO,
  FECHA_PERDIDA,
  FECHA_CAMBIO_LISTA,
];
/** Desde aqui tiene precio el 2 L: una venta anterior no puede agregarlo. */
const PRE3_CON_PRECIO_DESDE = FECHA_TOPE;

interface VentaCreada {
  id: string;
  folio: string;
  numNota: string;
  montoCentavos: number;
  status: string;
}

const fechaComoTexto = sql<string>`to_char(fecha, 'YYYY-MM-DD')`;

describe('Buscar, editar y eliminar ventas desde el portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;

  let productoId: string;
  let pre1: string; // 1 L: 10.00 (TJ) desde 2024-01-01; 20.00 (MX)
  let pre2: string; // 500 ml: 7.25 en la lista; 6.00 precio especial de clienteTj
  let pre3: string; // 2 L: 15.00 (TJ) solo desde PRE3_CON_PRECIO_DESDE
  let preSinPrecio: string; // 3 L: sin precio
  const precioIds: string[] = [];
  let clientePrecioId: string;
  let clienteTj: string;
  let clienteTj2: string;
  let clienteMx: string;
  let vendedorTj: string;
  let vendedorTj2: string;
  let vendedorTjInactivo: string;
  let vendedorMx: string;
  let vendedorApp: string;
  let segmentoApp: string;
  let bearerApp: string;

  let notas = 0;
  /** Un # de nota unico por llamada (≤ 30): el indice de #95 no deja repetirlo. */
  const nota = () => `ved${SUFIJO}-${++notas}`;

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio (T-08b). */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<string> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: hash,
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarVendedor = async (
    nombre: string,
    sucursalId: string,
    activo = true,
  ): Promise<string> => {
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: `e2e-ved-${nombre.toLowerCase().replace(/\s+/g, '-')}-${SUFIJO}`,
        nombre: `${nombre} ${SUFIJO}`,
        password_hash: 'x',
        sucursal_id: sucursalId,
        activo,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Precio de "Lista 1". Se borra en `afterAll`: `30_precios_test.sql` cuenta los que quedan. */
  const sembrarPrecio = async (
    presentacionId: string,
    sucursalId: string,
    precio: string,
    vigenteDesde: string,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('precio')
      .values({
        presentacion_id: presentacionId,
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
        precio,
        vigente_desde: vigenteDesde,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    precioIds.push(id);
    return id;
  };

  const sembrarCliente = async (
    nombre: string,
    sucursalId: string,
  ): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `${nombre} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        pct_comision: '3.50',
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  /** Ventas del PORTAL de las fechas de este archivo (de cualquier cliente), sus cobros, lineas y contador OF. */
  const limpiarVentas = async () => {
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('origen', '=', 'portal')
      .where(fechaComoTexto, 'in', FECHAS);
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('origen', '=', 'portal')
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();
    await db
      .deleteFrom('folio_oficina_contador')
      .where('sucursal_id', 'in', [tjId, mxId])
      .where(fechaComoTexto, 'in', FECHAS)
      .execute();
  };

  /**
   * Registra por el endpoint de la parte 1. Por default: FECHA_A, clienteTj,
   * vendedorTj, credito, 24+2 de 1 L (10.00) y 5 de 500 ml (6.00) = 270.00.
   */
  const registrar = async (
    extra: Record<string, unknown> = {},
  ): Promise<VentaCreada> => {
    const cuerpo = {
      fecha: FECHA_A,
      clienteId: clienteTj,
      vendedorId: vendedorTj,
      numNota: nota(),
      contadoCredito: 'credito',
      factura: 'N/A',
      lineas: [
        { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: pre2, cantidad: 5, cantidadPromocion: 0 },
      ],
      ...extra,
    };
    const res = await request(app.getHttpServer())
      .post('/ventas')
      .set('Cookie', cookieGeneral)
      .send(cuerpo)
      .expect(201);
    return {
      ...(res.body as Omit<VentaCreada, 'numNota'>),
      numNota: cuerpo.numNota,
    };
  };

  const buscar = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/ventas?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const detalle = (cookie: string, id: string) =>
    request(app.getHttpServer()).get(`/ventas/${id}`).set('Cookie', cookie);

  const ventaPorId = (id: string) =>
    db
      .selectFrom('venta_nota')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** Un abono de COBRANZA (como el que deja un cobro de la tablet, T-20) y el status que le toca. */
  const abonar = async (ventaId: string, monto: string) => {
    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: ventaId,
        vendedor_id: vendedorTj,
        fecha_pago: FECHA_A,
        fecha_operacion: FECHA_A,
        monto,
        tipo: 'abono',
        saldo_pendiente: '0.00',
        metodo_pago: 'efectivo',
        folio: null,
        origen: 'cobro',
      })
      .execute();
    await db
      .updateTable('venta_nota')
      .set({ status: 'abonado' })
      .where('id', '=', ventaId)
      .execute();
  };

  let consecutivoTablet = 0;
  /**
   * Una venta capturada en la TABLET y subida por el push (T-16): 10 de 1 L a
   * 9.00, el precio de la nota firmada, distinto del 10.00 de la lista.
   */
  const ventaDeTablet = async (
    contadoCredito: 'contado' | 'credito' = 'credito',
  ): Promise<{ id: string; folio: string; numNota: string }> => {
    consecutivoTablet += 1;
    const folio = formarFolio('TJ', FECHA_TABLET, segmentoApp, consecutivoTablet);
    const numNota = nota();
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearerApp}`)
      .send({
        contrato: CONTRATO_ACTUAL,
        operaciones: [
          {
            clave: `ved-${SUFIJO}-${consecutivoTablet}`,
            tipo: 'venta',
            cliente_id: clienteTj,
            fecha_operacion: FECHA_TABLET,
            ocurrido_en: `${FECHA_TABLET}T14:03:22.000-07:00`,
            folio,
            datos: {
              num_nota: numNota,
              contado_credito: contadoCredito,
              factura: 'N/A',
              comentarios: null,
              lineas: [
                {
                  presentacion_id: pre1,
                  cantidad: 10,
                  cantidad_promocion: 0,
                  precio_centavos: 900,
                },
              ],
            },
          },
        ],
      })
      .expect(200);
    expect((res.body as RespuestaPush).resultados[0].estado).toBe('aplicada');
    const { id } = await db
      .selectFrom('venta_nota')
      .select('id')
      .where('folio', '=', folio)
      .executeTakeFirstOrThrow();
    return { id, folio, numNota };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;
    await limpiarVentas();

    usuarioGeneralId = await crearUsuario(
      LOGIN_GENERAL,
      'Administrador General',
      null,
    );
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Horchata e2e ${SUFIJO}` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const presentacion = async (volumen: string) =>
      (
        await db
          .insertInto('presentacion')
          .values({ producto_id: productoId, volumen })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    pre1 = await presentacion('1 L');
    pre2 = await presentacion('500 ml');
    pre3 = await presentacion('2 L');
    preSinPrecio = await presentacion('3 L');

    await sembrarPrecio(pre1, tjId, '10.00', '2024-01-01');
    await sembrarPrecio(pre2, tjId, '7.25', '2024-01-01');
    await sembrarPrecio(pre3, tjId, '15.00', PRE3_CON_PRECIO_DESDE);
    await sembrarPrecio(pre1, mxId, '20.00', '2024-01-01');

    clienteTj = await sembrarCliente('Abarrotes TJ', tjId);
    clienteTj2 = await sembrarCliente('Tienda Dos TJ', tjId);
    clienteMx = await sembrarCliente('Abarrotes MX', mxId);
    clientePrecioId = (
      await db
        .insertInto('cliente_precio')
        .values({
          cliente_id: clienteTj,
          presentacion_id: pre2,
          precio: '6.00',
          vigente_desde: '2024-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorTj = await sembrarVendedor('Ana Activa', tjId);
    vendedorTj2 = await sembrarVendedor('Dora Dos', tjId);
    vendedorTjInactivo = await sembrarVendedor('Beto Inactivo', tjId, false);
    vendedorMx = await sembrarVendedor('Carla Mexicali', mxId);

    // El vendedor de la tablet: con contrasena (entra por /auth/app/login) y
    // segmento de folio libre. Consulta GLOBAL de ocupados, como la e2e de
    // sincronizacion: mas estricta de lo necesario, pero segura.
    const ocupados = new Set(
      (
        await db
          .selectFrom('vendedor')
          .select('folio_segmento')
          .where('folio_segmento', 'is not', null)
          .where('deleted_at', 'is', null)
          .execute()
      ).map((f) => f.folio_segmento as string),
    );
    segmentoApp = asignarSegmento('Zacarias Quintero', ocupados) as string;
    vendedorApp = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_APP,
          nombre: `Zacarias App ${SUFIJO}`,
          password_hash: await app.get(PasswordService).hashear(PASSWORD),
          sucursal_id: tjId,
          folio_segmento: segmentoApp,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    bearerApp = (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN_APP, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;
  });

  afterAll(async () => {
    const clientes = [clienteTj, clienteTj2, clienteMx];
    const ventas = db
      .selectFrom('venta_nota')
      .select('id')
      .where('cliente_id', 'in', clientes);
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota_detalle')
      .where('venta_nota_id', 'in', ventas)
      .execute();
    await db
      .deleteFrom('venta_nota')
      .where('cliente_id', 'in', clientes)
      .execute();
    await limpiarVentas();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorApp)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorApp)
      .execute();
    await db
      .deleteFrom('cliente_precio')
      .where('id', '=', clientePrecioId)
      .execute();
    await db.deleteFrom('precio').where('id', 'in', precioIds).execute();
    await db.deleteFrom('cliente').where('id', 'in', clientes).execute();
    await db
      .deleteFrom('presentacion')
      .where('id', 'in', [pre1, pre2, pre3, preSinPrecio])
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [
        vendedorTj,
        vendedorTj2,
        vendedorTjInactivo,
        vendedorMx,
        vendedorApp,
      ])
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('GET /ventas (búsqueda, §3.1)', () => {
    it('por rango de fechas: la fila trae lo que pinta la tabla, por fecha descendente', async () => {
      const a = await registrar();
      const b = await registrar({ fecha: FECHA_B });

      const soloA = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(soloA.hayMas).toBe(false);
      const idsA = soloA.ventas.map((v) => v.id);
      expect(idsA).toContain(a.id);
      expect(idsA).not.toContain(b.id);
      expect(soloA.ventas.find((v) => v.id === a.id)).toEqual({
        id: a.id,
        folio: a.folio,
        fecha: FECHA_A,
        clienteId: clienteTj,
        cliente: `Abarrotes TJ ${SUFIJO}`,
        repartidor: `Ana Activa ${SUFIJO}`,
        numNota: a.numNota,
        montoCentavos: 27000,
        status: 'pendiente',
        origen: 'portal',
        saldoCentavos: 27000,
      });

      const ambas = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_B,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      const ids = ambas.ventas.map((v) => v.id);
      expect(ids.indexOf(b.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    });

    it('una venta de Oficina de contado sale sin repartidor y con saldo 0', async () => {
      const v = await registrar({ vendedorId: null, contadoCredito: 'contado' });
      const res = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(res.ventas.find((f) => f.id === v.id)).toMatchObject({
        repartidor: null,
        status: 'pagada',
        montoCentavos: 27000,
        saldoCentavos: 0,
      });
    });

    it('por cliente', async () => {
      const otra = await registrar({ clienteId: clienteTj2 });
      const delPrimero = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(delPrimero.ventas.map((v) => v.id)).not.toContain(otra.id);

      const delSegundo = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj2,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(delSegundo.ventas.map((v) => v.id)).toContain(otra.id);
    });

    it('por # de nota: sin distinguir mayúsculas ni espacios, y coincidencia exacta', async () => {
      const numNota = `NX${SUFIJO}`;
      const v = await registrar({ numNota });

      const exacta = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          numNota: `  ${numNota.toLowerCase()}  `,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(exacta.ventas.map((f) => f.id)).toEqual([v.id]);

      const parcial = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          numNota: numNota.slice(0, -1),
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(parcial.ventas).toEqual([]);
    });

    it('respeta el alcance: Tijuana no ve Mexicali, y pedir MX es 403', async () => {
      const mx = await registrar({
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      const tj = await registrar();

      const deTijuana = (
        await buscar(cookieTijuana, {
          desde: FECHA_A,
          hasta: FECHA_A,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      const idsTj = deTijuana.ventas.map((v) => v.id);
      expect(idsTj).toContain(tj.id);
      expect(idsTj).not.toContain(mx.id);

      await buscar(cookieTijuana, {
        desde: FECHA_A,
        hasta: FECHA_A,
        sucursal: 'MX',
      }).expect(403);

      const generalEnMx = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          sucursal: 'MX',
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      const idsMx = generalEnMx.ventas.map((v) => v.id);
      expect(idsMx).toContain(mx.id);
      expect(idsMx).not.toContain(tj.id);
    });

    it('no incluye ventas eliminadas', async () => {
      const v = await registrar();
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', v.id)
        .execute();
      expect((await ventaPorId(v.id)).deleted_at).not.toBeNull();

      const res = (
        await buscar(cookieGeneral, {
          desde: FECHA_A,
          hasta: FECHA_A,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(res.ventas.map((f) => f.id)).not.toContain(v.id);
    });

    it('tope de 200 filas, y avisa que hay más', async () => {
      // 201 ventas sembradas directo en la base: por el endpoint tardaria demasiado.
      const ids = (
        await db
          .insertInto('venta_nota')
          .values(
            Array.from({ length: 201 }, (_, i) => ({
              folio: `ZZ${SUFIJO}-${i}`,
              fecha: FECHA_TOPE,
              cliente_id: clienteTj2,
              vendedor_id: null,
              monto_total: '1.00',
              num_nota: `t${SUFIJO}-${i}`,
              contado_credito: 'credito',
              semana: 10,
              mes: 3,
              status: 'pendiente',
              sucursal_id: tjId,
              origen: 'portal',
              capturo_usuario_id: usuarioGeneralId,
            })),
          )
          .returning('id')
          .execute()
      ).map((f) => f.id);
      try {
        const res = (
          await buscar(cookieGeneral, {
            desde: FECHA_TOPE,
            hasta: FECHA_TOPE,
            clienteId: clienteTj2,
          }).expect(200)
        ).body as ResultadoBusquedaVentas;
        expect(res.ventas).toHaveLength(200);
        expect(res.hayMas).toBe(true);
      } finally {
        await db.deleteFrom('venta_nota').where('id', 'in', ids).execute();
      }
    });

    it('fechas inválidas son 400, no 500', async () => {
      await buscar(cookieGeneral, { desde: FECHA_B, hasta: FECHA_A }).expect(
        400,
      );
      await buscar(cookieGeneral, {
        desde: '2024-02-30',
        hasta: FECHA_A,
      }).expect(400);
      await buscar(cookieGeneral, { desde: '04/03/2024' }).expect(400);
    });

    it('basta la sesión: no exige venta.editar_eliminar', async () => {
      await buscar(cookieSinPermiso, { desde: FECHA_A, hasta: FECHA_A }).expect(
        200,
      );
    });

    it('una venta de la tablet sale con origen app y su vendedor', async () => {
      const t = await ventaDeTablet();
      const res = (
        await buscar(cookieGeneral, {
          desde: FECHA_TABLET,
          hasta: FECHA_TABLET,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(res.ventas.find((v) => v.id === t.id)).toMatchObject({
        folio: t.folio,
        origen: 'app',
        repartidor: `Zacarias App ${SUFIJO}`,
        montoCentavos: 9000,
      });
    });
  });

  describe('GET /ventas/:id (detalle, §3.2)', () => {
    it('cabecera, líneas con su precio, cobros y banderas', async () => {
      const v = await registrar({
        contadoCredito: 'contado',
        metodoPago: 'efectivo',
        comentarios: 'Entregar temprano',
      });
      const venta = (await detalle(cookieGeneral, v.id).expect(200))
        .body as VentaDetalle;
      expect(venta).toEqual({
        id: v.id,
        folio: v.folio,
        fecha: FECHA_A,
        clienteId: clienteTj,
        cliente: `Abarrotes TJ ${SUFIJO}`,
        sucursalId: tjId,
        sucursalCodigo: 'TJ',
        vendedorId: vendedorTj,
        repartidor: `Ana Activa ${SUFIJO}`,
        numNota: v.numNota,
        contadoCredito: 'contado',
        factura: 'N/A',
        comentarios: 'Entregar temprano',
        montoCentavos: 27000,
        status: 'pagada',
        origen: 'portal',
        saldoCentavos: 0,
        lineas: [
          {
            presentacionId: pre1,
            producto: `Horchata e2e ${SUFIJO}`,
            volumen: '1 L',
            cantidad: 24,
            cantidadPromocion: 2,
            precioCentavos: 1000,
            subtotalCentavos: 24000,
          },
          {
            presentacionId: pre2,
            producto: `Horchata e2e ${SUFIJO}`,
            volumen: '500 ml',
            cantidad: 5,
            cantidadPromocion: 0,
            precioCentavos: 600,
            subtotalCentavos: 3000,
          },
        ],
        cobros: [
          {
            id: expect.any(String) as string,
            fechaPago: FECHA_A,
            metodoPago: 'efectivo',
            montoCentavos: 27000,
            origen: 'venta_contado',
          },
        ],
        editable: true,
        motivoNoEditable: null,
        puedeMarcarPerdida: false,
      });
    });

    it('a crédito y sin cobros: editable y se puede marcar como cuenta perdida', async () => {
      const v = await registrar();
      const venta = (await detalle(cookieGeneral, v.id).expect(200))
        .body as VentaDetalle;
      expect(venta).toMatchObject({
        status: 'pendiente',
        saldoCentavos: 27000,
        cobros: [],
        editable: true,
        motivoNoEditable: null,
        puedeMarcarPerdida: true,
      });
    });

    it('con un abono de cobranza: no editable, con el motivo, y sí se puede marcar perdida', async () => {
      const v = await registrar();
      await abonar(v.id, '100.00');
      const venta = (await detalle(cookieGeneral, v.id).expect(200))
        .body as VentaDetalle;
      expect(venta).toMatchObject({
        status: 'abonado',
        saldoCentavos: 17000,
        editable: false,
        motivoNoEditable: MOTIVO_CON_COBROS,
        puedeMarcarPerdida: true,
      });
      expect(venta.cobros).toEqual([
        expect.objectContaining({
          montoCentavos: 10000,
          origen: 'cobro',
          metodoPago: 'efectivo',
        }),
      ]);
    });

    it('eliminada o inexistente: 404', async () => {
      const v = await registrar();
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', v.id)
        .execute();
      await detalle(cookieGeneral, v.id).expect(404);
      await detalle(cookieGeneral, randomUUID()).expect(404);
    });

    it('de otra sucursal: 403', async () => {
      const mx = await registrar({
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await detalle(cookieTijuana, mx.id).expect(403);
    });

    it('basta la sesión', async () => {
      const v = await registrar();
      await detalle(cookieSinPermiso, v.id).expect(200);
    });
  });
});
```

- [ ] **Step 6: Correrla y ver que falla**

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar.e2e-spec`
Expected: FAIL — no compila (`ventas-consulta.service` no existe).

- [ ] **Step 7: DTO de búsqueda**

Crear `apps/backend/src/modules/ventas-cobranza/dto/buscar-ventas.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { LARGO_MAX_NUM_NOTA } from '../datos-venta';
import { recortar } from './registrar-venta.dto';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /ventas` (T-17 parte 2, §3.1). Todo opcional: sin fechas, el servicio
 * usa hoy en Tijuana. Que el dia exista y que `desde <= hasta` lo decide el
 * servicio (`esFechaReal`).
 */
export class BuscarVentasDto {
  @IsOptional()
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde?: string;

  @IsOptional()
  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  clienteId?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUM_NOTA, {
    message: `El número de nota no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
  })
  numNota?: string;
}
```

- [ ] **Step 8: Repositorio de consulta**

Crear `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos } from '../sincronizacion/dinero';
import { saldoDerivadoCentavos } from './reglas-cobranza';
import type { ContadoCredito } from './reglas-venta';
import type { OrigenVenta } from './ventas.service';

/** Ya resuelto por el servicio: fechas validas y alcance aplicado. */
export interface FiltroBusquedaVentas {
  desde: string;
  hasta: string;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  sucursalCodigo: string | null;
  clienteId: string | null;
  numNota: string | null;
}

/** Una fila de la tabla de resultados (§3.1). */
export interface VentaEncontrada {
  id: string;
  folio: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  clienteId: string;
  cliente: string;
  /** Nombre del vendedor; `null` = Oficina. */
  repartidor: string | null;
  numNota: string;
  montoCentavos: number;
  status: string;
  origen: OrigenVenta;
  /** Monto menos abonos vivos (D7 de T-20), nunca negativo. */
  saldoCentavos: number;
}

export interface CabeceraVenta {
  id: string;
  folio: string;
  fecha: string;
  clienteId: string;
  cliente: string;
  sucursalId: string;
  sucursalCodigo: string;
  vendedorId: string | null;
  repartidor: string | null;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: string;
  comentarios: string | null;
  montoCentavos: number;
  status: string;
  origen: OrigenVenta;
}

export interface LineaDeVenta {
  presentacionId: string;
  producto: string;
  volumen: string;
  cantidad: number;
  cantidadPromocion: number;
  /** El guardado: el de la nota firmada (tablet) o el de la lista a la fecha (portal). */
  precioCentavos: number;
}

export interface CobroDeVenta {
  id: string;
  fechaPago: string;
  metodoPago: string;
  montoCentavos: number;
  origen: 'cobro' | 'venta_contado';
}

/**
 * Lecturas de la busqueda y el detalle de ventas del portal (T-17 parte 2).
 *
 * Solo ventas VIVAS: una eliminada no sale en la busqueda y su detalle es 404.
 * Las fechas salen con `to_char`: un `date` leido como `Date` se corre un dia
 * segun el huso del proceso.
 */
@Injectable()
export class VentasConsultaRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Por fecha descendente y luego folio. `limite` lo fija el servicio (tope + 1,
   * para saber si hay mas).
   *
   * El # de nota se compara como lo compara el indice unico de #95
   * (`lower(btrim(...))`): "buscar la 1234" encuentra exactamente la nota que
   * el indice no deja repetir. Coincidencia exacta, no parcial.
   */
  async buscar(
    filtro: FiltroBusquedaVentas,
    limite: number,
  ): Promise<VentaEncontrada[]> {
    const condiciones = [
      sql`vn.deleted_at is null`,
      sql`vn.fecha between ${filtro.desde}::date and ${filtro.hasta}::date`,
    ];
    if (filtro.sucursalCodigo !== null)
      condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);
    if (filtro.clienteId !== null)
      condiciones.push(sql`vn.cliente_id = ${filtro.clienteId}::uuid`);
    if (filtro.numNota !== null)
      condiciones.push(
        sql`lower(btrim(vn.num_nota)) = lower(btrim(${filtro.numNota}))`,
      );

    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      cliente_id: string;
      cliente: string;
      repartidor: string | null;
      num_nota: string;
      monto_total: string;
      status: string;
      origen: string;
      abonado: string;
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, c.nombre as cliente, v.nombre as repartidor,
             vn.num_nota, vn.monto_total, vn.status, vn.origen,
             coalesce(a.abonado, 0)::text as abonado
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = vn.sucursal_id
        left join vendedor v on v.id = vn.vendedor_id
        left join lateral (
          select sum(ca.monto) as abonado
            from cobranza_abono ca
           where ca.venta_nota_id = vn.id
             and ca.deleted_at is null
        ) a on true
       where ${sql.join(condiciones, sql` and `)}
       order by vn.fecha desc, vn.folio
       limit ${limite}
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      repartidor: f.repartidor,
      numNota: f.num_nota,
      montoCentavos: aCentavos(f.monto_total),
      status: f.status,
      origen: f.origen as OrigenVenta,
      saldoCentavos: saldoDerivadoCentavos(
        aCentavos(f.monto_total),
        aCentavos(f.abonado),
      ),
    }));
  }

  /** La cabecera de una venta VIVA, o `undefined`. */
  async cabecera(id: string): Promise<CabeceraVenta | undefined> {
    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      cliente_id: string;
      cliente: string;
      sucursal_id: string;
      sucursal_codigo: string;
      vendedor_id: string | null;
      repartidor: string | null;
      num_nota: string;
      contado_credito: string;
      factura: string | null;
      comentarios: string | null;
      monto_total: string;
      status: string;
      origen: string;
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, c.nombre as cliente, vn.sucursal_id,
             s.codigo as sucursal_codigo, vn.vendedor_id,
             v.nombre as repartidor, vn.num_nota, vn.contado_credito,
             vn.factura, vn.comentarios, vn.monto_total, vn.status, vn.origen
        from venta_nota vn
        join cliente c on c.id = vn.cliente_id
        join sucursal s on s.id = vn.sucursal_id
        left join vendedor v on v.id = vn.vendedor_id
       where vn.id = ${id}
         and vn.deleted_at is null
    `.execute(this.db);

    const f = filas.rows[0];
    if (!f) return undefined;
    return {
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.sucursal_codigo,
      vendedorId: f.vendedor_id,
      repartidor: f.repartidor,
      numNota: f.num_nota,
      contadoCredito: f.contado_credito as ContadoCredito,
      factura: f.factura ?? 'N/A',
      comentarios: f.comentarios,
      montoCentavos: aCentavos(f.monto_total),
      status: f.status,
      origen: f.origen as OrigenVenta,
    };
  }

  /** Lineas vivas, por producto y volumen. */
  async lineas(id: string): Promise<LineaDeVenta[]> {
    const filas = await this.db
      .selectFrom('venta_nota_detalle as d')
      .innerJoin('presentacion as pr', 'pr.id', 'd.presentacion_id')
      .innerJoin('producto as p', 'p.id', 'pr.producto_id')
      .select([
        'd.presentacion_id',
        'p.nombre as producto',
        'pr.volumen',
        'd.cantidad',
        'd.cantidad_promocion',
        'd.precio',
      ])
      .where('d.venta_nota_id', '=', id)
      .where('d.deleted_at', 'is', null)
      .orderBy('p.nombre')
      .orderBy('pr.volumen')
      .execute();
    return filas.map((f) => ({
      presentacionId: f.presentacion_id,
      producto: f.producto,
      volumen: f.volumen,
      cantidad: f.cantidad,
      cantidadPromocion: f.cantidad_promocion,
      precioCentavos: aCentavos(f.precio),
    }));
  }

  /** Abonos vivos (el cobro de contado y los de cobranza), por fecha de pago. */
  async cobros(id: string): Promise<CobroDeVenta[]> {
    const filas = await sql<{
      id: string;
      fecha_pago: string;
      metodo_pago: string;
      monto: string;
      origen: string;
    }>`
      select id, to_char(fecha_pago, 'YYYY-MM-DD') as fecha_pago,
             metodo_pago, monto, origen
        from cobranza_abono
       where venta_nota_id = ${id}
         and deleted_at is null
       order by fecha_pago, created_at
    `.execute(this.db);
    return filas.rows.map((f) => ({
      id: f.id,
      fechaPago: f.fecha_pago,
      metodoPago: f.metodo_pago,
      montoCentavos: aCentavos(f.monto),
      origen: f.origen as CobroDeVenta['origen'],
    }));
  }
}
```

- [ ] **Step 9: Servicio de consulta**

Crear `apps/backend/src/modules/ventas-cobranza/ventas-consulta.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { accionesDeVenta, type AccionesVenta } from './acciones-venta';
import { exigirAlcanceSobre } from './alcance-venta';
import type { BuscarVentasDto } from './dto/buscar-ventas.dto';
import { saldoDerivadoCentavos } from './reglas-cobranza';
import { esFechaReal } from './venta-portal';
import {
  VentasConsultaRepository,
  type CabeceraVenta,
  type CobroDeVenta,
  type LineaDeVenta,
  type VentaEncontrada,
} from './ventas-consulta.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

/** §3.1: mas filas que esto no caben en una pantalla util; se pide acotar. */
export const TOPE_BUSQUEDA_VENTAS = 200;

export interface ResultadoBusquedaVentas {
  ventas: VentaEncontrada[];
  /** Habia mas de `TOPE_BUSQUEDA_VENTAS`: la pantalla pide acotar el rango. */
  hayMas: boolean;
}

export interface LineaDetalleVenta extends LineaDeVenta {
  subtotalCentavos: number;
}

/** El detalle de §3.2 y lo que devuelven PATCH y la cuenta perdida. */
export interface VentaDetalle extends CabeceraVenta, AccionesVenta {
  saldoCentavos: number;
  lineas: LineaDetalleVenta[];
  cobros: CobroDeVenta[];
}

/** Busqueda y detalle de ventas en el portal (T-17 parte 2, §3.1-§3.2). */
@Injectable()
export class VentasConsultaService {
  constructor(
    private readonly repo: VentasConsultaRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async buscar(
    usuarioId: string,
    consulta: BuscarVentasDto,
  ): Promise<ResultadoBusquedaVentas> {
    const hoy = hoyEnTijuana();
    const desde = consulta.desde ?? hoy;
    const hasta = consulta.hasta ?? hoy;
    if (!esFechaReal(desde) || !esFechaReal(hasta))
      throw new BadRequestException('Esa fecha no existe.');
    if (desde > hasta)
      throw new BadRequestException(
        'La fecha "desde" no puede ser posterior a "hasta".',
      );

    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    // Mismo patron que los catalogos: el query param es solo preferencia;
    // pedir una sucursal ajena por nombre es 403.
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(consulta.sucursal),
    );

    const filas = await this.repo.buscar(
      {
        desde,
        hasta,
        sucursalCodigo: alcance.tipo === 'todas' ? null : alcance.codigo,
        clienteId: consulta.clienteId?.toLowerCase() ?? null,
        numNota: consulta.numNota || null,
      },
      TOPE_BUSQUEDA_VENTAS + 1,
    );
    return {
      ventas: filas.slice(0, TOPE_BUSQUEDA_VENTAS),
      hayMas: filas.length > TOPE_BUSQUEDA_VENTAS,
    };
  }

  async detalle(usuarioId: string, id: string): Promise<VentaDetalle> {
    const cabecera = await this.repo.cabecera(id);
    if (!cabecera) throw new NotFoundException('No existe esa venta.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      cabecera.sucursalCodigo,
    );
    return this.completar(cabecera);
  }

  /** Lineas, cobros, saldo y banderas: lo mismo para el detalle y tras una escritura. */
  private async completar(cabecera: CabeceraVenta): Promise<VentaDetalle> {
    const [lineas, cobros] = await Promise.all([
      this.repo.lineas(cabecera.id),
      this.repo.cobros(cabecera.id),
    ]);
    const abonado = cobros.reduce((t, c) => t + c.montoCentavos, 0);
    const deCobranza = cobros.filter((c) => c.origen === 'cobro').length;
    return {
      ...cabecera,
      saldoCentavos: saldoDerivadoCentavos(cabecera.montoCentavos, abonado),
      lineas: lineas.map((l) => ({
        ...l,
        subtotalCentavos: l.cantidad * l.precioCentavos,
      })),
      cobros,
      ...accionesDeVenta(cabecera.status, deCobranza),
    };
  }
}
```

- [ ] **Step 10: Controller y módulo**

En `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`:

1. Reemplazar la importación de `@nestjs/common` por:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
```

2. Agregar a las importaciones locales:

```ts
import { BuscarVentasDto } from './dto/buscar-ventas.dto';
import {
  VentasConsultaService,
  type ResultadoBusquedaVentas,
  type VentaDetalle,
} from './ventas-consulta.service';
```

3. Reemplazar el constructor por:

```ts
  constructor(
    private readonly ventas: VentasPortalService,
    // T-17 parte 2: busqueda y detalle.
    private readonly consulta: VentasConsultaService,
  ) {}
```

4. Agregar **al final de la clase** (después de `registrar`: las rutas fijas `catalogo` y `repartidores` tienen que declararse antes que `:id`):

```ts
  /** §3.1: basta la sesion; el alcance lo aplica el servicio. */
  @Get()
  async buscar(
    @UsuarioActual() usuarioId: string,
    @Query() consulta: BuscarVentasDto,
  ): Promise<ResultadoBusquedaVentas> {
    return this.consulta.buscar(usuarioId, consulta);
  }

  @Get(':id')
  async detalle(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VentaDetalle> {
    return this.consulta.detalle(usuarioId, id);
  }
```

En `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`, agregar las importaciones

```ts
import { VentasConsultaRepository } from './ventas-consulta.repository';
import { VentasConsultaService } from './ventas-consulta.service';
```

y en `providers`, después de `VentasPortalRepository,`:

```ts
    VentasConsultaService,
    VentasConsultaRepository,
```

- [ ] **Step 11: Correr la e2e**

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar.e2e-spec`
Expected: PASS (16 pruebas).

- [ ] **Step 12: Lint, build, unit y e2e de ventas**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- ventas.e2e-spec ventas-editar.e2e-spec
git status --short
```

Expected: todo en verde; `git status` solo muestra los archivos de esta tarea.

- [ ] **Step 13: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza apps/backend/test/ventas-editar.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: buscar ventas y ver su detalle con banderas de edicion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Editar — `PATCH /ventas/:id`

**Files:**
- Create: `apps/backend/src/modules/ventas-cobranza/edicion-venta.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/edicion-venta.spec.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts` (base `CamposVentaDto`)
- Create: `apps/backend/src/modules/ventas-cobranza/dto/editar-venta.dto.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts`
- Create: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.service.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.service.ts` (agrega `leerDetalle`)
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`
- Test: `apps/backend/test/ventas-editar.e2e-spec.ts`

**Interfaces:**
- Consumes (Task 2): `bloqueoDeEdicion`, `exigirAlcanceSobre`, `VentasConsultaService`, `VentaDetalle`; e2e: `registrar`, `abonar`, `ventaPorId`, `ventaDeTablet`, `nota`, datos sembrados. De la parte 1: `normalizarDatosVenta`, `revisarLineas`, `montoTotalCentavos`, `statusInicial`, `VentasRepository.insertarDetalle`, `CobranzasRepository.insertarAbono`, `PreciosRepository.presentacionesConPrecio`, `VentasPortalRepository.enTransaccion/buscarSucursalUsuario/esRepartidorActivo`, `esNotaDuplicada`, `motivoNotaDuplicada`, `VentaRechazada`, tipos `EntradaVentaPortal`/`ResultadoVentaPortal` de `venta-portal.ts`.
- Produces:
  - En `edicion-venta.ts`: `interface LineaGuardada { id: string; presentacionId: string; cantidad: number; cantidadPromocion: number; precioCentavos: number }`, `armarVentaEditada(entrada: EntradaVentaPortal, guardadas: readonly LineaGuardada[], precios: ReadonlyMap<string, number | null>, fecha: string): ResultadoVentaPortal`, `pctComisionTrasEdicion(antes: { vendedorId: string | null; pctComision: string | null }, vendedorNuevo: string | null, pctActualDelCliente: string | null): string | null`, `interface PlanDetalle { borrar: string[]; actualizar: { id: string; cantidad: number; cantidadPromocion: number; precioCentavos: number }[]; insertar: LineaVentaNormalizada[] }`, `planDetalle(guardadas, nuevas): PlanDetalle`.
  - `CamposVentaDto` (base de `RegistrarVentaDto`) y `EditarVentaDto extends CamposVentaDto`.
  - `VentasEdicionRepository` (sin estado; todo recibe `trx`): `bloquearVenta(id, trx): Promise<VentaBloqueada | undefined>`, `abonosDeCobroVivos(id, trx): Promise<number>`, `lineasGuardadas(id, trx): Promise<LineaGuardada[]>`, `metodoCobroContado(id, trx): Promise<MetodoPagoContado | undefined>`, `pctComisionDelCliente(clienteId, trx): Promise<string | null>`, `actualizarCabecera(id, cambios: CambiosCabecera, trx)`, `borrarLineas(ids, trx)`, `actualizarLineas(lineas, trx)`, `borrarCobroContado(id, trx)`; interfaz `VentaBloqueada { id; folio; fecha; clienteId; vendedorId: string | null; sucursalId; sucursalCodigo; status; origen: OrigenVenta; pctComision: string | null }`.
  - `VentasEdicionService.editar(usuarioId, id, dto: EditarVentaDto): Promise<VentaDetalle>` y el privado `bloquearConAlcance(usuarioId, id, trx): Promise<VentaBloqueada>` (lo reutiliza la Task 4).
  - `VentasConsultaService.leerDetalle(id: string): Promise<VentaDetalle>` (sin alcance; 404 si no existe).
  - En la e2e: helpers top-level `lineasDe(id)` y `cobrosDe(id)` (los usa la Task 4).

- [ ] **Step 1: Pruebas puras que fallan**

Crear `apps/backend/src/modules/ventas-cobranza/edicion-venta.spec.ts`:

```ts
import {
  armarVentaEditada,
  pctComisionTrasEdicion,
  planDetalle,
  type LineaGuardada,
} from './edicion-venta';

const CLIENTE = '0b7f5e2a-3c1d-4e8f-9a6b-1c2d3e4f5a6b';
const PRE_A = '5f3c1a2b-7d8e-4f90-a1b2-c3d4e5f60718';
const PRE_B = '6a4d2b3c-8e9f-4a01-b2c3-d4e5f6071829';
const PRE_SIN = '7b5e3c4d-9fa0-4b12-83d4-e5f60718293a';
const PRE_BAJA = '8c6f4d5e-a0b1-4c23-94e5-f60718293a4b';

/** La lista del cliente HOY a la fecha de la venta: PRE_A subio a 11.00. */
const precios = new Map<string, number | null>([
  [PRE_A, 1100],
  [PRE_B, 600],
  [PRE_SIN, null],
]);

const guardada = (
  presentacionId: string,
  precioCentavos: number,
  cantidad = 24,
  cantidadPromocion = 0,
): LineaGuardada => ({
  id: `linea-${presentacionId.slice(0, 4)}`,
  presentacionId,
  cantidad,
  cantidadPromocion,
  precioCentavos,
});

const entrada = (
  lineas: { presentacionId: string; cantidad: number; cantidadPromocion: number }[],
) => ({
  clienteId: CLIENTE,
  numNota: '1234',
  contadoCredito: 'credito' as const,
  factura: 'N/A' as const,
  comentarios: null,
  lineas,
});

describe('armarVentaEditada: precios de una edicion (T-17 parte 2, §4.2 paso 4)', () => {
  it('una linea existente conserva su precio guardado aunque la lista haya cambiado', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_A, cantidad: 3, cantidadPromocion: 1 }]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r).toEqual({
      ok: true,
      venta: expect.objectContaining({
        lineas: [
          {
            presentacionId: PRE_A,
            cantidad: 3,
            cantidadPromocion: 1,
            precioCentavos: 1000,
          },
        ],
      }) as unknown,
    });
  });

  it('una presentacion nueva toma el precio de la lista a la fecha', () => {
    const r = armarVentaEditada(
      entrada([
        { presentacionId: PRE_A, cantidad: 1, cantidadPromocion: 0 },
        { presentacionId: PRE_B, cantidad: 4, cantidadPromocion: 0 },
      ]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas.map((l) => l.precioCentavos)).toEqual([
      1000, 600,
    ]);
  });

  // Review Focus 1
  it('una linea existente se conserva aunque su presentacion ya no se venda', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_BAJA, cantidad: 2, cantidadPromocion: 0 }]),
      [guardada(PRE_BAJA, 850)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(850);
  });

  it('una presentacion NUEVA que ya no se vende es presentacion-inactiva', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_BAJA, cantidad: 2, cantidadPromocion: 0 }]),
      [],
      precios,
      '2024-03-06',
    );
    expect(r).toMatchObject({
      ok: false,
      tipo: 'rechazo',
      rechazo: { razon: 'presentacion-inactiva' },
    });
  });

  it('una presentacion nueva con piezas y sin precio a la fecha es precio-no-asignado, con la fecha', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_SIN, cantidad: 1, cantidadPromocion: 0 }]),
      [],
      precios,
      '2024-03-06',
    );
    expect(r).toEqual({
      ok: false,
      tipo: 'rechazo',
      rechazo: {
        razon: 'precio-no-asignado',
        motivo:
          'Una de las presentaciones nuevas no tiene precio en la lista del cliente para el 2024-03-06.',
      },
    });
  });

  it('una presentacion nueva de pura promocion entra a 0 aunque no tenga precio (D13)', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 2 }]),
      [],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(0);
  });

  // Review Focus 3
  it('una linea de promocion ($0) que gana piezas vendidas toma la lista a la fecha', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_B, cantidad: 5, cantidadPromocion: 2 }]),
      [guardada(PRE_B, 0, 0, 2)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(600);
  });

  it('una linea de promocion ($0) que sigue sin piezas vendidas conserva su 0', () => {
    const r = armarVentaEditada(
      entrada([{ presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 5 }]),
      [guardada(PRE_SIN, 0, 0, 2)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0].precioCentavos).toBe(0);
  });

  it('el uuid en mayusculas encuentra su linea guardada', () => {
    const r = armarVentaEditada(
      entrada([
        { presentacionId: PRE_A.toUpperCase(), cantidad: 2, cantidadPromocion: 0 },
      ]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r.ok && r.venta.lineas[0]).toEqual({
      presentacionId: PRE_A,
      cantidad: 2,
      cantidadPromocion: 0,
      precioCentavos: 1000,
    });
  });

  it('las mismas reglas de forma que la tablet: presentacion repetida es invalido', () => {
    const r = armarVentaEditada(
      entrada([
        { presentacionId: PRE_A, cantidad: 1, cantidadPromocion: 0 },
        { presentacionId: PRE_A, cantidad: 2, cantidadPromocion: 0 },
      ]),
      [guardada(PRE_A, 1000)],
      precios,
      '2024-03-06',
    );
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
  });
});

describe('pctComisionTrasEdicion (§4.2 paso 6)', () => {
  const VENDEDOR = 'a1a1a1a1-0000-4000-8000-000000000001';
  const OTRO = 'b2b2b2b2-0000-4000-8000-000000000002';

  it('mismo vendedor: conserva el % congelado', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: VENDEDOR, pctComision: '3.50' },
        VENDEDOR,
        '4.25',
      ),
    ).toBe('3.50');
  });

  it('pasa a Oficina: null', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: VENDEDOR, pctComision: '3.50' },
        null,
        '4.25',
      ),
    ).toBeNull();
  });

  it('de Oficina a un vendedor: el % actual del cliente', () => {
    expect(
      pctComisionTrasEdicion({ vendedorId: null, pctComision: null }, VENDEDOR, '4.25'),
    ).toBe('4.25');
  });

  it('de un vendedor a otro: el % actual del cliente', () => {
    expect(
      pctComisionTrasEdicion(
        { vendedorId: VENDEDOR, pctComision: '3.50' },
        OTRO,
        '4.25',
      ),
    ).toBe('4.25');
  });

  it('Oficina sigue en Oficina: null', () => {
    expect(
      pctComisionTrasEdicion({ vendedorId: null, pctComision: null }, null, '4.25'),
    ).toBeNull();
  });
});

describe('planDetalle (§4.2 paso 7)', () => {
  it('borra las que ya no vienen, actualiza las que siguen e inserta las nuevas', () => {
    const plan = planDetalle(
      [guardada(PRE_A, 1000), guardada(PRE_B, 600)],
      [
        { presentacionId: PRE_A, cantidad: 3, cantidadPromocion: 1, precioCentavos: 1000 },
        { presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 2, precioCentavos: 0 },
      ],
    );
    expect(plan).toEqual({
      borrar: [`linea-${PRE_B.slice(0, 4)}`],
      actualizar: [
        {
          id: `linea-${PRE_A.slice(0, 4)}`,
          cantidad: 3,
          cantidadPromocion: 1,
          precioCentavos: 1000,
        },
      ],
      insertar: [
        { presentacionId: PRE_SIN, cantidad: 0, cantidadPromocion: 2, precioCentavos: 0 },
      ],
    });
  });
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `npm test --workspace=apps/backend -- edicion-venta.spec`
Expected: FAIL — `./edicion-venta` no existe.

- [ ] **Step 3: Implementar lo puro**

Crear `apps/backend/src/modules/ventas-cobranza/edicion-venta.ts`:

```ts
import {
  normalizarDatosVenta,
  type LineaVentaNormalizada,
} from './datos-venta';
import { revisarLineas } from './reglas-venta';
import type { EntradaVentaPortal, ResultadoVentaPortal } from './venta-portal';

/**
 * Reglas puras de la EDICION de una venta desde el portal (T-17 parte 2, §4.2).
 * Puras por el mismo criterio que `venta-portal.ts`: deciden, y se prueban sin
 * Postgres. Las usa `VentasEdicionService`.
 */

/** Una linea viva tal como esta guardada. */
export interface LineaGuardada {
  id: string;
  /** uuid en minusculas (lo devuelve Postgres). */
  presentacionId: string;
  cantidad: number;
  cantidadPromocion: number;
  precioCentavos: number;
}

/**
 * Arma la venta editada (§4.2 paso 4).
 *
 * - Una presentacion que YA estaba en la venta conserva su precio guardado: es
 *   el de la nota firmada (§2). No se le exige seguir vendiendose: corregir otra
 *   linea no puede fallar porque esta se dio de baja despues.
 * - Excepcion: una linea guardada de pura promocion ($0) que ahora trae piezas
 *   vendidas se trata como NUEVA. Venderlas a $0 seria regalar, y regalar va en
 *   `cantidad_promocion` (D13); su precio sale de la lista.
 * - Una presentacion nueva toma el precio de la lista del cliente A LA FECHA
 *   DE LA VENTA (`precios`, sin `vigenteHastaHoy`) con las mismas reglas que el
 *   alta (`revisarLineas`): que se venda, y precio si trae piezas.
 * - Despues, las MISMAS reglas de forma que la tablet (`normalizarDatosVenta`).
 */
export function armarVentaEditada(
  entrada: EntradaVentaPortal,
  guardadas: readonly LineaGuardada[],
  precios: ReadonlyMap<string, number | null>,
  fecha: string,
): ResultadoVentaPortal {
  const porPresentacion = new Map(guardadas.map((g) => [g.presentacionId, g]));
  // El mapa viene en minusculas (uuid de Postgres); el DTO acepta mayusculas.
  const lineas = entrada.lineas.map((l) => ({
    ...l,
    presentacionId: l.presentacionId.toLowerCase(),
  }));

  /** El precio guardado que se conserva, o `undefined` si la linea se trata como nueva. */
  const precioConservado = (l: {
    presentacionId: string;
    cantidad: number;
  }): number | undefined => {
    const g = porPresentacion.get(l.presentacionId);
    if (!g) return undefined;
    return g.precioCentavos > 0 || l.cantidad === 0 ? g.precioCentavos : undefined;
  };

  const nuevas = lineas.filter((l) => precioConservado(l) === undefined);
  const rechazo = revisarLineas(nuevas, precios);
  if (rechazo) {
    return {
      ok: false,
      tipo: 'rechazo',
      // El motivo de `revisarLineas` le habla a la tablet; a la oficina se le
      // dice que falta en la lista, y de que fecha.
      rechazo:
        rechazo.razon === 'precio-no-asignado'
          ? {
              razon: rechazo.razon,
              motivo: `Una de las presentaciones nuevas no tiene precio en la lista del cliente para el ${fecha}.`,
            }
          : rechazo,
    };
  }

  const r = normalizarDatosVenta(entrada.clienteId, {
    num_nota: entrada.numNota,
    contado_credito: entrada.contadoCredito,
    factura: entrada.factura,
    comentarios: entrada.comentarios,
    lineas: lineas.map((l) => ({
      presentacion_id: l.presentacionId,
      cantidad: l.cantidad,
      cantidad_promocion: l.cantidadPromocion,
      precio_centavos:
        precioConservado(l) ?? precios.get(l.presentacionId) ?? 0,
    })),
  });
  if (!r.ok) return { ok: false, tipo: 'invalido', motivo: r.motivo };
  return { ok: true, venta: r.venta };
}

/**
 * El % de comision congelado tras la edicion (§4.2 paso 6). Se compara en
 * minusculas: el DTO acepta uuid en mayusculas.
 */
export function pctComisionTrasEdicion(
  antes: { vendedorId: string | null; pctComision: string | null },
  vendedorNuevo: string | null,
  pctActualDelCliente: string | null,
): string | null {
  if (vendedorNuevo === null) return null;
  if (vendedorNuevo.toLowerCase() === antes.vendedorId?.toLowerCase())
    return antes.pctComision;
  return pctActualDelCliente;
}

export interface PlanDetalle {
  /** Ids de las lineas que ya no vienen: se marcan `deleted_at`. */
  borrar: string[];
  actualizar: {
    id: string;
    cantidad: number;
    cantidadPromocion: number;
    precioCentavos: number;
  }[];
  insertar: LineaVentaNormalizada[];
}

/** §4.2 paso 7. Requiere el indice parcial de la Task 1 para reinsertar una presentacion quitada antes. */
export function planDetalle(
  guardadas: readonly LineaGuardada[],
  nuevas: readonly LineaVentaNormalizada[],
): PlanDetalle {
  const porPresentacion = new Map(guardadas.map((g) => [g.presentacionId, g]));
  const siguen = new Set(nuevas.map((n) => n.presentacionId));
  const plan: PlanDetalle = {
    borrar: guardadas
      .filter((g) => !siguen.has(g.presentacionId))
      .map((g) => g.id),
    actualizar: [],
    insertar: [],
  };
  for (const n of nuevas) {
    const g = porPresentacion.get(n.presentacionId);
    if (g) {
      plan.actualizar.push({
        id: g.id,
        cantidad: n.cantidad,
        cantidadPromocion: n.cantidadPromocion,
        precioCentavos: n.precioCentavos,
      });
    } else {
      plan.insertar.push(n);
    }
  }
  return plan;
}
```

- [ ] **Step 4: Correr las pruebas puras**

Run: `npm test --workspace=apps/backend -- edicion-venta.spec`
Expected: PASS (16 pruebas).

- [ ] **Step 5: DTOs**

En `apps/backend/src/modules/ventas-cobranza/dto/registrar-venta.dto.ts`, reemplazar la clase `RegistrarVentaDto` completa (con su comentario) por estas dos:

```ts
/**
 * Lo que se captura de una venta en el portal, al registrarla y al editarla
 * (T-17). Las reglas de fondo (presentacion repetida, linea en 0, precio a la
 * fecha) las decide el servicio con las mismas funciones que la tablet; aqui
 * solo la forma.
 */
export class CamposVentaDto {
  // Obligatorio, pero puede ser `null`: null es "Oficina" (venta de
  // mostrador). Ausente no es lo mismo que Oficina, y se rechaza.
  @ValidateIf((o: CamposVentaDto) => o.vendedorId !== null)
  @IsUUID(undefined, {
    message: 'Elige el repartidor: un vendedor, u Oficina.',
  })
  vendedorId!: string | null;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El número de nota es obligatorio.' })
  @MaxLength(LARGO_MAX_NUM_NOTA, {
    message: `El número de nota no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
  })
  numNota!: string;

  @IsIn(['contado', 'credito'], {
    message: 'La venta debe ser de contado o de crédito.',
  })
  contadoCredito!: 'contado' | 'credito';

  /** Solo cuenta en contado; por default transferencia (§2). */
  @IsOptional()
  @IsIn(['transferencia', 'efectivo'], {
    message: 'El método de pago debe ser transferencia o efectivo.',
  })
  metodoPago?: 'transferencia' | 'efectivo';

  /** Asignar el numero de factura es T-19. */
  @IsIn(['N/A', 'pendiente'], {
    message: 'La factura solo puede ser N/A o pendiente.',
  })
  factura!: 'N/A' | 'pendiente';

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_COMENTARIOS, {
    message: `Los comentarios no pueden pasar de ${LARGO_MAX_COMENTARIOS} caracteres.`,
  })
  comentarios?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Captura al menos un producto.' })
  @ArrayMaxSize(MAX_LINEAS_VENTA, {
    message: `Una venta no puede traer más de ${MAX_LINEAS_VENTA} productos.`,
  })
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas!: LineaVentaDto[];
}

/** `POST /ventas` (T-17, §4.2): los campos de la venta mas su fecha y su cliente. */
export class RegistrarVentaDto extends CamposVentaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  fecha!: string;

  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;
}
```

Crear `apps/backend/src/modules/ventas-cobranza/dto/editar-venta.dto.ts`:

```ts
import { CamposVentaDto } from './registrar-venta.dto';

/**
 * `PATCH /ventas/:id` (T-17 parte 2, §4.2): el ESTADO COMPLETO de lo editable.
 *
 * Sin cliente ni fecha: no se editan (si estan mal, se elimina y se registra
 * de nuevo). Sin precios: los pone el servidor; un `precioCentavos` en una
 * linea lo descarta el `whitelist` del ValidationPipe. `metodoPago` ausente en
 * contado = el del cobro de contado vigente, o transferencia.
 */
export class EditarVentaDto extends CamposVentaDto {}
```

Run: `npm run test:e2e --workspace=apps/backend -- ventas.e2e-spec`
Expected: PASS — el alta de la parte 1 valida igual con los campos heredados.

- [ ] **Step 6: Escribir la e2e de edición que falla**

En `apps/backend/test/ventas-editar.e2e-spec.ts`, agregar estos helpers **justo después** del helper `abonar` (los usa también la Task 4):

```ts
  /** Todas las lineas de la venta, vivas y borradas, en orden de alta. */
  const lineasDe = (id: string) =>
    db
      .selectFrom('venta_nota_detalle')
      .select([
        'presentacion_id',
        'cantidad',
        'cantidad_promocion',
        'precio',
        'deleted_at',
      ])
      .where('venta_nota_id', '=', id)
      .orderBy('created_at')
      .execute();

  /** Todos los abonos de la venta, vivos y borrados, en orden de alta. */
  const cobrosDe = (id: string) =>
    db
      .selectFrom('cobranza_abono')
      .select([
        'monto',
        'metodo_pago',
        'vendedor_id',
        'origen',
        'folio',
        'deleted_at',
        sql<string>`to_char(fecha_pago, 'YYYY-MM-DD')`.as('fecha_pago'),
      ])
      .where('venta_nota_id', '=', id)
      .orderBy('created_at')
      .execute();

  const vivas = <T extends { deleted_at: Date | null }>(filas: T[]) =>
    filas.filter((f) => f.deleted_at === null);
```

Y agregar este bloque **antes del `});` final** del `describe` principal:

```ts
  describe('PATCH /ventas/:id (editar, §4.2)', () => {
    const editar = (
      id: string,
      cuerpo: Record<string, unknown>,
      cookie = cookieGeneral,
    ) =>
      request(app.getHttpServer())
        .patch(`/ventas/${id}`)
        .set('Cookie', cookie)
        .send(cuerpo);

    /** El estado completo de lo editable, como lo manda la pantalla. */
    const cambios = (numNota: string, extra: Record<string, unknown> = {}) => ({
      vendedorId: vendedorTj,
      numNota,
      contadoCredito: 'credito',
      factura: 'N/A',
      lineas: [
        { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: pre2, cantidad: 5, cantidadPromocion: 0 },
      ],
      ...extra,
    });

    const pctDelCliente = (pct: string) =>
      db
        .updateTable('cliente')
        .set({ pct_comision: pct })
        .where('id', '=', clienteTj)
        .execute();

    it('cambia cantidades: recalcula monto y status, conserva lo fijo y deja quién editó', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const res = await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [{ presentacionId: pre1, cantidad: 10, cantidadPromocion: 0 }],
        }),
      ).expect(200);
      const venta = res.body as VentaDetalle;
      expect(venta).toMatchObject({
        id: v.id,
        folio: v.folio,
        fecha: FECHA_EDICION,
        clienteId: clienteTj,
        montoCentavos: 10000,
        status: 'pendiente',
        editable: true,
      });
      expect(venta.lineas).toEqual([
        expect.objectContaining({
          presentacionId: pre1,
          cantidad: 10,
          cantidadPromocion: 0,
          precioCentavos: 1000,
        }),
      ]);

      const fila = await ventaPorId(v.id);
      expect(fila).toMatchObject({
        folio: v.folio,
        cliente_id: clienteTj,
        sucursal_id: tjId,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        actualizado_por_usuario_id: usuarioGeneralId,
        monto_total: '100.00',
        status: 'pendiente',
      });
      // La linea que ya no viene queda borrada, no desaparece.
      const lineas = await lineasDe(v.id);
      expect(lineas).toHaveLength(2);
      expect(vivas(lineas).map((l) => l.presentacion_id)).toEqual([pre1]);
    });

    it('solo piezas de promoción: monto 0 y status promoción', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            lineas: [{ presentacionId: pre1, cantidad: 0, cantidadPromocion: 3 }],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta).toMatchObject({ montoCentavos: 0, status: 'promocion' });
    });

    it('conserva el precio de una línea aunque la lista cambie; una nueva toma la lista a la fecha', async () => {
      const v = await registrar({
        fecha: FECHA_CAMBIO_LISTA,
        lineas: [{ presentacionId: pre1, cantidad: 2, cantidadPromocion: 0 }],
      });
      // La lista del 1 L sube ESE MISMO dia, despues de grabada la venta.
      const subida = await sembrarPrecio(pre1, tjId, '11.00', FECHA_CAMBIO_LISTA);
      try {
        const venta = (
          await editar(
            v.id,
            cambios(v.numNota, {
              lineas: [
                { presentacionId: pre1, cantidad: 3, cantidadPromocion: 0 },
                { presentacionId: pre2, cantidad: 4, cantidadPromocion: 0 },
              ],
            }),
          ).expect(200)
        ).body as VentaDetalle;
        // 3 × 10.00 (guardado) + 4 × 6.00 (precio especial del cliente a la fecha).
        expect(venta.montoCentavos).toBe(5400);
        expect(venta.lineas.map((l) => [l.presentacionId, l.precioCentavos])).toEqual([
          [pre1, 1000],
          [pre2, 600],
        ]);
      } finally {
        await db.deleteFrom('precio').where('id', '=', subida).execute();
      }
    });

    it('una presentación nueva sin precio A LA FECHA de la venta es 409 aunque hoy sí tenga', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const res = await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [{ presentacionId: pre3, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(409);
      expect((res.body as { message: string }).message).toContain(FECHA_EDICION);
      expect((await ventaPorId(v.id)).monto_total).toBe('270.00');
    });

    it('una presentación nueva de pura promoción entra aunque no tenga precio', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            lineas: [
              { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
              { presentacionId: preSinPrecio, cantidad: 0, cantidadPromocion: 2 },
            ],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(
        venta.lineas.find((l) => l.presentacionId === preSinPrecio),
      ).toMatchObject({ precioCentavos: 0, cantidadPromocion: 2 });
    });

    it('quitar una presentación y volver a agregarla', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [{ presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 }],
        }),
      ).expect(200);
      await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [
            { presentacionId: pre1, cantidad: 24, cantidadPromocion: 2 },
            { presentacionId: pre2, cantidad: 7, cantidadPromocion: 0 },
          ],
        }),
      ).expect(200);

      const lineas = await lineasDe(v.id);
      expect(lineas.filter((l) => l.presentacion_id === pre2)).toHaveLength(2);
      expect(vivas(lineas).find((l) => l.presentacion_id === pre2)).toMatchObject({
        cantidad: 7,
        precio: '6.00',
      });
    });

    it('un precio en el cuerpo se ignora: el servidor pone el suyo', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            lineas: [
              { presentacionId: pre1, cantidad: 1, cantidadPromocion: 0, precioCentavos: 1 },
            ],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta.lineas[0].precioCentavos).toBe(1000);
    });

    it('contado → crédito quita el cobro de contado', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        contadoCredito: 'contado',
        metodoPago: 'efectivo',
      });
      const venta = (
        await editar(v.id, cambios(v.numNota)).expect(200)
      ).body as VentaDetalle;
      expect(venta).toMatchObject({
        status: 'pendiente',
        saldoCentavos: 27000,
        cobros: [],
      });
      const cobros = await cobrosDe(v.id);
      expect(cobros).toHaveLength(1);
      expect(vivas(cobros)).toEqual([]);
    });

    it('crédito → contado lo crea con el método elegido, la fecha de la venta y el repartidor', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, { contadoCredito: 'contado', metodoPago: 'efectivo' }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta).toMatchObject({ status: 'pagada', saldoCentavos: 0 });
      expect(vivas(await cobrosDe(v.id))).toEqual([
        {
          monto: '270.00',
          metodo_pago: 'efectivo',
          vendedor_id: vendedorTj,
          origen: 'venta_contado',
          folio: v.folio,
          deleted_at: null,
          fecha_pago: FECHA_EDICION,
        },
      ]);
    });

    it('contado → contado reescribe el cobro con el monto nuevo y, sin método, conserva el anterior', async () => {
      const v = await registrar({
        fecha: FECHA_EDICION,
        contadoCredito: 'contado',
        metodoPago: 'efectivo',
      });
      await editar(
        v.id,
        cambios(v.numNota, {
          contadoCredito: 'contado',
          lineas: [{ presentacionId: pre1, cantidad: 3, cantidadPromocion: 0 }],
        }),
      ).expect(200);
      const cobros = await cobrosDe(v.id);
      expect(cobros).toHaveLength(2);
      expect(vivas(cobros)).toEqual([
        expect.objectContaining({ monto: '30.00', metodo_pago: 'efectivo' }),
      ]);
    });

    it('una venta de contado que queda en $0 no deja cobro', async () => {
      const v = await registrar({ fecha: FECHA_EDICION, contadoCredito: 'contado' });
      const venta = (
        await editar(
          v.id,
          cambios(v.numNota, {
            contadoCredito: 'contado',
            lineas: [{ presentacionId: pre1, cantidad: 0, cantidadPromocion: 4 }],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      expect(venta.status).toBe('promocion');
      expect(vivas(await cobrosDe(v.id))).toEqual([]);
    });

    it('Oficina → vendedor congela el % ACTUAL del cliente', async () => {
      const v = await registrar({ fecha: FECHA_EDICION, vendedorId: null });
      expect((await ventaPorId(v.id)).pct_comision).toBeNull();
      await pctDelCliente('4.25');
      try {
        await editar(v.id, cambios(v.numNota)).expect(200);
        expect((await ventaPorId(v.id)).pct_comision).toBe('4.25');
      } finally {
        await pctDelCliente('3.50');
      }
    });

    it('mismo vendedor conserva el % congelado aunque el cliente haya cambiado', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await pctDelCliente('4.25');
      try {
        await editar(v.id, cambios(v.numNota)).expect(200);
        expect((await ventaPorId(v.id)).pct_comision).toBe('3.50');
      } finally {
        await pctDelCliente('3.50');
      }
    });

    it('de un vendedor a otro congela el % actual del cliente', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await pctDelCliente('4.25');
      try {
        await editar(v.id, cambios(v.numNota, { vendedorId: vendedorTj2 })).expect(200);
        expect(await ventaPorId(v.id)).toMatchObject({
          vendedor_id: vendedorTj2,
          pct_comision: '4.25',
        });
      } finally {
        await pctDelCliente('3.50');
      }
    });

    it('vendedor → Oficina: % en null y el cobro de contado sin cobrador', async () => {
      const v = await registrar({ fecha: FECHA_EDICION, contadoCredito: 'contado' });
      await editar(
        v.id,
        cambios(v.numNota, { vendedorId: null, contadoCredito: 'contado' }),
      ).expect(200);
      expect(await ventaPorId(v.id)).toMatchObject({
        vendedor_id: null,
        pct_comision: null,
      });
      expect(vivas(await cobrosDe(v.id))).toEqual([
        expect.objectContaining({ vendedor_id: null, metodo_pago: 'transferencia' }),
      ]);
    });

    it('un repartidor inactivo o de otra sucursal es 400', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await editar(v.id, cambios(v.numNota, { vendedorId: vendedorTjInactivo })).expect(400);
      await editar(v.id, cambios(v.numNota, { vendedorId: vendedorMx })).expect(400);
    });

    // Review Focus 2
    it('si el repartidor no cambia no se vuelve a validar, aunque ya esté inactivo', async () => {
      const v = await registrar({ fecha: FECHA_EDICION, vendedorId: vendedorTj2 });
      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', vendedorTj2)
        .execute();
      try {
        await editar(v.id, cambios(v.numNota, { vendedorId: vendedorTj2 })).expect(200);
      } finally {
        await db
          .updateTable('vendedor')
          .set({ activo: true })
          .where('id', '=', vendedorTj2)
          .execute();
      }
    });

    it('el # de nota repetido en la sucursal es 409', async () => {
      const otra = await registrar({ fecha: FECHA_EDICION, numNota: `NR${SUFIJO}` });
      const v = await registrar({ fecha: FECHA_EDICION });
      const res = await editar(
        v.id,
        cambios(` nr${SUFIJO} `),
      ).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `Ya existe la nota nr${SUFIJO} en esta sucursal.`,
      );
      expect(otra.id).not.toBe(v.id);
    });

    // Review Focus 4
    it('conservar el propio # de nota (con otras mayúsculas o espacios) no es duplicado', async () => {
      const v = await registrar({ fecha: FECHA_EDICION, numNota: `PN${SUFIJO}` });
      await editar(v.id, cambios(`  pn${SUFIJO}  `)).expect(200);
      expect((await ventaPorId(v.id)).num_nota).toBe(`pn${SUFIJO}`);
    });

    it('con abonos de cobranza es 409 y no cambia nada', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await abonar(v.id, '50.00');
      const res = await editar(
        v.id,
        cambios(v.numNota, {
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        }),
      ).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Tiene cobros registrados: no se puede editar.',
      );
      expect((await ventaPorId(v.id)).monto_total).toBe('270.00');
    });

    it('una venta marcada como cuenta perdida no se edita', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await db
        .updateTable('venta_nota')
        .set({ status: 'cuenta_perdida' })
        .where('id', '=', v.id)
        .execute();
      await editar(v.id, cambios(v.numNota)).expect(409);
    });

    it('sin permiso 403; otra sucursal 403; inexistente o eliminada 404', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await editar(v.id, cambios(v.numNota), cookieSinPermiso).expect(403);

      const mx = await registrar({
        fecha: FECHA_EDICION,
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await editar(
        mx.id,
        cambios(mx.numNota, {
          vendedorId: vendedorMx,
          lineas: [{ presentacionId: pre1, cantidad: 2, cantidadPromocion: 0 }],
        }),
        cookieTijuana,
      ).expect(403);

      await editar(randomUUID(), cambios(nota())).expect(404);
      await db
        .updateTable('venta_nota')
        .set({ deleted_at: sql`now()` })
        .where('id', '=', v.id)
        .execute();
      await editar(v.id, cambios(v.numNota)).expect(404);
    });

    it('una venta de la tablet: conserva su precio, no acepta Oficina y sigue siendo de la tablet', async () => {
      const t = await ventaDeTablet();
      const res = await editar(
        t.id,
        cambios(t.numNota, {
          vendedorId: null,
          lineas: [{ presentacionId: pre1, cantidad: 12, cantidadPromocion: 0 }],
        }),
      ).expect(400);
      expect((res.body as { message: string }).message).toBe(
        'Una venta de tablet debe tener vendedor.',
      );

      const venta = (
        await editar(
          t.id,
          cambios(t.numNota, {
            vendedorId: vendedorApp,
            lineas: [{ presentacionId: pre1, cantidad: 12, cantidadPromocion: 0 }],
          }),
        ).expect(200)
      ).body as VentaDetalle;
      // 12 × 9.00: el precio de la nota firmada, no el 10.00 de la lista.
      expect(venta).toMatchObject({ montoCentavos: 10800, origen: 'app' });
      expect(await ventaPorId(t.id)).toMatchObject({
        origen: 'app',
        vendedor_id: vendedorApp,
        capturo_usuario_id: null,
        actualizado_por_usuario_id: usuarioGeneralId,
        folio: t.folio,
      });
    });
  });
```

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar.e2e-spec`
Expected: FAIL — `PATCH /ventas/:id` responde 404 (no existe la ruta).

- [ ] **Step 7: Repositorio de edición**

Crear `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos, aPesos } from '../sincronizacion/dinero';
import type { FacturaVenta } from './datos-venta';
import type { LineaGuardada, PlanDetalle } from './edicion-venta';
import type { ContadoCredito, StatusInicial } from './reglas-venta';
import type { MetodoPagoContado, OrigenVenta } from './ventas.service';

/** La venta viva, ya bloqueada `for update`. */
export interface VentaBloqueada {
  id: string;
  folio: string;
  /** `AAAA-MM-DD` con `to_char`. */
  fecha: string;
  clienteId: string;
  vendedorId: string | null;
  sucursalId: string;
  sucursalCodigo: string;
  status: string;
  origen: OrigenVenta;
  /** Texto `numeric(5,2)` tal cual lo manda `pg`, o `null`. */
  pctComision: string | null;
}

export interface CambiosCabecera {
  vendedorId: string | null;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: FacturaVenta;
  comentarios: string | null;
  /** Texto `numeric`, ya con `aPesos`. */
  montoTotal: string;
  status: StatusInicial;
  pctComision: string | null;
  usuarioId: string;
}

/**
 * SQL de la edicion, el borrado y la cuenta perdida (T-17 parte 2).
 *
 * Como `VentasRepository`: todo metodo recibe la `trx` y ninguno abre la suya;
 * la abre `VentasEdicionService`, que bloquea la venta primero.
 */
@Injectable()
export class VentasEdicionRepository {
  /**
   * `for update OF vn`: bloquea solo la venta, no la sucursal del join. Es lo
   * que serializa la edicion contra un cobro de la tablet en vuelo, que
   * bloquea las notas del cliente con `for update` (`CobranzasRepository`).
   */
  async bloquearVenta(
    id: string,
    trx: Transaction<DB>,
  ): Promise<VentaBloqueada | undefined> {
    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      cliente_id: string;
      vendedor_id: string | null;
      sucursal_id: string;
      codigo: string;
      status: string;
      origen: string;
      pct_comision: string | null;
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, vn.vendedor_id, vn.sucursal_id, s.codigo,
             vn.status, vn.origen, vn.pct_comision
        from venta_nota vn
        join sucursal s on s.id = vn.sucursal_id
       where vn.id = ${id}
         and vn.deleted_at is null
         for update of vn
    `.execute(trx);
    const f = filas.rows[0];
    if (!f) return undefined;
    return {
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      clienteId: f.cliente_id,
      vendedorId: f.vendedor_id,
      sucursalId: f.sucursal_id,
      sucursalCodigo: f.codigo,
      status: f.status,
      origen: f.origen as OrigenVenta,
      pctComision: f.pct_comision,
    };
  }

  /** Abonos vivos de COBRANZA. El cobro automatico de contado no cuenta. */
  async abonosDeCobroVivos(id: string, trx: Transaction<DB>): Promise<number> {
    const fila = await trx
      .selectFrom('cobranza_abono')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('venta_nota_id', '=', id)
      .where('origen', '=', 'cobro')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(fila.n);
  }

  async lineasGuardadas(
    id: string,
    trx: Transaction<DB>,
  ): Promise<LineaGuardada[]> {
    const filas = await trx
      .selectFrom('venta_nota_detalle')
      .select(['id', 'presentacion_id', 'cantidad', 'cantidad_promocion', 'precio'])
      .where('venta_nota_id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    return filas.map((f) => ({
      id: f.id,
      presentacionId: f.presentacion_id,
      cantidad: f.cantidad,
      cantidadPromocion: f.cantidad_promocion,
      precioCentavos: aCentavos(f.precio),
    }));
  }

  /** El metodo del cobro de contado vivo, para conservarlo si el portal no manda otro (§4.2). */
  async metodoCobroContado(
    id: string,
    trx: Transaction<DB>,
  ): Promise<MetodoPagoContado | undefined> {
    const fila = await trx
      .selectFrom('cobranza_abono')
      .select('metodo_pago')
      .where('venta_nota_id', '=', id)
      .where('origen', '=', 'venta_contado')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const metodo = fila?.metodo_pago;
    return metodo === 'efectivo' || metodo === 'transferencia'
      ? metodo
      : undefined;
  }

  /** El % del cliente HOY (texto `numeric`), aunque el cliente este dado de baja. */
  async pctComisionDelCliente(
    clienteId: string,
    trx: Transaction<DB>,
  ): Promise<string | null> {
    const fila = await trx
      .selectFrom('cliente')
      .select('pct_comision')
      .where('id', '=', clienteId)
      .executeTakeFirst();
    return fila?.pct_comision ?? null;
  }

  /** Folio, cliente, fecha, sucursal, origen y `capturo_usuario_id` no se tocan nunca. */
  async actualizarCabecera(
    id: string,
    cambios: CambiosCabecera,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota')
      .set({
        vendedor_id: cambios.vendedorId,
        num_nota: cambios.numNota,
        contado_credito: cambios.contadoCredito,
        factura: cambios.factura,
        comentarios: cambios.comentarios,
        monto_total: cambios.montoTotal,
        status: cambios.status,
        pct_comision: cambios.pctComision,
        actualizado_por_usuario_id: cambios.usuarioId,
      })
      .where('id', '=', id)
      .execute();
  }

  async borrarLineas(ids: readonly string[], trx: Transaction<DB>): Promise<void> {
    if (ids.length === 0) return;
    await trx
      .updateTable('venta_nota_detalle')
      .set({ deleted_at: sql`now()` })
      .where('id', 'in', ids)
      .execute();
  }

  async actualizarLineas(
    lineas: PlanDetalle['actualizar'],
    trx: Transaction<DB>,
  ): Promise<void> {
    for (const l of lineas) {
      await trx
        .updateTable('venta_nota_detalle')
        .set({
          cantidad: l.cantidad,
          cantidad_promocion: l.cantidadPromocion,
          precio: aPesos(l.precioCentavos),
        })
        .where('id', '=', l.id)
        .execute();
    }
  }

  /** El cobro automatico de contado vivo, si lo hay (§4.2 paso 8). */
  async borrarCobroContado(id: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('cobranza_abono')
      .set({ deleted_at: sql`now()` })
      .where('venta_nota_id', '=', id)
      .where('origen', '=', 'venta_contado')
      .where('deleted_at', 'is', null)
      .execute();
  }
}
```

- [ ] **Step 8: Servicio de edición, `leerDetalle`, controller y módulo**

En `apps/backend/src/modules/ventas-cobranza/ventas-consulta.service.ts`, agregar este método público justo antes de `private async completar`:

```ts
  /**
   * El detalle SIN comprobar alcance: para la edicion, que ya lo comprobo
   * dentro de su transaccion. 404 si la venta ya no existe.
   */
  async leerDetalle(id: string): Promise<VentaDetalle> {
    const cabecera = await this.repo.cabecera(id);
    if (!cabecera) throw new NotFoundException('No existe esa venta.');
    return this.completar(cabecera);
  }
```

Crear `apps/backend/src/modules/ventas-cobranza/ventas-edicion.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { PreciosRepository } from '../cartera-clientes/precios.repository';
import { aPesos } from '../sincronizacion/dinero';
import { bloqueoDeEdicion } from './acciones-venta';
import { exigirAlcanceSobre } from './alcance-venta';
import { CobranzasRepository } from './cobranzas.repository';
import type { EditarVentaDto } from './dto/editar-venta.dto';
import {
  armarVentaEditada,
  pctComisionTrasEdicion,
  planDetalle,
} from './edicion-venta';
import { esNotaDuplicada, motivoNotaDuplicada } from './nota-duplicada';
import { montoTotalCentavos, statusInicial } from './reglas-venta';
import { VentaRechazada } from './venta-rechazada';
import {
  VentasConsultaService,
  type VentaDetalle,
} from './ventas-consulta.service';
import {
  VentasEdicionRepository,
  type VentaBloqueada,
} from './ventas-edicion.repository';
import { VentasPortalRepository } from './ventas-portal.repository';
import { VentasRepository } from './ventas.repository';

/**
 * Editar, eliminar y marcar como cuenta perdida una venta desde el portal
 * (T-17 parte 2, §4.2-§4.4). Vale para ventas de la tablet y del portal: es la
 * via de correccion de todas.
 *
 * Cada operacion es UNA transaccion que empieza bloqueando la venta
 * (`for update`) y comprobando el alcance. El monto y el status se recalculan
 * con las reglas compartidas (`reglas-venta.ts`), como en el alta.
 */
@Injectable()
export class VentasEdicionService {
  constructor(
    private readonly repo: VentasEdicionRepository,
    private readonly portal: VentasPortalRepository,
    private readonly precios: PreciosRepository,
    private readonly ventas: VentasRepository,
    private readonly cobranzas: CobranzasRepository,
    private readonly consulta: VentasConsultaService,
  ) {}

  /** §4.2. Manda el ESTADO COMPLETO de lo editable. */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarVentaDto,
  ): Promise<VentaDetalle> {
    try {
      await this.portal.enTransaccion(async (trx) => {
        const venta = await this.bloquearConAlcance(usuarioId, id, trx);

        const bloqueo = bloqueoDeEdicion(
          venta.status,
          await this.repo.abonosDeCobroVivos(id, trx),
          'editar',
        );
        if (bloqueo) throw new ConflictException(bloqueo);

        const vendedorNuevo = dto.vendedorId?.toLowerCase() ?? null;
        if (vendedorNuevo === null && venta.origen === 'app') {
          throw new BadRequestException(
            'Una venta de tablet debe tener vendedor.',
          );
        }
        // Si no cambia, no se re-valida: la venta ya lo tiene, y un vendedor
        // dado de baja despues no puede impedir corregir sus ventas.
        if (
          vendedorNuevo !== null &&
          vendedorNuevo !== venta.vendedorId &&
          !(await this.portal.esRepartidorActivo(
            vendedorNuevo,
            venta.sucursalId,
            trx,
          ))
        ) {
          throw new BadRequestException(
            'El repartidor elegido no es un vendedor activo de la sucursal de la venta.',
          );
        }

        const guardadas = await this.repo.lineasGuardadas(id, trx);
        // Sin `vigenteHastaHoy`: una linea nueva vale lo que valia el dia de la venta.
        const precios = await this.precios.presentacionesConPrecio(
          venta.clienteId,
          venta.fecha,
          trx,
        );
        const armada = armarVentaEditada(
          {
            clienteId: venta.clienteId,
            numNota: dto.numNota,
            contadoCredito: dto.contadoCredito,
            factura: dto.factura,
            comentarios: dto.comentarios ?? null,
            lineas: dto.lineas,
          },
          guardadas,
          precios,
          venta.fecha,
        );
        if (!armada.ok) {
          if (armada.tipo === 'rechazo') throw new VentaRechazada(armada.rechazo);
          throw new BadRequestException(armada.motivo);
        }

        const nueva = armada.venta;
        const monto = montoTotalCentavos(nueva.lineas);
        const pctActual =
          vendedorNuevo !== null && vendedorNuevo !== venta.vendedorId
            ? await this.repo.pctComisionDelCliente(venta.clienteId, trx)
            : null;
        const metodo =
          dto.metodoPago ??
          (await this.repo.metodoCobroContado(id, trx)) ??
          'transferencia';

        // La cabecera primero: si el # de nota choca (23505), nada mas se escribio.
        await this.repo.actualizarCabecera(
          id,
          {
            vendedorId: vendedorNuevo,
            numNota: nueva.numNota,
            contadoCredito: nueva.contadoCredito,
            factura: nueva.factura,
            comentarios: nueva.comentarios,
            montoTotal: aPesos(monto),
            status: statusInicial(nueva.contadoCredito, monto),
            pctComision: pctComisionTrasEdicion(venta, vendedorNuevo, pctActual),
            usuarioId,
          },
          trx,
        );

        const plan = planDetalle(guardadas, nueva.lineas);
        await this.repo.borrarLineas(plan.borrar, trx);
        await this.repo.actualizarLineas(plan.actualizar, trx);
        if (plan.insertar.length > 0) {
          await this.ventas.insertarDetalle(
            id,
            plan.insertar.map((l) => ({
              presentacionId: l.presentacionId,
              cantidad: l.cantidad,
              cantidadPromocion: l.cantidadPromocion,
              precio: aPesos(l.precioCentavos),
            })),
            trx,
          );
        }

        // §4.2 paso 8: el cobro de contado se reescribe siempre; una
        // promocion ($0) no se cobra. Fecha = la de la venta; cobrador = el
        // repartidor (null en Oficina).
        await this.repo.borrarCobroContado(id, trx);
        if (nueva.contadoCredito === 'contado' && monto > 0) {
          await this.cobranzas.insertarAbono(
            {
              ventaNotaId: id,
              vendedorId: vendedorNuevo,
              fechaPago: venta.fecha,
              fechaOperacion: venta.fecha,
              monto: aPesos(monto),
              tipo: 'cobranza',
              saldoPendiente: aPesos(0),
              metodoPago: metodo,
              folio: venta.folio,
              origen: 'venta_contado',
            },
            trx,
          );
        }
      });
    } catch (error) {
      // Kysely ya hizo rollback: aqui solo se traduce a HTTP.
      if (error instanceof VentaRechazada)
        throw new ConflictException(error.message);
      if (esNotaDuplicada(error)) {
        // El DTO ya recorto el # de nota: es el mismo texto que choco.
        throw new ConflictException(motivoNotaDuplicada(dto.numNota));
      }
      throw error;
    }
    return this.consulta.leerDetalle(id);
  }

  /** 404 si no existe o esta eliminada; 403 si su sucursal es ajena. */
  private async bloquearConAlcance(
    usuarioId: string,
    id: string,
    trx: Transaction<DB>,
  ): Promise<VentaBloqueada> {
    const venta = await this.repo.bloquearVenta(id, trx);
    if (!venta) throw new NotFoundException('No existe esa venta.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      venta.sucursalCodigo,
    );
    return venta;
  }
}
```

En `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`:

1. Agregar `Patch` a la importación de `@nestjs/common` (orden alfabético: `…, ParseUUIDPipe, Patch, Post, Query`).
2. Agregar las importaciones:

```ts
import { EditarVentaDto } from './dto/editar-venta.dto';
import { VentasEdicionService } from './ventas-edicion.service';
```

3. Agregar al constructor un tercer parámetro:

```ts
    // T-17 parte 2: editar, eliminar y cuenta perdida.
    private readonly edicion: VentasEdicionService,
```

4. Agregar al final de la clase:

```ts
  @Patch(':id')
  @RequierePermiso('venta.editar_eliminar')
  async editar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarVentaDto,
  ): Promise<VentaDetalle> {
    return this.edicion.editar(usuarioId, id, dto);
  }
```

En `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`, agregar las importaciones

```ts
import { VentasEdicionRepository } from './ventas-edicion.repository';
import { VentasEdicionService } from './ventas-edicion.service';
```

y en `providers`, después de `VentasConsultaRepository,`:

```ts
    VentasEdicionService,
    VentasEdicionRepository,
```

- [ ] **Step 9: Correr la e2e**

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar.e2e-spec`
Expected: PASS (16 de la Task 2 + 23 de edición).

- [ ] **Step 10: Lint, build, unit y e2e**

```bash
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend -- ventas.e2e-spec ventas-editar.e2e-spec sincronizacion.e2e-spec
git status --short
```

Expected: todo en verde; `git status` solo con archivos de esta tarea.

- [ ] **Step 11: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza apps/backend/test/ventas-editar.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: editar una venta desde el portal (PATCH /ventas/:id)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Eliminar y marcar como cuenta perdida

**Files:**
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.service.ts`
- Modify: `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`
- Test: `apps/backend/test/ventas-editar.e2e-spec.ts`

**Interfaces:**
- Consumes (Tasks 2–3): `bloquearConAlcance`, `abonosDeCobroVivos`, `borrarCobroContado`, `bloqueoDeEdicion`, `sePuedeMarcarPerdida`, `MOTIVO_NO_PERDIBLE`, `VentasConsultaService.leerDetalle`; e2e: `registrar`, `buscar`, `detalle`, `abonar`, `ventaPorId`, `ventaDeTablet`, `lineasDe`, `cobrosDe`, `vivas`, `bearerApp`.
- Produces:
  - `VentasEdicionRepository.eliminarVenta(id, usuarioId, trx): Promise<void>` y `marcarCuentaPerdida(id, usuarioId, trx): Promise<void>`.
  - `VentasEdicionService.eliminar(usuarioId, id): Promise<void>` y `marcarCuentaPerdida(usuarioId, id): Promise<VentaDetalle>`.
  - `DELETE /ventas/:id` → **200** `{ id }` (como `DELETE /clientes/:id`); `POST /ventas/:id/cuenta-perdida` → **201** con `VentaDetalle` (como `POST /clientes/:id/convertir-a-cliente`).

- [ ] **Step 1: Escribir la e2e que falla**

En `apps/backend/test/ventas-editar.e2e-spec.ts`, cambiar la importación del contrato por:

```ts
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';
```

y agregar estos dos bloques **antes del `});` final** del `describe` principal:

```ts
  /**
   * Las notas por cobrar que baja la tablet de Tijuana (§4.5). Una nota sale de
   * su lista cuando ya no viaja con `activo: 1`: en el vuelco completo no
   * aparece o aparece con `activo: 0`, y en el incremental viaja con `activo: 0`.
   */
  const notasDeLaTablet = async (desde?: string) => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearerApp}`)
      .expect(200);
    return res.body as RespuestaPull;
  };
  const porCobrar = (pull: RespuestaPull, id: string) =>
    pull.notas_pendientes.some((n) => n.id === id && n.activo === 1);

  describe('DELETE /ventas/:id (eliminar, §4.3)', () => {
    const eliminar = (id: string, cookie = cookieGeneral) =>
      request(app.getHttpServer()).delete(`/ventas/${id}`).set('Cookie', cookie);

    it('borra la venta, sus líneas y su cobro de contado, y deja quién la eliminó', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO, contadoCredito: 'contado' });
      const res = await eliminar(v.id).expect(200);
      expect(res.body).toEqual({ id: v.id });

      const fila = await ventaPorId(v.id);
      expect(fila.deleted_at).not.toBeNull();
      expect(fila.eliminado_por_usuario_id).toBe(usuarioGeneralId);
      expect(vivas(await lineasDe(v.id))).toEqual([]);
      expect(await lineasDe(v.id)).toHaveLength(2);
      expect(vivas(await cobrosDe(v.id))).toEqual([]);
      expect(await cobrosDe(v.id)).toHaveLength(1);

      await detalle(cookieGeneral, v.id).expect(404);
      const busqueda = (
        await buscar(cookieGeneral, {
          desde: FECHA_BORRADO,
          hasta: FECHA_BORRADO,
          clienteId: clienteTj,
        }).expect(200)
      ).body as ResultadoBusquedaVentas;
      expect(busqueda.ventas.map((f) => f.id)).not.toContain(v.id);
    });

    it('libera el # de nota y no reutiliza el folio', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      await eliminar(v.id).expect(200);
      const otra = await registrar({ fecha: FECHA_BORRADO, numNota: v.numNota });
      expect(otra.folio).not.toBe(v.folio);
    });

    it('con abonos de cobranza es 409 y la venta sigue viva', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      await abonar(v.id, '20.00');
      const res = await eliminar(v.id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Tiene cobros registrados: no se puede eliminar.',
      );
      expect((await ventaPorId(v.id)).deleted_at).toBeNull();
    });

    it('sin permiso 403; otra sucursal 403; dos veces 404', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      await eliminar(v.id, cookieSinPermiso).expect(403);
      const mx = await registrar({
        fecha: FECHA_BORRADO,
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await eliminar(mx.id, cookieTijuana).expect(403);
      await eliminar(v.id).expect(200);
      await eliminar(v.id).expect(404);
    });

    it('una venta de la tablet se elimina desde el portal', async () => {
      const t = await ventaDeTablet();
      await eliminar(t.id).expect(200);
      expect(await ventaPorId(t.id)).toMatchObject({
        origen: 'app',
        eliminado_por_usuario_id: usuarioGeneralId,
      });
      expect((await ventaPorId(t.id)).deleted_at).not.toBeNull();
    });

    it('una venta a crédito eliminada deja de estar por cobrar en la tablet', async () => {
      const v = await registrar({ fecha: FECHA_BORRADO });
      expect(porCobrar(await notasDeLaTablet(), v.id)).toBe(true);
      await eliminar(v.id).expect(200);
      expect(porCobrar(await notasDeLaTablet(), v.id)).toBe(false);
    });
  });

  describe('POST /ventas/:id/cuenta-perdida (§4.4)', () => {
    const perdida = (id: string, cookie = cookieGeneral) =>
      request(app.getHttpServer())
        .post(`/ventas/${id}/cuenta-perdida`)
        .set('Cookie', cookie);

    it('desde pendiente: cuenta perdida sin tocar líneas ni monto, y deja quién', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      const venta = (await perdida(v.id).expect(201)).body as VentaDetalle;
      expect(venta).toMatchObject({
        id: v.id,
        status: 'cuenta_perdida',
        montoCentavos: 27000,
        editable: false,
        puedeMarcarPerdida: false,
      });
      expect(venta.lineas).toHaveLength(2);
      expect(await ventaPorId(v.id)).toMatchObject({
        status: 'cuenta_perdida',
        monto_total: '270.00',
        actualizado_por_usuario_id: usuarioGeneralId,
      });
    });

    it('desde abonado, con abonos: los abonos siguen vivos', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await abonar(v.id, '70.00');
      await perdida(v.id).expect(201);
      expect(vivas(await cobrosDe(v.id))).toEqual([
        expect.objectContaining({ monto: '70.00', origen: 'cobro' }),
      ]);
    });

    it('desde pagada es 409, y marcarla dos veces también', async () => {
      const pagada = await registrar({ fecha: FECHA_PERDIDA, contadoCredito: 'contado' });
      const res = await perdida(pagada.id).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'Solo una venta pendiente o abonada se puede marcar como cuenta perdida.',
      );
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await perdida(v.id).expect(201);
      await perdida(v.id).expect(409);
    });

    it('después ya no se edita ni se elimina', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await perdida(v.id).expect(201);
      await request(app.getHttpServer())
        .patch(`/ventas/${v.id}`)
        .set('Cookie', cookieGeneral)
        .send({
          vendedorId: vendedorTj,
          numNota: v.numNota,
          contadoCredito: 'credito',
          factura: 'N/A',
          lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
        })
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/ventas/${v.id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
    });

    it('sin permiso 403; otra sucursal 403; inexistente 404', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      await perdida(v.id, cookieSinPermiso).expect(403);
      const mx = await registrar({
        fecha: FECHA_PERDIDA,
        clienteId: clienteMx,
        vendedorId: vendedorMx,
        lineas: [{ presentacionId: pre1, cantidad: 1, cantidadPromocion: 0 }],
      });
      await perdida(mx.id, cookieTijuana).expect(403);
      await perdida(randomUUID()).expect(404);
    });

    it('la nota deja de salir por cobrar en la tablet (vuelco completo e incremental)', async () => {
      const v = await registrar({ fecha: FECHA_PERDIDA });
      const antes = await notasDeLaTablet();
      expect(porCobrar(antes, v.id)).toBe(true);

      await perdida(v.id).expect(201);

      expect(porCobrar(await notasDeLaTablet(), v.id)).toBe(false);
      const incremental = await notasDeLaTablet(antes.cursor);
      expect(incremental.notas_pendientes.find((n) => n.id === v.id)).toMatchObject({
        activo: 0,
      });
    });
  });
```

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar.e2e-spec`
Expected: FAIL — `DELETE /ventas/:id` y `POST /ventas/:id/cuenta-perdida` responden 404.

- [ ] **Step 2: Repositorio**

En `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts`, agregar al final de la clase:

```ts
  /**
   * Borrado logico (§4.3): la venta, sus lineas vivas y su cobro de contado.
   * El # de nota queda libre (el indice de #95 es parcial) y el folio queda
   * usado para siempre (ADR-0007). `updated_at` lo pone el trigger: asi la
   * tablet saca la nota de su lista en el siguiente pull.
   */
  async eliminarVenta(
    id: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota_detalle')
      .set({ deleted_at: sql`now()` })
      .where('venta_nota_id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    await this.borrarCobroContado(id, trx);
    await trx
      .updateTable('venta_nota')
      .set({ deleted_at: sql`now()`, eliminado_por_usuario_id: usuarioId })
      .where('id', '=', id)
      .execute();
  }

  /** §4.4: solo el status y quien. No toca lineas, montos ni abonos. */
  async marcarCuentaPerdida(
    id: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota')
      .set({ status: 'cuenta_perdida', actualizado_por_usuario_id: usuarioId })
      .where('id', '=', id)
      .execute();
  }
```

- [ ] **Step 3: Servicio**

En `apps/backend/src/modules/ventas-cobranza/ventas-edicion.service.ts`, cambiar la importación de `./acciones-venta` por:

```ts
import {
  MOTIVO_NO_PERDIBLE,
  bloqueoDeEdicion,
  sePuedeMarcarPerdida,
} from './acciones-venta';
```

y agregar estos métodos justo antes de `private async bloquearConAlcance`:

```ts
  /** §4.3. Mismas condiciones que editar: viva y sin abonos de cobranza. */
  async eliminar(usuarioId: string, id: string): Promise<void> {
    await this.portal.enTransaccion(async (trx) => {
      const venta = await this.bloquearConAlcance(usuarioId, id, trx);
      const bloqueo = bloqueoDeEdicion(
        venta.status,
        await this.repo.abonosDeCobroVivos(id, trx),
        'eliminar',
      );
      if (bloqueo) throw new ConflictException(bloqueo);
      await this.repo.eliminarVenta(id, usuarioId, trx);
    });
  }

  /**
   * §4.4: aunque tenga abonos; deja de cobrarse el resto. Las reglas de
   * cobranza ya la tratan como no cobrable (`esCobrable`) y el pull de la
   * tablet solo baja `pendiente`/`abonado`. No hay deshacer en esta version.
   */
  async marcarCuentaPerdida(
    usuarioId: string,
    id: string,
  ): Promise<VentaDetalle> {
    await this.portal.enTransaccion(async (trx) => {
      const venta = await this.bloquearConAlcance(usuarioId, id, trx);
      if (!sePuedeMarcarPerdida(venta.status))
        throw new ConflictException(MOTIVO_NO_PERDIBLE);
      await this.repo.marcarCuentaPerdida(id, usuarioId, trx);
    });
    return this.consulta.leerDetalle(id);
  }
```

- [ ] **Step 4: Controller**

En `apps/backend/src/modules/ventas-cobranza/ventas.controller.ts`, agregar `Delete` a la importación de `@nestjs/common` (orden alfabético: `Body, Controller, Delete, Get, …`) y al final de la clase:

```ts
  @Delete(':id')
  @RequierePermiso('venta.editar_eliminar')
  async eliminar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.edicion.eliminar(usuarioId, id);
    return { id };
  }

  // Sin cuerpo: la accion es fija (como `convertir-a-cliente`).
  @Post(':id/cuenta-perdida')
  @RequierePermiso('venta.editar_eliminar')
  async marcarCuentaPerdida(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VentaDetalle> {
    return this.edicion.marcarCuentaPerdida(usuarioId, id);
  }
```

- [ ] **Step 5: Correr la e2e**

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar.e2e-spec`
Expected: PASS (51 pruebas: 16 + 23 + 12).

- [ ] **Step 6: Suites completas del backend**

```bash
npm run supabase -- test db
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
git status --short
```

Expected: todo en verde (incluido `30_precios_test.sql`: la e2e borró sus precios); `git status` solo con archivos de esta tarea.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza apps/backend/test/ventas-editar.e2e-spec.ts
git commit -m "$(cat <<'EOF'
T-17: eliminar una venta y marcarla como cuenta perdida desde el portal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Portal — API de ventas, piezas compartidas del formulario y modo edición

**Files:**
- Modify: `apps/portal/src/lib/ventas.ts`
- Modify: `apps/portal/src/lib/ventas.test.ts`
- Create: `apps/portal/src/components/ventas/buscador-cliente.tsx`
- Create: `apps/portal/src/components/ventas/selector-repartidor.tsx`
- Create: `apps/portal/src/components/ventas/tabla-productos-venta.tsx`
- Create: `apps/portal/src/components/ventas/campos-condiciones-venta.tsx`
- Modify: `apps/portal/src/components/ventas/pantalla-registrar-venta.tsx` (usa las piezas; sus pruebas no cambian)
- Create: `apps/portal/src/components/ventas/formulario-editar-venta.tsx`
- Create: `apps/portal/src/components/ventas/formulario-editar-venta.test.tsx`

**Interfaces:**
- Consumes (backend, Tasks 2–4): `GET /ventas`, `GET /ventas/:id`, `PATCH /ventas/:id`, `DELETE /ventas/:id`, `POST /ventas/:id/cuenta-perdida`, con las formas `ResultadoBusquedaVentas`, `VentaDetalle` y el cuerpo de `EditarVentaDto`. De la parte 1: `obtenerCatalogoVenta`, `listarRepartidores`, `leerPiezas`, `formatearPesos`, `hoyEnTijuana`, `useEnvioFormulario`.
- Produces (lo usa la Task 6):
  - Tipos en `lib/ventas.ts`: `StatusVenta`, `OrigenVenta`, `VentaEncontrada`, `ResultadoBusquedaVentas`, `FiltroVentas`, `LineaDetalleVenta`, `CobroDeVenta`, `VentaDetalle`, `CambiosVenta`, `FilaProducto`, `Captura`, `CondicionesVenta`, `ResultadoLineas`.
  - Constantes: `ETIQUETA_STATUS: Record<StatusVenta, string>`, `ETIQUETA_ORIGEN: Record<OrigenVenta, string>`, `REPARTIDOR_OFICINA = "oficina"`, `CONDICIONES_INICIALES`.
  - API: `buscarVentas(filtro: FiltroVentas): Promise<ResultadoBusquedaVentas>`, `obtenerVenta(id): Promise<VentaDetalle>`, `editarVenta(id, cambios: CambiosVenta): Promise<VentaDetalle>`, `eliminarVenta(id): Promise<{ id: string }>`, `marcarCuentaPerdida(id): Promise<VentaDetalle>`.
  - Puras: `normalizarTexto(texto): string`, `filasDeCatalogo(catalogo): FilaProducto[]`, `filasDeEdicion(lineas, catalogo): FilaProducto[]`, `capturaDeLineas(lineas): Captura`, `conCaptura(captura, presentacionId, campo, valor): Captura`, `lineasDeCaptura(filas, captura): ResultadoLineas`, `totalDeCaptura(filas, captura): number`, `camposDeCondiciones(c): Pick<NuevaVenta, …>`, `condicionesDeVenta(venta): CondicionesVenta`.
  - Componentes: `BuscadorCliente`, `SelectorRepartidor`, `TablaProductosVenta`, `CamposCondicionesVenta`, `FormularioEditarVenta({ venta, onGuardada, onCancelar })`.

- [ ] **Step 1: Pruebas puras que fallan**

En `apps/portal/src/lib/ventas.test.ts`, cambiar la importación por:

```ts
import { describe, expect, it } from "vitest";
import {
  camposDeCondiciones,
  capturaDeLineas,
  condicionesDeVenta,
  filasDeCatalogo,
  filasDeEdicion,
  formatearPesos,
  hoyEnTijuana,
  leerPiezas,
  lineasDeCaptura,
  normalizarTexto,
  totalDeCaptura,
  type PresentacionDeCatalogo,
  type VentaDetalle,
} from "./ventas";
```

y agregar al final:

```ts
const CATALOGO: PresentacionDeCatalogo[] = [
  { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
  { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600 },
  { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: null },
];

const VENTA: VentaDetalle = {
  id: "v1",
  folio: "TJ240304OF01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: "v-ana",
  repartidor: "Ana Pérez",
  numNota: "1234",
  contadoCredito: "contado",
  factura: "pendiente",
  comentarios: null,
  montoCentavos: 21600,
  status: "pagada",
  origen: "portal",
  saldoCentavos: 0,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 24,
      cantidadPromocion: 2,
      precioCentavos: 900,
      subtotalCentavos: 21600,
    },
    {
      presentacionId: "p3",
      producto: "Tamarindo",
      volumen: "2 L",
      cantidad: 0,
      cantidadPromocion: 1,
      precioCentavos: 0,
      subtotalCentavos: 0,
    },
  ],
  cobros: [
    { id: "a1", fechaPago: "2024-03-04", metodoPago: "efectivo", montoCentavos: 21600, origen: "venta_contado" },
  ],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: false,
};

describe("normalizarTexto", () => {
  it("quita acentos y mayúsculas", () => {
    expect(normalizarTexto("José ÁLVAREZ")).toBe("jose alvarez");
  });
});

describe("filas de la tabla de productos", () => {
  it("al registrar, una presentación sin precio queda deshabilitada", () => {
    expect(filasDeCatalogo(CATALOGO).map((f) => [f.presentacionId, f.deshabilitada])).toEqual([
      ["p1", false],
      ["p2", false],
      ["p3", true],
    ]);
  });

  it("al editar, las líneas existentes van primero con su precio guardado y nunca deshabilitadas", () => {
    expect(filasDeEdicion(VENTA.lineas, CATALOGO)).toEqual([
      { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 900, deshabilitada: false },
      // Línea de promoción ($0) sin precio en la lista: se puede seguir capturando promoción.
      { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: 0, deshabilitada: false },
      { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600, deshabilitada: false },
    ]);
  });

  it("al editar, una línea de promoción ($0) muestra el precio de la lista si lo hay", () => {
    const filas = filasDeEdicion([{ ...VENTA.lineas[1], presentacionId: "p2", producto: "Jamaica" }], CATALOGO);
    expect(filas[0]).toMatchObject({ presentacionId: "p2", precioCentavos: 600 });
  });

  it("al editar, una presentación nueva sin precio a la fecha queda deshabilitada", () => {
    const filas = filasDeEdicion([VENTA.lineas[0]], CATALOGO);
    expect(filas.find((f) => f.presentacionId === "p3")).toMatchObject({ deshabilitada: true });
  });
});

describe("captura → líneas del payload", () => {
  const filas = filasDeEdicion(VENTA.lineas, CATALOGO);

  it("capturaDeLineas precarga lo guardado (0 como vacío)", () => {
    expect(capturaDeLineas(VENTA.lineas)).toEqual({
      p1: { cantidad: "24", promocion: "2" },
      p3: { cantidad: "", promocion: "1" },
    });
  });

  it("arma solo las filas con piezas, sin precios", () => {
    const r = lineasDeCaptura(filas, {
      ...capturaDeLineas(VENTA.lineas),
      p2: { cantidad: "3", promocion: "" },
    });
    expect(r).toEqual({
      ok: true,
      lineas: [
        { presentacionId: "p1", cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: "p3", cantidad: 0, cantidadPromocion: 1 },
        { presentacionId: "p2", cantidad: 3, cantidadPromocion: 0 },
      ],
    });
  });

  it("una fila deshabilitada nunca viaja", () => {
    const r = lineasDeCaptura(filasDeCatalogo(CATALOGO), { p3: { cantidad: "5", promocion: "" } });
    expect(r).toEqual({ ok: false, error: "Captura al menos un producto." });
  });

  it("una cantidad no entera es un error, no un 0", () => {
    expect(lineasDeCaptura(filas, { p1: { cantidad: "2.5", promocion: "" } })).toEqual({
      ok: false,
      error: "Las cantidades deben ser números enteros de 0 en adelante.",
    });
  });

  it("totalDeCaptura suma cantidad × precio de las filas habilitadas", () => {
    expect(totalDeCaptura(filas, { p1: { cantidad: "2", promocion: "9" }, p2: { cantidad: "1", promocion: "" } })).toBe(2400);
  });
});

describe("condiciones de la venta", () => {
  it("camposDeCondiciones recorta, y omite método en crédito y comentarios vacíos", () => {
    expect(
      camposDeCondiciones({ numNota: " 77 ", contadoCredito: "credito", metodoPago: "efectivo", factura: "N/A", comentarios: "  " }),
    ).toEqual({ numNota: "77", contadoCredito: "credito", factura: "N/A" });
    expect(
      camposDeCondiciones({ numNota: "77", contadoCredito: "contado", metodoPago: "efectivo", factura: "pendiente", comentarios: " ok " }),
    ).toEqual({ numNota: "77", contadoCredito: "contado", metodoPago: "efectivo", factura: "pendiente", comentarios: "ok" });
  });

  it("condicionesDeVenta precarga la venta y el método de su cobro de contado", () => {
    expect(condicionesDeVenta(VENTA)).toEqual({
      numNota: "1234",
      contadoCredito: "contado",
      metodoPago: "efectivo",
      factura: "pendiente",
      comentarios: "",
    });
  });

  it("sin cobro de contado, el método propuesto es transferencia", () => {
    expect(condicionesDeVenta({ ...VENTA, contadoCredito: "credito", cobros: [] }).metodoPago).toBe("transferencia");
  });
});
```

Run: `npm test --workspace=apps/portal -- lib/ventas`
Expected: FAIL — las funciones nuevas no existen.

- [ ] **Step 2: Implementar `lib/ventas.ts`**

En `apps/portal/src/lib/ventas.ts`:

1. Reemplazar el comentario de cabecera (las 6 líneas `// Copia normativa …`) por:

```ts
// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/ventas-portal.service.ts
// (`PresentacionDeCatalogo`, `VentaRegistradaPortal`), ventas-portal.repository.ts
// (`Repartidor`), ventas-consulta.repository.ts / ventas-consulta.service.ts
// (`VentaEncontrada`, `ResultadoBusquedaVentas`, `VentaDetalle`) y de los cuerpos
// de dto/registrar-venta.dto.ts y dto/editar-venta.dto.ts. Mismo trato que
// lib/precios.ts: no hay tipo compartido; un cambio de forma en un lado exige el
// equivalente en el otro.
```

2. Agregar al final del archivo:

```ts
/* ------------------------------------------------------------------ */
/* Buscar, editar y eliminar (T-17, parte 2)                           */
/* ------------------------------------------------------------------ */

export type StatusVenta = "pagada" | "pendiente" | "promocion" | "abonado" | "cuenta_perdida";
export type OrigenVenta = "app" | "portal";

export const ETIQUETA_STATUS: Record<StatusVenta, string> = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  promocion: "Promoción",
  abonado: "Abonado",
  cuenta_perdida: "Cuenta perdida",
};

export const ETIQUETA_ORIGEN: Record<OrigenVenta, string> = {
  app: "Tablet",
  portal: "Portal",
};

/** Una fila de la búsqueda. `repartidor: null` = Oficina. */
export interface VentaEncontrada {
  id: string;
  folio: string;
  fecha: string;
  clienteId: string;
  cliente: string;
  repartidor: string | null;
  numNota: string;
  montoCentavos: number;
  status: StatusVenta;
  origen: OrigenVenta;
  saldoCentavos: number;
}

export interface ResultadoBusquedaVentas {
  ventas: VentaEncontrada[];
  /** Había más de 200: se pide acotar. */
  hayMas: boolean;
}

export interface FiltroVentas {
  desde: string;
  hasta: string;
  sucursal: string | null;
  clienteId: string | null;
  numNota: string;
}

export interface LineaDetalleVenta {
  presentacionId: string;
  producto: string;
  volumen: string;
  cantidad: number;
  cantidadPromocion: number;
  /** El guardado: el de la nota firmada (tablet) o el de la lista a la fecha (portal). */
  precioCentavos: number;
  subtotalCentavos: number;
}

export interface CobroDeVenta {
  id: string;
  fechaPago: string;
  metodoPago: string;
  montoCentavos: number;
  origen: "cobro" | "venta_contado";
}

export interface VentaDetalle {
  id: string;
  folio: string;
  fecha: string;
  clienteId: string;
  cliente: string;
  sucursalId: string;
  sucursalCodigo: string;
  vendedorId: string | null;
  repartidor: string | null;
  numNota: string;
  contadoCredito: ContadoCredito;
  factura: string;
  comentarios: string | null;
  montoCentavos: number;
  status: StatusVenta;
  origen: OrigenVenta;
  saldoCentavos: number;
  lineas: LineaDetalleVenta[];
  cobros: CobroDeVenta[];
  /** De la VENTA (sin cobros de cobranza, no es cuenta perdida); el permiso lo pone `puede()`. */
  editable: boolean;
  motivoNoEditable: string | null;
  puedeMarcarPerdida: boolean;
}

/** El cuerpo de `PATCH /ventas/:id`: el estado completo de lo editable, sin precios. */
export type CambiosVenta = Omit<NuevaVenta, "fecha" | "clienteId">;

export function buscarVentas(filtro: FiltroVentas): Promise<ResultadoBusquedaVentas> {
  const params = new URLSearchParams({ desde: filtro.desde, hasta: filtro.hasta });
  if (filtro.sucursal) params.set("sucursal", filtro.sucursal);
  if (filtro.clienteId) params.set("clienteId", filtro.clienteId);
  const numNota = filtro.numNota.trim();
  if (numNota) params.set("numNota", numNota);
  return apiFetch<ResultadoBusquedaVentas>(`/ventas?${params.toString()}`);
}

export function obtenerVenta(id: string): Promise<VentaDetalle> {
  return apiFetch<VentaDetalle>(`/ventas/${encodeURIComponent(id)}`);
}

export function editarVenta(id: string, cambios: CambiosVenta): Promise<VentaDetalle> {
  return apiFetch<VentaDetalle>(`/ventas/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  });
}

export function eliminarVenta(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/ventas/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function marcarCuentaPerdida(id: string): Promise<VentaDetalle> {
  return apiFetch<VentaDetalle>(`/ventas/${encodeURIComponent(id)}/cuenta-perdida`, {
    method: "POST",
  });
}

/* ------------------------------------------------------------------ */
/* Captura compartida por "Registrar venta" y "Editar venta"           */
/* ------------------------------------------------------------------ */

/** Valor del desplegable para la venta de mostrador: viaja como `vendedorId: null`. */
export const REPARTIDOR_OFICINA = "oficina";

/** Sin acentos ni mayúsculas, para buscar "jose" y encontrar "José". */
export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Una fila de la tabla de productos. `deshabilitada` = no se captura ni viaja. */
export interface FilaProducto {
  presentacionId: string;
  producto: string;
  volumen: string;
  /** `null` = "sin precio en la lista". */
  precioCentavos: number | null;
  deshabilitada: boolean;
}

export type Captura = Record<string, { cantidad: string; promocion: string }>;

/** Registrar: el catálogo tal cual; sin precio a la fecha = deshabilitada. */
export function filasDeCatalogo(catalogo: PresentacionDeCatalogo[]): FilaProducto[] {
  return catalogo.map((p) => ({ ...p, deshabilitada: p.precioCentavos === null }));
}

/**
 * Editar (§3.3): primero las líneas de la venta con su precio GUARDADO (nunca
 * deshabilitadas: la presentación pudo darse de baja después), luego las
 * presentaciones del catálogo sin línea con el precio de la lista a la fecha.
 * Una línea de promoción ($0) muestra el precio de la lista: si se le capturan
 * piezas, el servidor cobra ese.
 */
export function filasDeEdicion(
  lineas: LineaDetalleVenta[],
  catalogo: PresentacionDeCatalogo[],
): FilaProducto[] {
  const precioDeLista = new Map(catalogo.map((p) => [p.presentacionId, p.precioCentavos]));
  const propias = new Set(lineas.map((l) => l.presentacionId));
  return [
    ...lineas.map((l) => ({
      presentacionId: l.presentacionId,
      producto: l.producto,
      volumen: l.volumen,
      precioCentavos:
        l.precioCentavos > 0 ? l.precioCentavos : (precioDeLista.get(l.presentacionId) ?? 0),
      deshabilitada: false,
    })),
    ...filasDeCatalogo(catalogo.filter((p) => !propias.has(p.presentacionId))),
  ];
}

/** Lo guardado como texto de los campos; 0 queda vacío. */
export function capturaDeLineas(lineas: LineaDetalleVenta[]): Captura {
  return Object.fromEntries(
    lineas.map((l) => [
      l.presentacionId,
      {
        cantidad: l.cantidad === 0 ? "" : String(l.cantidad),
        promocion: l.cantidadPromocion === 0 ? "" : String(l.cantidadPromocion),
      },
    ]),
  );
}

export function conCaptura(
  captura: Captura,
  presentacionId: string,
  campo: "cantidad" | "promocion",
  valor: string,
): Captura {
  return {
    ...captura,
    [presentacionId]: {
      cantidad: captura[presentacionId]?.cantidad ?? "",
      promocion: captura[presentacionId]?.promocion ?? "",
      [campo]: valor,
    },
  };
}

export type ResultadoLineas =
  | { ok: true; lineas: NuevaVenta["lineas"] }
  | { ok: false; error: string };

/** Lo tecleado → líneas del payload, **sin precios**. Una fila deshabilitada nunca viaja. */
export function lineasDeCaptura(filas: FilaProducto[], captura: Captura): ResultadoLineas {
  const lineas: NuevaVenta["lineas"] = [];
  for (const f of filas) {
    if (f.deshabilitada) continue;
    const cantidad = leerPiezas(captura[f.presentacionId]?.cantidad ?? "");
    const promocion = leerPiezas(captura[f.presentacionId]?.promocion ?? "");
    if (cantidad === null || promocion === null) {
      return { ok: false, error: "Las cantidades deben ser números enteros de 0 en adelante." };
    }
    if (cantidad + promocion > 0) {
      lineas.push({ presentacionId: f.presentacionId, cantidad, cantidadPromocion: promocion });
    }
  }
  if (lineas.length === 0) return { ok: false, error: "Captura al menos un producto." };
  return { ok: true, lineas };
}

/** Vista previa del total: el servidor recalcula. */
export function totalDeCaptura(filas: FilaProducto[], captura: Captura): number {
  return filas.reduce((total, f) => {
    if (f.deshabilitada || f.precioCentavos === null) return total;
    const piezas = leerPiezas(captura[f.presentacionId]?.cantidad ?? "");
    return total + (piezas ?? 0) * f.precioCentavos;
  }, 0);
}

/** # de nota, contado/crédito, método, factura y comentarios tal como se teclean. */
export interface CondicionesVenta {
  numNota: string;
  contadoCredito: ContadoCredito;
  metodoPago: MetodoPagoContado;
  factura: FacturaVenta;
  comentarios: string;
}

export const CONDICIONES_INICIALES: CondicionesVenta = {
  numNota: "",
  contadoCredito: "contado",
  metodoPago: "transferencia",
  factura: "N/A",
  comentarios: "",
};

/** Lo que de las condiciones viaja en el payload: método solo en contado, comentarios solo si hay. */
export function camposDeCondiciones(
  c: CondicionesVenta,
): Pick<NuevaVenta, "numNota" | "contadoCredito" | "metodoPago" | "factura" | "comentarios"> {
  const comentario = c.comentarios.trim();
  return {
    numNota: c.numNota.trim(),
    contadoCredito: c.contadoCredito,
    ...(c.contadoCredito === "contado" ? { metodoPago: c.metodoPago } : {}),
    factura: c.factura,
    ...(comentario ? { comentarios: comentario } : {}),
  };
}

/** Las condiciones de una venta guardada; el método propuesto es el de su cobro de contado. */
export function condicionesDeVenta(venta: VentaDetalle): CondicionesVenta {
  const cobro = venta.cobros.find((c) => c.origen === "venta_contado");
  return {
    numNota: venta.numNota,
    contadoCredito: venta.contadoCredito,
    metodoPago: cobro?.metodoPago === "efectivo" ? "efectivo" : "transferencia",
    factura: venta.factura === "pendiente" ? "pendiente" : "N/A",
    comentarios: venta.comentarios ?? "",
  };
}
```

Run: `npm test --workspace=apps/portal -- lib/ventas`
Expected: PASS.

- [ ] **Step 3: Extraer las piezas compartidas**

Crear `apps/portal/src/components/ventas/buscador-cliente.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ClienteResumen } from "@/lib/clientes";
import { normalizarTexto } from "@/lib/ventas";

/**
 * Búsqueda incremental de cliente por nombre (T-17). La usan "Registrar venta"
 * y la búsqueda de ventas; `clientes` ya viene acotado al alcance del usuario.
 */
export function BuscadorCliente({
  clientes,
  cliente,
  onElegir,
  onQuitar,
  etiquetaQuitar = "Cambiar",
  disabled = false,
}: {
  clientes: ClienteResumen[];
  cliente: ClienteResumen | null;
  onElegir: (cliente: ClienteResumen) => void;
  onQuitar: () => void;
  etiquetaQuitar?: string;
  disabled?: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");

  const coincidencias = useMemo(() => {
    const q = normalizarTexto(busqueda.trim());
    if (q === "") return [];
    return clientes.filter((c) => normalizarTexto(c.nombre).includes(q)).slice(0, 10);
  }, [busqueda, clientes]);

  const etiqueta = (c: ClienteResumen) =>
    `${c.nombre} · ${c.sucursalCodigo}${c.tipo === "prospecto" ? " · Prospecto" : ""}`;

  return (
    <div className="flex min-w-72 flex-1 flex-col gap-1.5">
      <label htmlFor="buscar-cliente" className="text-sm font-medium">
        Cliente
      </label>
      {cliente ? (
        <div className="flex items-center gap-2 text-sm">
          <span>{etiqueta(cliente)}</span>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onQuitar}>
            {etiquetaQuitar}
          </Button>
        </div>
      ) : (
        <>
          <input
            id="buscar-cliente"
            autoComplete="off"
            placeholder="Escribe el nombre del cliente"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
          {coincidencias.length > 0 && (
            <ul className="flex flex-col rounded-md border">
              {coincidencias.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setBusqueda("");
                      onElegir(c);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {etiqueta(c)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
```

Crear `apps/portal/src/components/ventas/selector-repartidor.tsx`:

```tsx
"use client";

import { REPARTIDOR_OFICINA, type Repartidor } from "@/lib/ventas";

/** Vendedores de la sucursal y, si aplica, "Oficina" al final (venta de mostrador). */
export function SelectorRepartidor({
  repartidores,
  valor,
  onCambio,
  disabled,
  conOficina,
}: {
  repartidores: Repartidor[];
  valor: string;
  onCambio: (valor: string) => void;
  disabled: boolean;
  conOficina: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="repartidor" className="text-sm font-medium">
        Repartidor
      </label>
      <select
        id="repartidor"
        disabled={disabled}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="w-64 rounded-md border px-3 py-2 text-sm"
      >
        <option value="">Elige…</option>
        {repartidores.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nombre}
          </option>
        ))}
        {conOficina && <option value={REPARTIDOR_OFICINA}>Oficina</option>}
      </select>
    </div>
  );
}
```

Crear `apps/portal/src/components/ventas/tabla-productos-venta.tsx`:

```tsx
"use client";

import { formatearPesos, leerPiezas, type Captura, type FilaProducto } from "@/lib/ventas";

/** La captura de productos (T-17): cantidad y promoción por presentación, con subtotal en vivo. */
export function TablaProductosVenta({
  filas,
  captura,
  onCambio,
  disabled,
}: {
  filas: FilaProducto[];
  captura: Captura;
  onCambio: (presentacionId: string, campo: "cantidad" | "promocion", valor: string) => void;
  disabled: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 font-medium">Producto</th>
          <th className="py-1 font-medium">Precio</th>
          <th className="py-1 font-medium">Cantidad</th>
          <th className="py-1 font-medium">Promoción</th>
          <th className="py-1 text-right font-medium">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => {
          const nombre = `${f.producto} ${f.volumen}`;
          const sinPrecio = f.precioCentavos === null;
          const piezas = leerPiezas(captura[f.presentacionId]?.cantidad ?? "") ?? 0;
          return (
            <tr key={f.presentacionId} className="border-t">
              <td className="py-1.5">{nombre}</td>
              <td className="py-1.5">
                {sinPrecio ? (
                  <span className="text-muted-foreground">sin precio en la lista</span>
                ) : (
                  formatearPesos(f.precioCentavos ?? 0)
                )}
              </td>
              <td className="py-1.5">
                <input
                  aria-label={`Cantidad de ${nombre}`}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="numeric"
                  disabled={f.deshabilitada || disabled}
                  value={captura[f.presentacionId]?.cantidad ?? ""}
                  onChange={(e) => onCambio(f.presentacionId, "cantidad", e.target.value)}
                  className="w-24 rounded-md border px-2 py-1"
                />
              </td>
              <td className="py-1.5">
                <input
                  aria-label={`Promoción de ${nombre}`}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="numeric"
                  disabled={f.deshabilitada || disabled}
                  value={captura[f.presentacionId]?.promocion ?? ""}
                  onChange={(e) => onCambio(f.presentacionId, "promocion", e.target.value)}
                  className="w-24 rounded-md border px-2 py-1"
                />
              </td>
              <td className="py-1.5 text-right">
                {f.deshabilitada || sinPrecio
                  ? "—"
                  : formatearPesos(piezas * (f.precioCentavos ?? 0))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

Crear `apps/portal/src/components/ventas/campos-condiciones-venta.tsx`:

```tsx
"use client";

import type {
  CondicionesVenta,
  ContadoCredito,
  FacturaVenta,
  MetodoPagoContado,
} from "@/lib/ventas";

/** # de nota, contado/crédito, método de pago, factura y comentarios: iguales al registrar y al editar. */
export function CamposCondicionesVenta({
  valores,
  onCambio,
  disabled,
}: {
  valores: CondicionesVenta;
  onCambio: (cambio: Partial<CondicionesVenta>) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="num-nota" className="text-sm font-medium">
            Número de nota
          </label>
          <input
            id="num-nota"
            required
            maxLength={30}
            disabled={disabled}
            value={valores.numNota}
            onChange={(e) => onCambio({ numNota: e.target.value })}
            className="w-40 rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="contado-credito" className="text-sm font-medium">
            Contado o crédito
          </label>
          <select
            id="contado-credito"
            disabled={disabled}
            value={valores.contadoCredito}
            onChange={(e) => onCambio({ contadoCredito: e.target.value as ContadoCredito })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
          </select>
        </div>

        {valores.contadoCredito === "contado" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="metodo-pago" className="text-sm font-medium">
              Método de pago
            </label>
            <select
              id="metodo-pago"
              disabled={disabled}
              value={valores.metodoPago}
              onChange={(e) => onCambio({ metodoPago: e.target.value as MetodoPagoContado })}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="factura" className="text-sm font-medium">
            Factura
          </label>
          <select
            id="factura"
            disabled={disabled}
            value={valores.factura}
            onChange={(e) => onCambio({ factura: e.target.value as FacturaVenta })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="N/A">N/A</option>
            <option value="pendiente">Pendiente</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="comentarios" className="text-sm font-medium">
          Comentarios
        </label>
        <textarea
          id="comentarios"
          maxLength={500}
          disabled={disabled}
          value={valores.comentarios}
          onChange={(e) => onCambio({ comentarios: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>
    </>
  );
}
```

- [ ] **Step 4: "Registrar venta" usa las piezas (sin cambio de comportamiento)**

Reemplazar `apps/portal/src/components/ventas/pantalla-registrar-venta.tsx` completo por:

```tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { ErrorApi } from "@/lib/api";
import { listarClientes, obtenerCliente, type ClienteResumen } from "@/lib/clientes";
import {
  CONDICIONES_INICIALES,
  ETIQUETA_STATUS,
  REPARTIDOR_OFICINA,
  camposDeCondiciones,
  conCaptura,
  filasDeCatalogo,
  formatearPesos,
  hoyEnTijuana,
  lineasDeCaptura,
  listarRepartidores,
  obtenerCatalogoVenta,
  registrarVenta,
  totalDeCaptura,
  type Captura,
  type CondicionesVenta,
  type NuevaVenta,
  type PresentacionDeCatalogo,
  type Repartidor,
  type VentaRegistrada,
} from "@/lib/ventas";
import { BuscadorCliente } from "./buscador-cliente";
import { CamposCondicionesVenta } from "./campos-condiciones-venta";
import { SelectorRepartidor } from "./selector-repartidor";
import { TablaProductosVenta } from "./tabla-productos-venta";

/**
 * Registrar venta desde el portal (T-17, parte 1, §3 del spec).
 *
 * El precio no se teclea: sale del catálogo del cliente a la fecha
 * (`GET /ventas/catalogo`) y el servidor lo vuelve a resolver al grabar. El
 * total de aquí es solo una vista previa. La tabla, las condiciones y las
 * reglas del payload son las mismas que usa "Editar venta" (parte 2).
 */
export function PantallaRegistrarVenta({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const puedeRegistrar = puede("venta.registrar");

  const [fecha, setFecha] = useState(() => hoyEnTijuana());
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [repartidor, setRepartidor] = useState("");
  const [catalogo, setCatalogo] = useState<PresentacionDeCatalogo[]>([]);
  const [captura, setCaptura] = useState<Captura>({});
  const [condiciones, setCondiciones] = useState<CondicionesVenta>(CONDICIONES_INICIALES);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [resultado, setResultado] = useState<VentaRegistrada | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo registrar la venta.");

  // Clientes y prospectos del alcance (el backend acota por sucursal).
  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  // Repartidores: la sucursal sale del DETALLE (la fila de la lista solo trae el código).
  useEffect(() => {
    if (!cliente) return;
    let vigente = true;
    obtenerCliente(cliente.id)
      .then((detalle) => listarRepartidores(detalle.sucursalId))
      .then((lista) => {
        if (vigente) setRepartidores(lista);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los repartidores.");
      });
    return () => {
      vigente = false;
    };
  }, [cliente]);

  // Productos con el precio de ESA fecha. `vigente` descarta una respuesta vieja
  // si la fecha cambia antes de que llegue.
  useEffect(() => {
    if (!cliente || !fecha) return;
    let vigente = true;
    obtenerCatalogoVenta(cliente.id, fecha)
      .then((lista) => {
        if (!vigente) return;
        setCatalogo(lista);
        setErrorCarga(null);
      })
      .catch((err: unknown) => {
        if (!vigente) return;
        setCatalogo([]);
        setErrorCarga(
          err instanceof ErrorApi && err.mensajeApi
            ? err.mensajeApi
            : "No se pudieron cargar los productos del cliente.",
        );
      });
    return () => {
      vigente = false;
    };
  }, [cliente, fecha]);

  // Solo cuentan las presentaciones con precio: una deshabilitada nunca suma ni viaja.
  const filas = useMemo(() => filasDeCatalogo(catalogo), [catalogo]);
  const totalCentavos = totalDeCaptura(filas, captura);

  function elegirCliente(elegido: ClienteResumen) {
    setCliente(elegido);
    setRepartidor("");
    setRepartidores([]);
    setCatalogo([]);
    setCaptura({});
    setErrorCarga(null);
  }

  /** Sin cliente no hay catalogo ni repartidores: nada viejo puede sumar al total. */
  function quitarCliente() {
    setCliente(null);
    setRepartidor("");
    setRepartidores([]);
    setCatalogo([]);
    setCaptura({});
  }

  function registrarOtra() {
    setCliente(null);
    setRepartidores([]);
    setRepartidor("");
    setCatalogo([]);
    setCaptura({});
    setCondiciones(CONDICIONES_INICIALES);
    setErrorLocal(null);
    setResultado(null);
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErrorLocal(null);
    if (!cliente) {
      setErrorLocal("Elige el cliente.");
      return;
    }
    if (repartidor === "") {
      setErrorLocal("Elige el repartidor, u Oficina.");
      return;
    }
    const armadas = lineasDeCaptura(filas, captura);
    if (!armadas.ok) {
      setErrorLocal(armadas.error);
      return;
    }

    const venta: NuevaVenta = {
      fecha,
      clienteId: cliente.id,
      vendedorId: repartidor === REPARTIDOR_OFICINA ? null : repartidor,
      ...camposDeCondiciones(condiciones),
      lineas: armadas.lineas,
    };
    await enviar(
      async () => {
        setResultado(await registrarVenta(venta));
      },
      () => {},
    );
  }

  if (resultado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registrar venta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div role="status" className="rounded-md border p-4 text-sm">
            <p className="font-semibold">Venta registrada</p>
            <p>
              Folio <span className="font-mono">{resultado.folio}</span> ·{" "}
              {formatearPesos(resultado.montoCentavos)} · {ETIQUETA_STATUS[resultado.status]}
            </p>
            <p className="text-muted-foreground">
              Si hay nota de papel, anota el folio en ella.
            </p>
          </div>
          <div>
            <Button onClick={registrarOtra}>Registrar otra</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const mensajeError = errorLocal ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar venta</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={alEnviar} className="flex flex-col gap-5">
          {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fecha" className="text-sm font-medium">
                Fecha
              </label>
              <input
                id="fecha"
                type="date"
                required
                max={hoyEnTijuana()}
                disabled={enviando}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <BuscadorCliente
              clientes={clientes}
              cliente={cliente}
              onElegir={elegirCliente}
              onQuitar={quitarCliente}
              disabled={enviando}
            />

            <SelectorRepartidor
              repartidores={repartidores}
              valor={repartidor}
              onCambio={setRepartidor}
              disabled={enviando || !cliente}
              conOficina
            />
          </div>

          {cliente && (
            <TablaProductosVenta
              filas={filas}
              captura={captura}
              onCambio={(id, campo, valor) => setCaptura((actual) => conCaptura(actual, id, campo, valor))}
              disabled={enviando}
            />
          )}

          <p className="text-right text-base font-semibold">Total: {formatearPesos(totalCentavos)}</p>

          <CamposCondicionesVenta
            valores={condiciones}
            onCambio={(cambio) => setCondiciones((actual) => ({ ...actual, ...cambio }))}
            disabled={enviando}
          />

          {mensajeError && (
            <p role="alert" className="text-sm text-destructive">
              {mensajeError}
            </p>
          )}

          {puedeRegistrar ? (
            <div>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Grabando…" : "Grabar"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tienes permiso para registrar ventas.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
```

Run: `npm test --workspace=apps/portal -- pantalla-registrar-venta`
Expected: PASS — las 10 pruebas de la parte 1, sin tocarlas.

- [ ] **Step 5: Pruebas del formulario de edición que fallan**

Crear `apps/portal/src/components/ventas/formulario-editar-venta.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as ventasLib from "@/lib/ventas";
import type { PresentacionDeCatalogo, VentaDetalle } from "@/lib/ventas";
import { FormularioEditarVenta } from "./formulario-editar-venta";

vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    obtenerCatalogoVenta: vi.fn(),
    listarRepartidores: vi.fn(),
    editarVenta: vi.fn(),
  };
});

const obtenerCatalogoVenta = vi.mocked(ventasLib.obtenerCatalogoVenta);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);
const editarVenta = vi.mocked(ventasLib.editarVenta);

const CATALOGO: PresentacionDeCatalogo[] = [
  { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
  { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600 },
  { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: null },
];

const VENTA: VentaDetalle = {
  id: "v1",
  folio: "TJ240304AP01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: "v-ana",
  repartidor: "Ana Pérez",
  numNota: "1234",
  contadoCredito: "credito",
  factura: "N/A",
  comentarios: null,
  montoCentavos: 21600,
  status: "pendiente",
  origen: "portal",
  saldoCentavos: 21600,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 24,
      cantidadPromocion: 2,
      precioCentavos: 900,
      subtotalCentavos: 21600,
    },
  ],
  cobros: [],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
};

async function prepararFormulario(venta: VentaDetalle = VENTA) {
  const usuario = userEvent.setup();
  const onGuardada = vi.fn();
  const onCancelar = vi.fn();
  render(<FormularioEditarVenta venta={venta} onGuardada={onGuardada} onCancelar={onCancelar} />);
  await screen.findByLabelText("Cantidad de Jamaica 500 ml");
  return { usuario, onGuardada, onCancelar };
}

describe("FormularioEditarVenta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtenerCatalogoVenta.mockResolvedValue(CATALOGO);
    listarRepartidores.mockResolvedValue([{ id: "v-ana", nombre: "Ana Pérez" }]);
    editarVenta.mockResolvedValue({ ...VENTA, montoCentavos: 9000 });
  });

  it("cliente y fecha fijos; la línea guardada muestra su precio y lo nuevo el de la lista a la fecha", async () => {
    await prepararFormulario();
    expect(obtenerCatalogoVenta).toHaveBeenCalledWith("c1", "2024-03-04");
    expect(listarRepartidores).toHaveBeenCalledWith("suc-tj");
    expect(screen.queryByLabelText("Fecha")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cliente")).not.toBeInTheDocument();
    expect(screen.getByText("2024-03-04")).toBeInTheDocument();
    expect(screen.getByText("Abarrotes Lupita · TJ")).toBeInTheDocument();

    expect(screen.getByLabelText("Cantidad de Horchata 1 L")).toHaveValue(24);
    const filaHorchata = screen.getByLabelText("Cantidad de Horchata 1 L").closest("tr");
    expect(within(filaHorchata as HTMLElement).getByText("$9.00")).toBeInTheDocument();
    const filaJamaica = screen.getByLabelText("Cantidad de Jamaica 500 ml").closest("tr");
    expect(within(filaJamaica as HTMLElement).getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Cantidad de Tamarindo 2 L")).toBeDisabled();
    expect(screen.getByText("Total: $216.00")).toBeInTheDocument();
  });

  it("manda el estado completo sin precios y entrega la venta actualizada", async () => {
    const { usuario, onGuardada } = await prepararFormulario();
    const cantidad = screen.getByLabelText("Cantidad de Horchata 1 L");
    await usuario.clear(cantidad);
    await usuario.type(cantidad, "10");
    await usuario.type(screen.getByLabelText("Cantidad de Jamaica 500 ml"), "3");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(editarVenta).toHaveBeenCalledWith("v1", {
      vendedorId: "v-ana",
      numNota: "1234",
      contadoCredito: "credito",
      factura: "N/A",
      lineas: [
        { presentacionId: "p1", cantidad: 10, cantidadPromocion: 2 },
        { presentacionId: "p2", cantidad: 3, cantidadPromocion: 0 },
      ],
    });
    expect(onGuardada).toHaveBeenCalledWith({ ...VENTA, montoCentavos: 9000 });
  });

  it("una venta de la tablet no ofrece Oficina", async () => {
    await prepararFormulario({ ...VENTA, origen: "app" });
    expect(screen.queryByRole("option", { name: "Oficina" })).not.toBeInTheDocument();
  });

  it("una venta del portal sí ofrece Oficina, y elegirla manda vendedorId null", async () => {
    const { usuario } = await prepararFormulario();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(editarVenta.mock.calls[0][1].vendedorId).toBeNull();
  });

  // Review Focus 2
  it("conserva como opción al repartidor actual aunque ya no esté activo", async () => {
    listarRepartidores.mockResolvedValue([{ id: "v-luis", nombre: "Luis Ruiz" }]);
    const { usuario } = await prepararFormulario();
    expect(screen.getByLabelText("Repartidor")).toHaveValue("v-ana");
    expect(await screen.findByRole("option", { name: "Ana Pérez (inactivo)" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(editarVenta.mock.calls[0][1].vendedorId).toBe("v-ana");
  });

  it("una venta de contado propone el método de su cobro", async () => {
    const { usuario } = await prepararFormulario({
      ...VENTA,
      contadoCredito: "contado",
      cobros: [
        { id: "a1", fechaPago: "2024-03-04", metodoPago: "efectivo", montoCentavos: 21600, origen: "venta_contado" },
      ],
    });
    expect(screen.getByLabelText("Método de pago")).toHaveValue("efectivo");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(editarVenta.mock.calls[0][1]).toMatchObject({ contadoCredito: "contado", metodoPago: "efectivo" });
  });

  it("muestra el mensaje del servidor", async () => {
    editarVenta.mockRejectedValue(new ErrorApi("fallo", 409, "Ya existe la nota 77 en esta sucursal."));
    const { usuario, onGuardada } = await prepararFormulario();
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe la nota 77 en esta sucursal.");
    expect(onGuardada).not.toHaveBeenCalled();
  });

  it("sin productos no manda nada", async () => {
    const { usuario } = await prepararFormulario();
    await usuario.clear(screen.getByLabelText("Cantidad de Horchata 1 L"));
    await usuario.clear(screen.getByLabelText("Promoción de Horchata 1 L"));
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Captura al menos un producto.");
    expect(editarVenta).not.toHaveBeenCalled();
  });

  // Review Focus 5
  it("doble clic en Guardar graba una sola vez", async () => {
    let terminar!: (v: VentaDetalle) => void;
    editarVenta.mockReturnValue(
      new Promise<VentaDetalle>((r) => {
        terminar = r;
      }),
    );
    const { usuario, onGuardada } = await prepararFormulario();
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await usuario.click(screen.getByRole("button", { name: "Guardando…" }));
    expect(editarVenta).toHaveBeenCalledTimes(1);
    terminar(VENTA);
    await vi.waitFor(() => expect(onGuardada).toHaveBeenCalledTimes(1));
  });

  it("Cancelar no graba", async () => {
    const { usuario, onCancelar } = await prepararFormulario();
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(editarVenta).not.toHaveBeenCalled();
  });
});
```

Run: `npm test --workspace=apps/portal -- formulario-editar-venta`
Expected: FAIL — `./formulario-editar-venta` no existe.

- [ ] **Step 6: Implementar el formulario de edición**

Crear `apps/portal/src/components/ventas/formulario-editar-venta.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  REPARTIDOR_OFICINA,
  camposDeCondiciones,
  capturaDeLineas,
  conCaptura,
  condicionesDeVenta,
  editarVenta,
  filasDeEdicion,
  formatearPesos,
  lineasDeCaptura,
  listarRepartidores,
  obtenerCatalogoVenta,
  totalDeCaptura,
  type Captura,
  type CondicionesVenta,
  type PresentacionDeCatalogo,
  type Repartidor,
  type VentaDetalle,
} from "@/lib/ventas";
import { CamposCondicionesVenta } from "./campos-condiciones-venta";
import { SelectorRepartidor } from "./selector-repartidor";
import { TablaProductosVenta } from "./tabla-productos-venta";

/**
 * Editar una venta (T-17, parte 2, §3.3): el mismo formulario que "Registrar
 * venta" con el cliente y la fecha fijos. Las líneas existentes muestran su
 * precio guardado; las presentaciones nuevas, el de la lista a la fecha de la
 * venta. El servidor vuelve a resolver todo al grabar.
 */
export function FormularioEditarVenta({
  venta,
  onGuardada,
  onCancelar,
}: {
  venta: VentaDetalle;
  onGuardada: (actualizada: VentaDetalle) => void;
  onCancelar: () => void;
}) {
  const [catalogo, setCatalogo] = useState<PresentacionDeCatalogo[]>([]);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [cargado, setCargado] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [repartidor, setRepartidor] = useState(venta.vendedorId ?? REPARTIDOR_OFICINA);
  const [captura, setCaptura] = useState<Captura>(() => capturaDeLineas(venta.lineas));
  const [condiciones, setCondiciones] = useState<CondicionesVenta>(() => condicionesDeVenta(venta));
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar la venta.");

  useEffect(() => {
    let vigente = true;
    Promise.all([
      obtenerCatalogoVenta(venta.clienteId, venta.fecha),
      listarRepartidores(venta.sucursalId),
    ])
      .then(([lista, activos]) => {
        if (!vigente) return;
        setCatalogo(lista);
        setRepartidores(activos);
        setCargado(true);
      })
      .catch(() => {
        if (vigente) setErrorCarga("No se pudieron cargar los productos y repartidores de la venta.");
      });
    return () => {
      vigente = false;
    };
  }, [venta.clienteId, venta.fecha, venta.sucursalId]);

  const filas = useMemo(() => filasDeEdicion(venta.lineas, catalogo), [venta.lineas, catalogo]);
  const totalCentavos = totalDeCaptura(filas, captura);

  // El repartidor actual pudo darse de baja: se conserva como opción para no
  // cambiárselo sin querer (el servidor no lo re-valida si no cambia).
  const opciones = useMemo(() => {
    const actual = venta.vendedorId;
    if (actual === null || repartidores.some((r) => r.id === actual)) return repartidores;
    const nombre = venta.repartidor ?? "Vendedor";
    return [...repartidores, { id: actual, nombre: cargado ? `${nombre} (inactivo)` : nombre }];
  }, [repartidores, cargado, venta.vendedorId, venta.repartidor]);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErrorLocal(null);
    if (repartidor === "") {
      setErrorLocal("Elige el repartidor.");
      return;
    }
    const armadas = lineasDeCaptura(filas, captura);
    if (!armadas.ok) {
      setErrorLocal(armadas.error);
      return;
    }
    await enviar(
      async () => {
        onGuardada(
          await editarVenta(venta.id, {
            vendedorId: repartidor === REPARTIDOR_OFICINA ? null : repartidor,
            ...camposDeCondiciones(condiciones),
            lineas: armadas.lineas,
          }),
        );
      },
      () => {},
    );
  }

  const mensajeError = errorLocal ?? error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar venta {venta.folio}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={alEnviar} className="flex flex-col gap-5">
          {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Fecha</span>
              <span>{venta.fecha}</span>
            </div>
            <div className="flex min-w-72 flex-1 flex-col gap-1.5 text-sm">
              <span className="font-medium">Cliente</span>
              <span>
                {venta.cliente} · {venta.sucursalCodigo}
              </span>
            </div>
            <SelectorRepartidor
              repartidores={opciones}
              valor={repartidor}
              onCambio={setRepartidor}
              disabled={enviando}
              conOficina={venta.origen === "portal"}
            />
          </div>

          <TablaProductosVenta
            filas={filas}
            captura={captura}
            onCambio={(id, campo, valor) => setCaptura((actual) => conCaptura(actual, id, campo, valor))}
            disabled={enviando}
          />

          <p className="text-right text-base font-semibold">Total: {formatearPesos(totalCentavos)}</p>

          <CamposCondicionesVenta
            valores={condiciones}
            onCambio={(cambio) => setCondiciones((actual) => ({ ...actual, ...cambio }))}
            disabled={enviando}
          />

          {mensajeError && (
            <p role="alert" className="text-sm text-destructive">
              {mensajeError}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={enviando}>
              {enviando ? "Guardando…" : "Guardar"}
            </Button>
            <Button type="button" variant="outline" disabled={enviando} onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Correr las pruebas del portal, lint y tipos**

```bash
npm test --workspace=apps/portal
npm run lint --workspace=apps/portal
npx tsc --noEmit -p apps/portal/tsconfig.json
git status --short
```

Expected: todo en verde; `git status` solo con archivos de esta tarea.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/lib/ventas.ts apps/portal/src/lib/ventas.test.ts apps/portal/src/components/ventas
git commit -m "$(cat <<'EOF'
T-17: portal — API de ventas, piezas compartidas del formulario y modo edicion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Portal — pantalla "Ventas": búsqueda, detalle y acciones

**Files:**
- Create: `apps/portal/src/components/ventas/detalle-venta.tsx`
- Create: `apps/portal/src/components/ventas/detalle-venta.test.tsx`
- Create: `apps/portal/src/components/ventas/pantalla-ventas.tsx`
- Create: `apps/portal/src/components/ventas/pantalla-ventas.test.tsx`
- Create: `apps/portal/src/app/(portal)/operacion/ventas/page.tsx`
- Modify: `apps/portal/src/components/layout/nav-config.ts`

**Interfaces:**
- Consumes (Task 5): `buscarVentas`, `obtenerVenta`, `eliminarVenta`, `marcarCuentaPerdida`, `ETIQUETA_STATUS`, `ETIQUETA_ORIGEN`, `formatearPesos`, `hoyEnTijuana`, tipos `VentaDetalle`, `ResultadoBusquedaVentas`; componentes `BuscadorCliente`, `FormularioEditarVenta`. De la parte 1: `listarClientes`, `useAuth().puede`, `useEnvioFormulario`, `ErrorApi`.
- Produces: `DetalleVenta({ venta, onVolver, onEditar, onCambiada, onEliminada })`, `PantallaVentas({ sucursal })`, la ruta `/operacion/ventas` y la entrada "Ventas" en Operación.

- [ ] **Step 1: Pruebas del detalle que fallan**

Crear `apps/portal/src/components/ventas/detalle-venta.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as ventasLib from "@/lib/ventas";
import type { VentaDetalle } from "@/lib/ventas";
import { DetalleVenta } from "./detalle-venta";

vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, eliminarVenta: vi.fn(), marcarCuentaPerdida: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const eliminarVenta = vi.mocked(ventasLib.eliminarVenta);
const marcarCuentaPerdida = vi.mocked(ventasLib.marcarCuentaPerdida);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

const VENTA: VentaDetalle = {
  id: "v1",
  folio: "TJ240304OF01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: null,
  repartidor: null,
  numNota: "1234",
  contadoCredito: "credito",
  factura: "N/A",
  comentarios: "Entregar temprano",
  montoCentavos: 27000,
  status: "abonado",
  origen: "portal",
  saldoCentavos: 17000,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 24,
      cantidadPromocion: 2,
      precioCentavos: 1000,
      subtotalCentavos: 24000,
    },
  ],
  cobros: [{ id: "a1", fechaPago: "2024-03-05", metodoPago: "efectivo", montoCentavos: 10000, origen: "cobro" }],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
};

function renderizar(venta: VentaDetalle = VENTA) {
  const props = { onVolver: vi.fn(), onEditar: vi.fn(), onCambiada: vi.fn(), onEliminada: vi.fn() };
  render(<DetalleVenta venta={venta} {...props} />);
  return { usuario: userEvent.setup(), ...props };
}

describe("DetalleVenta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockAuth(() => true);
  });

  it("muestra cabecera, líneas y cobros; sin vendedor es Oficina", () => {
    renderizar();
    expect(screen.getByText("Venta TJ240304OF01")).toBeInTheDocument();
    expect(screen.getByText("Oficina")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toBeInTheDocument();
    expect(screen.getByText("Entregar temprano")).toBeInTheDocument();
    expect(screen.getByText("Horchata 1 L")).toBeInTheDocument();
    expect(screen.getByText("$240.00")).toBeInTheDocument();
    expect(screen.getByText("$170.00")).toBeInTheDocument();
    expect(screen.getByText("Cobranza")).toBeInTheDocument();
  });

  it("con permiso, editable y por cobrar: Editar, Eliminar y Marcar como cuenta perdida", () => {
    renderizar();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como cuenta perdida" })).toBeInTheDocument();
  });

  it("no editable: sin Editar ni Eliminar, con el motivo", () => {
    renderizar({
      ...VENTA,
      editable: false,
      motivoNoEditable:
        "Esta venta tiene cobros registrados: no se puede editar ni eliminar. Para quitar un cobro, ver Peticiones.",
    });
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.getByText(/no se puede editar ni eliminar\. Para quitar un cobro, ver Peticiones\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como cuenta perdida" })).toBeInTheDocument();
  });

  it("sin el permiso venta.editar_eliminar: solo Volver", () => {
    mockAuth(() => false);
    renderizar();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como cuenta perdida" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("Editar avisa al padre", async () => {
    const { usuario, onEditar } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    expect(onEditar).toHaveBeenCalledTimes(1);
  });

  it("Eliminar pide confirmación y, si se cancela, no hace nada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(confirmar).toHaveBeenCalledWith("¿Eliminar la venta TJ240304OF01 (nota 1234)? No se puede deshacer.");
    expect(eliminarVenta).not.toHaveBeenCalled();
    expect(onEliminada).not.toHaveBeenCalled();
  });

  // Review Focus 5
  it("Eliminar confirmado llama una sola vez aunque se pulse dos veces, y avisa al terminar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let terminar!: (v: { id: string }) => void;
    eliminarVenta.mockReturnValue(
      new Promise<{ id: string }>((r) => {
        terminar = r;
      }),
    );
    const { usuario, onEliminada } = renderizar();
    const boton = screen.getByRole("button", { name: "Eliminar" });
    await usuario.click(boton);
    await usuario.click(boton);
    expect(eliminarVenta).toHaveBeenCalledTimes(1);
    expect(eliminarVenta).toHaveBeenCalledWith("v1");
    terminar({ id: "v1" });
    await vi.waitFor(() => expect(onEliminada).toHaveBeenCalledTimes(1));
  });

  it("Marcar como cuenta perdida confirma y entrega la venta actualizada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    const actualizada = { ...VENTA, status: "cuenta_perdida" as const, editable: false, puedeMarcarPerdida: false };
    marcarCuentaPerdida.mockResolvedValue(actualizada);
    const { usuario, onCambiada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Marcar como cuenta perdida" }));
    expect(confirmar).toHaveBeenCalledWith("La venta TJ240304OF01 dejará de cobrarse. ¿Continuar?");
    await vi.waitFor(() => expect(onCambiada).toHaveBeenCalledWith(actualizada));
  });

  it("muestra el mensaje del servidor", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarVenta.mockRejectedValue(new ErrorApi("fallo", 409, "Tiene cobros registrados: no se puede eliminar."));
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tiene cobros registrados: no se puede eliminar.");
    expect(onEliminada).not.toHaveBeenCalled();
  });
});
```

Run: `npm test --workspace=apps/portal -- detalle-venta`
Expected: FAIL — `./detalle-venta` no existe.

- [ ] **Step 2: Implementar el detalle**

Crear `apps/portal/src/components/ventas/detalle-venta.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  ETIQUETA_ORIGEN,
  ETIQUETA_STATUS,
  eliminarVenta,
  formatearPesos,
  marcarCuentaPerdida,
  type VentaDetalle,
} from "@/lib/ventas";

const ETIQUETA_COBRO: Record<VentaDetalle["cobros"][number]["origen"], string> = {
  venta_contado: "Cobro de contado",
  cobro: "Cobranza",
};

const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
};

/**
 * El detalle de una venta y sus acciones (T-17, parte 2, §3.2). Los botones
 * salen de las banderas del servidor (`editable`, `puedeMarcarPerdida`) Y del
 * permiso `venta.editar_eliminar`: el servidor no conoce la pantalla y la
 * pantalla no decide reglas de la venta.
 */
export function DetalleVenta({
  venta,
  onVolver,
  onEditar,
  onCambiada,
  onEliminada,
}: {
  venta: VentaDetalle;
  onVolver: () => void;
  onEditar: () => void;
  onCambiada: (actualizada: VentaDetalle) => void;
  onEliminada: () => void;
}) {
  const { puede } = useAuth();
  const puedeGestionar = puede("venta.editar_eliminar");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo completar la acción.");

  async function eliminar() {
    if (!window.confirm(`¿Eliminar la venta ${venta.folio} (nota ${venta.numNota})? No se puede deshacer.`)) {
      return;
    }
    await enviar(() => eliminarVenta(venta.id), onEliminada);
  }

  async function marcarPerdida() {
    if (!window.confirm(`La venta ${venta.folio} dejará de cobrarse. ¿Continuar?`)) return;
    await enviar(
      async () => {
        onCambiada(await marcarCuentaPerdida(venta.id));
      },
      () => {},
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Venta {venta.folio}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <Dato etiqueta="Fecha" valor={venta.fecha} />
          <Dato etiqueta="Cliente" valor={`${venta.cliente} · ${venta.sucursalCodigo}`} />
          <Dato etiqueta="Repartidor" valor={venta.repartidor ?? "Oficina"} />
          <Dato etiqueta="# de nota" valor={venta.numNota} />
          <Dato etiqueta="Contado o crédito" valor={venta.contadoCredito === "contado" ? "Contado" : "Crédito"} />
          <Dato etiqueta="Factura" valor={venta.factura} />
          <Dato etiqueta="Status" valor={ETIQUETA_STATUS[venta.status]} />
          <Dato etiqueta="Origen" valor={ETIQUETA_ORIGEN[venta.origen]} />
          <Dato etiqueta="Monto" valor={formatearPesos(venta.montoCentavos)} />
          <Dato etiqueta="Saldo pendiente" valor={formatearPesos(venta.saldoCentavos)} />
          {venta.comentarios && <Dato etiqueta="Comentarios" valor={venta.comentarios} />}
        </dl>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Producto</th>
              <th className="py-1 font-medium">Cantidad</th>
              <th className="py-1 font-medium">Promoción</th>
              <th className="py-1 font-medium">Precio</th>
              <th className="py-1 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {venta.lineas.map((l) => (
              <tr key={l.presentacionId} className="border-t">
                <td className="py-1.5">{`${l.producto} ${l.volumen}`}</td>
                <td className="py-1.5">{l.cantidad}</td>
                <td className="py-1.5">{l.cantidadPromocion}</td>
                <td className="py-1.5">{formatearPesos(l.precioCentavos)}</td>
                <td className="py-1.5 text-right">{formatearPesos(l.subtotalCentavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Cobros</h3>
          {venta.cobros.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cobros.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Fecha</th>
                  <th className="py-1 font-medium">Método</th>
                  <th className="py-1 font-medium">Origen</th>
                  <th className="py-1 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {venta.cobros.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-1.5">{c.fechaPago}</td>
                    <td className="py-1.5">{ETIQUETA_METODO[c.metodoPago] ?? c.metodoPago}</td>
                    <td className="py-1.5">{ETIQUETA_COBRO[c.origen]}</td>
                    <td className="py-1.5 text-right">{formatearPesos(c.montoCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {venta.motivoNoEditable && (
          <p className="text-sm text-muted-foreground">{venta.motivoNoEditable}</p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {puedeGestionar && venta.editable && (
            <>
              <Button onClick={onEditar} disabled={enviando}>
                Editar
              </Button>
              <Button variant="destructive" onClick={eliminar} disabled={enviando}>
                Eliminar
              </Button>
            </>
          )}
          {puedeGestionar && venta.puedeMarcarPerdida && (
            <Button variant="outline" onClick={marcarPerdida} disabled={enviando}>
              Marcar como cuenta perdida
            </Button>
          )}
          <Button variant="ghost" onClick={onVolver} disabled={enviando}>
            Volver
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}
```

Run: `npm test --workspace=apps/portal -- detalle-venta`
Expected: PASS (9 pruebas).

- [ ] **Step 3: Pruebas de la pantalla que fallan**

Crear `apps/portal/src/components/ventas/pantalla-ventas.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as ventasLib from "@/lib/ventas";
import type { ResultadoBusquedaVentas, VentaDetalle } from "@/lib/ventas";
import { PantallaVentas } from "./pantalla-ventas";

// Mismo límite que pantalla-registrar-venta.test.tsx: se mockea la capa de red
// (lib/*.ts); las utilidades puras de lib/ventas se conservan.
vi.mock("@/lib/clientes");
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    buscarVentas: vi.fn(),
    obtenerVenta: vi.fn(),
    eliminarVenta: vi.fn(),
    marcarCuentaPerdida: vi.fn(),
    editarVenta: vi.fn(),
    obtenerCatalogoVenta: vi.fn(),
    listarRepartidores: vi.fn(),
  };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const buscarVentas = vi.mocked(ventasLib.buscarVentas);
const obtenerVenta = vi.mocked(ventasLib.obtenerVenta);
const eliminarVenta = vi.mocked(ventasLib.eliminarVenta);
const editarVenta = vi.mocked(ventasLib.editarVenta);
const obtenerCatalogoVenta = vi.mocked(ventasLib.obtenerCatalogoVenta);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);

const CLIENTE: ClienteResumen = {
  id: "c1",
  nombre: "Abarrotes Lupita",
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
};

const RESULTADO: ResultadoBusquedaVentas = {
  hayMas: false,
  ventas: [
    {
      id: "v1",
      folio: "TJ240304AP01",
      fecha: "2024-03-04",
      clienteId: "c1",
      cliente: "Abarrotes Lupita",
      repartidor: null,
      numNota: "1234",
      montoCentavos: 27000,
      status: "pendiente",
      origen: "app",
      saldoCentavos: 17000,
    },
  ],
};

const DETALLE: VentaDetalle = {
  id: "v1",
  folio: "TJ240304AP01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: "v-ana",
  repartidor: "Ana Pérez",
  numNota: "1234",
  contadoCredito: "credito",
  factura: "N/A",
  comentarios: null,
  montoCentavos: 27000,
  status: "pendiente",
  origen: "app",
  saldoCentavos: 27000,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 30,
      cantidadPromocion: 0,
      precioCentavos: 900,
      subtotalCentavos: 27000,
    },
  ],
  cobros: [],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
};

describe("PantallaVentas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    listarClientes.mockResolvedValue([CLIENTE]);
    buscarVentas.mockResolvedValue(RESULTADO);
    obtenerVenta.mockResolvedValue(DETALLE);
    obtenerCatalogoVenta.mockResolvedValue([
      { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
    ]);
    listarRepartidores.mockResolvedValue([{ id: "v-ana", nombre: "Ana Pérez" }]);
  });

  it("busca al abrir con hoy en Tijuana y pinta la tabla", async () => {
    render(<PantallaVentas sucursal={null} />);
    const hoy = ventasLib.hoyEnTijuana();
    expect(await screen.findByRole("button", { name: "TJ240304AP01" })).toBeInTheDocument();
    expect(buscarVentas).toHaveBeenCalledWith({ desde: hoy, hasta: hoy, sucursal: null, clienteId: null, numNota: "" });
    expect(screen.getByText("Oficina")).toBeInTheDocument();
    expect(screen.getByText("Tablet")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("$270.00")).toBeInTheDocument();
    expect(screen.getByText("$170.00")).toBeInTheDocument();
  });

  it("aplica los filtros al pulsar Buscar, con la sucursal del selector", async () => {
    const usuario = userEvent.setup();
    render(<PantallaVentas sucursal="TJ" />);
    await screen.findByRole("button", { name: "TJ240304AP01" });

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2024-03-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2024-03-31" } });
    await usuario.type(screen.getByLabelText("Cliente"), "lupi");
    await usuario.click(await screen.findByRole("button", { name: /Abarrotes Lupita · TJ/ }));
    await usuario.type(screen.getByLabelText("# de nota"), "1234");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() =>
      expect(buscarVentas).toHaveBeenLastCalledWith({
        desde: "2024-03-01",
        hasta: "2024-03-31",
        sucursal: "TJ",
        clienteId: "c1",
        numNota: "1234",
      }),
    );
  });

  it("avisa cuando hay más de 200 ventas", async () => {
    buscarVentas.mockResolvedValue({ ...RESULTADO, hayMas: true });
    render(<PantallaVentas sucursal={null} />);
    expect(
      await screen.findByText("Hay más de 200 ventas: acota el rango o filtra por cliente."),
    ).toBeInTheDocument();
  });

  it("al elegir una venta muestra su detalle; Volver conserva los filtros y vuelve a buscar", async () => {
    const usuario = userEvent.setup();
    render(<PantallaVentas sucursal={null} />);
    await screen.findByRole("button", { name: "TJ240304AP01" });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2024-03-01" } });
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));

    await usuario.click(screen.getByRole("button", { name: "TJ240304AP01" }));
    expect(await screen.findByText("Venta TJ240304AP01")).toBeInTheDocument();
    expect(obtenerVenta).toHaveBeenCalledWith("v1");

    await usuario.click(screen.getByRole("button", { name: "Volver" }));
    expect(await screen.findByLabelText("Desde")).toHaveValue("2024-03-01");
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(3));
    expect(buscarVentas).toHaveBeenLastCalledWith(expect.objectContaining({ desde: "2024-03-01" }));
  });

  it("Editar abre el formulario (sin Oficina en una venta de tablet) y al guardar muestra la venta actualizada", async () => {
    const usuario = userEvent.setup();
    editarVenta.mockResolvedValue({ ...DETALLE, montoCentavos: 9000, numNota: "1235" });
    render(<PantallaVentas sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "TJ240304AP01" }));
    await usuario.click(await screen.findByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Editar venta TJ240304AP01")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Ana Pérez" });
    expect(screen.queryByRole("option", { name: "Oficina" })).not.toBeInTheDocument();

    const nota = screen.getByLabelText("Número de nota");
    await usuario.clear(nota);
    await usuario.type(nota, "1235");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Venta TJ240304AP01")).toBeInTheDocument();
    expect(screen.getByText("1235")).toBeInTheDocument();
    expect(editarVenta).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({ numNota: "1235", vendedorId: "v-ana" }),
    );
  });

  it("Eliminar confirmado vuelve a la búsqueda y la refresca", async () => {
    const usuario = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarVenta.mockResolvedValue({ id: "v1" });
    render(<PantallaVentas sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "TJ240304AP01" }));
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("button", { name: "Buscar" })).toBeInTheDocument();
    await waitFor(() => expect(buscarVentas).toHaveBeenCalledTimes(2));
  });
});
```

Run: `npm test --workspace=apps/portal -- pantalla-ventas`
Expected: FAIL — `./pantalla-ventas` no existe.

- [ ] **Step 4: Implementar la pantalla, la ruta y el menú**

Crear `apps/portal/src/components/ventas/pantalla-ventas.tsx`:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorApi } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  ETIQUETA_ORIGEN,
  ETIQUETA_STATUS,
  buscarVentas,
  formatearPesos,
  hoyEnTijuana,
  obtenerVenta,
  type ResultadoBusquedaVentas,
  type VentaDetalle,
} from "@/lib/ventas";
import { BuscadorCliente } from "./buscador-cliente";
import { DetalleVenta } from "./detalle-venta";
import { FormularioEditarVenta } from "./formulario-editar-venta";

interface Filtro {
  desde: string;
  hasta: string;
  cliente: ClienteResumen | null;
  numNota: string;
}

type Vista =
  | { tipo: "busqueda" }
  | { tipo: "detalle"; venta: VentaDetalle }
  | { tipo: "edicion"; venta: VentaDetalle };

function filtroDeHoy(): Filtro {
  const hoy = hoyEnTijuana();
  return { desde: hoy, hasta: hoy, cliente: null, numNota: "" };
}

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorApi && err.mensajeApi ? err.mensajeApi : porDefecto;
}

/**
 * Ventas (T-17, parte 2, §3): buscar por rango de fechas, cliente y # de nota;
 * ver el detalle; editar, eliminar o marcar como cuenta perdida. Vale para las
 * ventas de la tablet y del portal.
 *
 * Los filtros viven aquí y no en la vista de búsqueda: así "Volver" regresa
 * con los mismos filtros y vuelve a buscar (la venta pudo cambiar).
 */
export function PantallaVentas({ sucursal }: { sucursal: string | null }) {
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [borrador, setBorrador] = useState<Filtro>(filtroDeHoy);
  const [aplicado, setAplicado] = useState<Filtro>(filtroDeHoy);
  const [resultado, setResultado] = useState<ResultadoBusquedaVentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>({ tipo: "busqueda" });

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  // Cada `setAplicado` (Buscar, Volver) es un objeto nuevo: vuelve a buscar.
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    buscarVentas({
      desde: aplicado.desde,
      hasta: aplicado.hasta,
      sucursal,
      clienteId: aplicado.cliente?.id ?? null,
      numNota: aplicado.numNota,
    })
      .then((r) => {
        if (!vigente) return;
        setResultado(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudieron buscar las ventas."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [aplicado, sucursal]);

  function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setAplicado({ ...borrador });
  }

  function volverABusqueda() {
    setVista({ tipo: "busqueda" });
    setAplicado((actual) => ({ ...actual }));
  }

  async function abrir(id: string) {
    setError(null);
    try {
      setVista({ tipo: "detalle", venta: await obtenerVenta(id) });
    } catch (err) {
      setError(mensajeDe(err, "No se pudo abrir la venta."));
    }
  }

  if (vista.tipo === "edicion") {
    return (
      <FormularioEditarVenta
        venta={vista.venta}
        onGuardada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onCancelar={() => setVista({ tipo: "detalle", venta: vista.venta })}
      />
    );
  }

  if (vista.tipo === "detalle") {
    return (
      <DetalleVenta
        venta={vista.venta}
        onVolver={volverABusqueda}
        onEditar={() => setVista({ tipo: "edicion", venta: vista.venta })}
        onCambiada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onEliminada={volverABusqueda}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ventas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={alBuscar} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="desde" className="text-sm font-medium">
              Desde
            </label>
            <input
              id="desde"
              type="date"
              required
              value={borrador.desde}
              onChange={(e) => setBorrador({ ...borrador, desde: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="hasta" className="text-sm font-medium">
              Hasta
            </label>
            <input
              id="hasta"
              type="date"
              required
              value={borrador.hasta}
              onChange={(e) => setBorrador({ ...borrador, hasta: e.target.value })}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <BuscadorCliente
            clientes={clientes}
            cliente={borrador.cliente}
            onElegir={(cliente) => setBorrador({ ...borrador, cliente })}
            onQuitar={() => setBorrador({ ...borrador, cliente: null })}
            etiquetaQuitar="Quitar"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="buscar-num-nota" className="text-sm font-medium">
              # de nota
            </label>
            <input
              id="buscar-num-nota"
              maxLength={30}
              value={borrador.numNota}
              onChange={(e) => setBorrador({ ...borrador, numNota: e.target.value })}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={cargando}>
            Buscar
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {resultado?.hayMas && (
          <p className="text-sm text-muted-foreground">
            Hay más de 200 ventas: acota el rango o filtra por cliente.
          </p>
        )}

        {resultado && resultado.ventas.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay ventas con esos filtros.</p>
        )}

        {resultado && resultado.ventas.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">Folio</th>
                <th className="py-1 font-medium">Fecha</th>
                <th className="py-1 font-medium">Cliente</th>
                <th className="py-1 font-medium">Repartidor</th>
                <th className="py-1 font-medium"># de nota</th>
                <th className="py-1 text-right font-medium">Monto</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 font-medium">Origen</th>
                <th className="py-1 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {resultado.ventas.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => void abrir(v.id)}
                      className="font-mono underline-offset-2 hover:underline"
                    >
                      {v.folio}
                    </button>
                  </td>
                  <td className="py-1.5">{v.fecha}</td>
                  <td className="py-1.5">{v.cliente}</td>
                  <td className="py-1.5">{v.repartidor ?? "Oficina"}</td>
                  <td className="py-1.5">{v.numNota}</td>
                  <td className="py-1.5 text-right">{formatearPesos(v.montoCentavos)}</td>
                  <td className="py-1.5">{ETIQUETA_STATUS[v.status]}</td>
                  <td className="py-1.5">{ETIQUETA_ORIGEN[v.origen]}</td>
                  <td className="py-1.5 text-right">{formatearPesos(v.saldoCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
```

Crear `apps/portal/src/app/(portal)/operacion/ventas/page.tsx`:

```tsx
import { PantallaVentas } from "@/components/ventas/pantalla-ventas";

// Server component delgado (mismo patron que /operacion/registrar-venta): solo
// lee el filtro de sucursal; en Next 15 `searchParams` es una promesa.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaVentas sucursal={sucursal ?? null} />;
}
```

En `apps/portal/src/components/layout/nav-config.ts`, después de la línea de "Registrar venta":

```ts
      { label: "Ventas", href: "/operacion/ventas" },
```

- [ ] **Step 5: Correr las pruebas del portal, lint y tipos**

```bash
npm test --workspace=apps/portal
npm run lint --workspace=apps/portal
npx tsc --noEmit -p apps/portal/tsconfig.json
git status --short
```

Expected: todo en verde; `git status` solo con archivos de esta tarea.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/ventas apps/portal/src/components/layout/nav-config.ts "apps/portal/src/app/(portal)/operacion/ventas/page.tsx"
git commit -m "$(cat <<'EOF'
T-17: portal — pantalla Ventas: buscar, ver detalle, editar, eliminar y cuenta perdida

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Verificación manual en el navegador, CLAUDE.md y vault (la corre el controlador)

**Files:**
- Modify: `CLAUDE.md` (sección "Folios (T-14)", al final de sus viñetas de T-17)
- Vault (`../jawa-obsidian-memory`, repo aparte): notas de dominio y `00-Inicio/Estado del proyecto.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia de la verificación manual para el PR; CLAUDE.md y vault al día; base local limpia.

- [ ] **Step 1: Suites completas**

```bash
npm run supabase -- test db
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend
npm test --workspace=apps/portal && npm run lint --workspace=apps/portal
npx tsc --noEmit -p apps/portal/tsconfig.json
npm run typecheck --workspace=apps/tablet && npm test --workspace=apps/tablet
git diff main --stat -- apps/backend/src/modules/sincronizacion/contrato.ts apps/tablet/src/sincronizacion/contrato.ts docs/contrato-sincronizacion.md
```

Expected: todo en verde; el último comando no muestra cambios (el contrato no cambió).

- [ ] **Step 2: Levantar backend y portal contra el Postgres LOCAL**

El puerto 3000 está ocupado en esta máquina, y `npm run backend` apunta a `sinmex dev` por defecto: se sobrescribe `DATABASE_URL` con la de `.env.test` (las variables del proceso ganan a las del archivo).

```bash
# Terminal 1 — backend en 3010 contra la base local
DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" PORT=3010 npm run backend
# Terminal 2 — portal (3001) apuntando a ese backend
NEXT_PUBLIC_API_URL=http://localhost:3010 npm run portal
```

Comprobar: `curl -s http://localhost:3010/health` responde OK.

Si hace falta un usuario del portal en la base local (también con la URL local, **nunca** contra la nube):

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)" npm run crear-usuario --workspace=apps/backend
```

(uno con perfil `Administrador General` sin sucursal, y otro con `Auxiliar Administrativo` para el punto 9.)

- [ ] **Step 3: Sembrar datos de prueba (y anotarlos para borrarlos en el Step 6)**

Desde el portal (o reutilizando lo de la verificación de la parte 1, si sigue en la base): un producto **"ZZ Manual T17b"** con presentaciones `1 L` y `500 ml`, precio de "Lista 1" en TJ solo para la `1 L`, un cliente **"ZZ Manual T17b Cliente"** en TJ con Lista 1 y un vendedor activo en TJ. Con "Registrar venta" (`/operacion/registrar-venta`) grabar hoy:

- **A:** Oficina, contado (transferencia), 10 de `1 L`, nota `zzm-1`.
- **B:** a nombre del vendedor, crédito, 5 de `1 L`, nota `zzm-2`.
- **C:** a nombre del vendedor, crédito, 2 de `1 L`, nota `zzm-3`.

- [ ] **Step 4: Recorrido en `http://localhost:3001/operacion/ventas`**

Anotar el resultado de cada punto para el PR:

1. La entrada "Ventas" aparece en Operación debajo de "Registrar venta"; al abrir busca hoy y muestra A, B y C con folio, cliente, repartidor ("Oficina" en A), # de nota, monto, status, origen "Portal" y saldo (0 en A).
2. Buscar por # de nota `  ZZM-2 ` (mayúsculas y espacios): solo B. Filtrar por cliente: las tres. Un rango "desde" posterior a "hasta": mensaje del servidor, sin pantalla rota.
3. Abrir **A**: líneas, cobro "Cobro de contado · Transferencia", botones Editar/Eliminar (no "Marcar como cuenta perdida", está pagada).
4. **Editar A:** cliente y fecha en solo lectura; la `500 ml` aparece deshabilitada "sin precio en la lista"; cambiar a 12 piezas, pasar a crédito y guardar → el detalle muestra el monto nuevo, status Pendiente y "Sin cobros". "Volver" regresa a la búsqueda con los mismos filtros y la fila de A ya actualizada.
5. **Editar B:** cambiar el # de nota a `zzm-1` → "Ya existe la nota zzm-1 en esta sucursal."; restaurarlo y pasar a contado con efectivo → status Pagada y cobro en efectivo.
6. **Eliminar C:** la confirmación dice "¿Eliminar la venta {folio} (nota zzm-3)? No se puede deshacer."; al aceptar vuelve a la búsqueda sin C. Registrar otra venta con nota `zzm-3`: se acepta, con un folio OF distinto.
7. **Cuenta perdida en A** (ahora a crédito): confirmación "La venta {folio} dejará de cobrarse. ¿Continuar?" → status "Cuenta perdida", ya sin Editar/Eliminar, con el motivo de cuenta perdida.
8. Comprobar en la base:

```bash
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -c "select folio, num_nota, status, contado_credito, monto_total, actualizado_por_usuario_id is not null as editada, eliminado_por_usuario_id is not null as eliminada, deleted_at is not null as borrada from venta_nota where num_nota like 'zzm-%' order by created_at;"
docker exec -i supabase_db_proyecto-sinmex psql -U postgres -c "select vn.num_nota, ca.metodo_pago, ca.monto, ca.origen, ca.deleted_at is not null as borrado from cobranza_abono ca join venta_nota vn on vn.id = ca.venta_nota_id where vn.num_nota like 'zzm-%' order by ca.created_at;"
```

Expected: A en `cuenta_perdida` con `editada = t` y su cobro de contado borrado; B `pagada` con un cobro `transferencia`/… borrado y uno `efectivo` vivo; C `borrada = t`, `eliminada = t`, y la nueva `zzm-3` viva.

9. Con el usuario `Auxiliar Administrativo`: la búsqueda y el detalle cargan, pero sin Editar/Eliminar/Marcar como cuenta perdida.

- [ ] **Step 5: Apagar backend y portal** (Ctrl+C en las dos terminales).

- [ ] **Step 6: Borrar los datos sembrados y comprobar pgTAP**

Los precios de "Lista 1"/TJ que queden rompen `30_precios_test.sql`. Borrar todo lo de la verificación (ajustar los nombres si se usaron otros):

```bash
docker exec -i supabase_db_proyecto-sinmex psql -U postgres <<'SQL'
begin;
create temporary table _zz on commit drop as
  select vn.id from venta_nota vn join cliente c on c.id = vn.cliente_id
   where c.nombre = 'ZZ Manual T17b Cliente';
delete from cobranza_abono where venta_nota_id in (select id from _zz);
delete from venta_nota_detalle where venta_nota_id in (select id from _zz);
delete from venta_nota where id in (select id from _zz);
delete from precio where presentacion_id in (
  select pr.id from presentacion pr join producto p on p.id = pr.producto_id where p.nombre = 'ZZ Manual T17b');
delete from cliente_precio where cliente_id in (select id from cliente where nombre = 'ZZ Manual T17b Cliente');
delete from cliente where nombre = 'ZZ Manual T17b Cliente';
delete from presentacion where producto_id in (select id from producto where nombre = 'ZZ Manual T17b');
delete from producto where nombre = 'ZZ Manual T17b';
commit;
SQL
npm run supabase -- test db
```

Expected: `30_precios_test.sql` y todos los demás en verde. El vendedor y los usuarios de prueba pueden quedarse (no afectan pgTAP); si se crearon solo para esto, darlos de baja desde el portal.

- [ ] **Step 7: CLAUDE.md**

En `CLAUDE.md`, sección **Folios (T-14)**, agregar después de la viñeta "**Una venta de mostrador no tiene vendedor** …":

```markdown
- **Toda corrección de una venta va por el portal (T-17, parte 2)**, venga de la tablet o del
  portal: `PATCH`/`DELETE /ventas/:id` y `POST /ventas/:id/cuenta-perdida`
  (`ventas-cobranza/ventas-edicion.service.ts`), con `venta.editar_eliminar`. Bloquean la venta
  con `for update of vn` y **nunca** cambian folio, cliente, fecha, sucursal ni origen; un folio
  eliminado no se reutiliza. Una venta con abonos vivos `origen = 'cobro'` (o en cuenta perdida)
  no se edita ni se elimina — quitar cobros es T-34. Las líneas existentes conservan su precio
  guardado; las nuevas toman la lista **a la fecha de la venta**. `uq_venta_detalle_presentacion`
  es un índice **parcial** (`where deleted_at is null`) para poder reagregar una presentación.
```

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
T-17: CLAUDE.md anota como se corrigen las ventas desde el portal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Vault (`../jawa-obsidian-memory`, según su `AGENTS.md`)**

- Actualizar la nota de dominio de Venta-Nota (búsqueda/edición/eliminación desde el portal, auditoría `actualizado_por`/`eliminado_por`, ventas con abonos de cobranza bloqueadas, precio guardado vs. lista a la fecha) y la de Status de venta (`cuenta_perdida` se asigna desde el portal, sin deshacer; una cuenta perdida no se edita).
- `00-Inicio/Estado del proyecto.md`: T-17 parte 2 implementada en la rama `feature/t-17b-editar-venta` (pendiente de PR).
- Anotar como **pendiente** (no decidido): bloquear la edición de días ya cortados cuando exista T-33 (§8).
- Commit y push del vault según su `AGENTS.md`. Nunca editar `90-Fuentes/`.

- [ ] **Step 9: Notas para el PR (no se ejecutan aquí)**

Incluir en la descripción del PR:
- §4.5: la tablet no vuelve a bajar sus propias ventas; su historial local conserva lo que capturó. Lo que sí refleja la edición, la eliminación o la cuenta perdida es la lista de notas por cobrar, en el siguiente pull. El contrato de sincronización no cambia.
- §8: editar/eliminar una venta de contado cambia lo cobrado de ese día; cuando exista el corte de caja (T-33) hay que decidir si se bloquean días cortados.
- Para quien mergee y empuje a `sinmex dev` (Roberto, protocolo de CLAUDE.md): la migración no agrega checks, `not null` ni `unique` que puedan fallar (el índice parcial es más permisivo que la constraint que reemplaza), así que no hay pre-flight de conteo; anotar `migration list` antes y después en el comentario del PR mergeado.

---

## Discrepancias y decisiones del plan

- **Una venta en `cuenta_perdida` no se edita ni se elimina.** El spec solo bloquea por abonos de cobranza, pero recalcular el status al editar (§4.2 paso 5) la devolvería a `pendiente`: un "deshacer" que §6 deja fuera. Motivo propio en `accionesDeVenta`/`bloqueoDeEdicion` (Task 2).
- **Las banderas del detalle no incluyen el permiso.** `GET /ventas/:id` solo exige sesión; `editable`/`puedeMarcarPerdida` describen la venta y la pantalla las combina con `puede('venta.editar_eliminar')` (§3.2 pide las dos condiciones).
- **El repartidor solo se valida si cambia.** §4.2 paso 3 exige vendedor activo; el plan no re-valida al que ya tiene la venta, para que un vendedor dado de baja después no impida corregir sus ventas. La pantalla lo conserva como opción "(inactivo)".
- **Una línea existente no exige que su presentación siga vendiéndose**, y **una línea de promoción ($0) que gana piezas vendidas se trata como nueva** (precio de la lista a la fecha): §4.2 paso 4 no cubre ninguno de los dos casos (Review Focus 1 y 3).
- **Códigos y respuestas que el spec no fija:** `DELETE` → 200 `{ id }` (como `DELETE /clientes/:id`); `POST …/cuenta-perdida` → 201 con el detalle (como `convertir-a-cliente`); `PATCH` → 200 con el detalle. Mensajes 409: "Tiene cobros registrados: no se puede editar." / "… eliminar." y "Está marcada como cuenta perdida: no se puede …".
- **Búsqueda:** sin fechas, el servidor usa hoy en Tijuana; `desde > hasta` o un día imposible → 400; orden `fecha desc, folio`; el # de nota se compara con `lower(btrim())` como el índice de #95 (exacto, no parcial); el alcance se aplica sobre `venta_nota.sucursal_id`; el saldo es monto − abonos vivos (todos los orígenes).
- **Un `precioCentavos` en el cuerpo del `PATCH` se descarta en silencio** (el `whitelist` global), no se rechaza.
- **Reparto del portal:** piezas compartidas extraídas de "Registrar venta" en lugar de un componente con `modo` (justificación en "Estructura de archivos").
- **Timestamp de la migración:** `20261006180000`, posterior a la última de `main` (`20261006120000`).

# T-34 · Peticiones / Autorizaciones — borrar un cobro con autorización — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usa superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).
> Los encabezados son `### Tarea N:` (en español): el script `task-brief` solo reconoce `Task N`; extrae los
> briefs con el `awk` de la memoria del proyecto (cambiando `Task` por `Tarea`).

**Objetivo:** que la oficina pueda borrar un **pago completo** (cobro de la tablet, cobro del portal o
aplicación de saldo a favor) mediante una **petición** que alguien con `peticiones.gestionar` autoriza o
deniega desde la bandeja *Operación → Peticiones*, y que la nota vuelva a deber en el portal y en la tablet.

**Arquitectura:** una migración crea `cobro` (un renglón por pago), agrega `cobro_id` a `cobranza_abono` y a
`saldo_favor_movimiento`, rellena los cobros viejos con `rellenar_cobros_t34()` y crea `peticion`. Desde ahí
`CobranzasService.escribir` crea el `cobro` antes de sus filas. Una regla pura (`planearBorrado`) calcula qué
pasa al borrar; `CobrosBorradoService` la aplica con los mismos candados que el cobro (notas → saldo a favor →
pago); `PeticionesService` y dos controllers (`/peticiones`, `/cobros`) la exponen. En el portal: un panel
"Pedir borrado" en el detalle de venta y en Cobranza, y la bandeja en `/operacion/peticiones`.

**Stack:** NestJS + Kysely (backend), Postgres/Supabase + pgTAP (base), Next.js + Vitest + Testing Library
(portal). **La app de tablet no se toca.**

**Spec:** `docs/superpowers/specs/2026-10-13-t34-peticiones-borrar-cobro-design.md` — léelo antes de empezar.
Manda el spec; si este plan lo contradice (fuera de las desviaciones anotadas abajo), para y pregunta.

## Restricciones globales

- Rama `feature/t-34-peticiones-borrar-cobro`. Comandos **desde la raíz del repo**, con los scripts del
  workspace (`CLAUDE.md`). Pruebas con el stack local de Supabase arriba (`docker context ls`; en la Mac de
  Roberto, `colima start` y luego `npm run supabase start`). **Nunca** apuntes nada a `sinmex dev` (la nube):
  ni migraciones, ni pruebas, ni la prueba a mano.
- **No hagas `git push`, ni `gh pr`, ni `gh issue comment`.** La Tarea 8 deja los textos para quien coordina.
- **No toques `apps/tablet`** (Portal = Roberto, App = Mario). Si algo pareciera exigirlo, para y pregunta.
- Migración de Postgres (una sola): `supabase/migrations/20261013120000_peticiones_cobro.sql`. Aplicar con
  `npm run supabase -- migration up --local` (con el `--`) y regenerar tipos con
  `npm run db:types --workspace=apps/backend`. pgTAP: `npm run supabase -- test db`.
- Permisos: **ya existen** (T-05): `peticiones.gestionar` y `cobranza.editar_eliminar`. No se siembra ninguno
  y el conteo de claves de `93_permiso_sucursal_test.sql` no cambia.
- Endpoints (todos del portal, sesión de usuario; ninguno `@SoloApp()`):

  | Método y ruta | Permiso | Cuerpo / query | Respuesta |
  |---|---|---|---|
  | `GET /peticiones?status=pendiente\|historial&sucursal=` | `peticiones.gestionar` | — | `200` `PeticionEnBandeja[]` |
  | `GET /peticiones/:id/vista-previa` | `peticiones.gestionar` | — | `200` `VistaBorrado` |
  | `POST /peticiones/eliminar-cobro` | `cobranza.editar_eliminar` | `{ cobroId, motivo }` | `201` `PeticionEnBandeja` |
  | `POST /peticiones/:id/autorizar` | `peticiones.gestionar` | — | `200` `PeticionEnBandeja` |
  | `POST /peticiones/:id/denegar` | `peticiones.gestionar` | `{ comentario? }` | `200` `PeticionEnBandeja` |
  | `GET /cobros/:id/vista-borrado` | `cobranza.editar_eliminar` | — | `200` `VistaBorrado` |

- **Se borra el pago completo, nunca un pedazo:** el `cobro`, todas sus filas vivas de `cobranza_abono` y su
  `saldo_favor_movimiento`, con `deleted_at = now()`; el `cobro` además con `eliminado_por_usuario_id`.
- **El cobro automático de una venta de contado no es un pago:** su fila (`origen = 'venta_contado'`) va con
  `cobro_id` null y no se puede pedir su borrado (se corrige editando la venta, T-17).
- Status tras borrar, por nota del pago: `cuenta_perdida` se queda; si no, con lo que le queda abonado vivo:
  `0` → `pendiente`, `≥ monto_total` → `pagada`, si no `abonado`. Se escribe aunque no cambie (el trigger toca
  `updated_at` y el pull incremental la baja).
- **Candados al autorizar, en este orden:** la `peticion` (`for update`), las notas del cliente
  (`bloquearNotasDelCliente`), su saldo a favor (`bloquearSaldoFavor`), la fila de `cobro`. Las decisiones se
  toman **después** de los candados, nunca con lo que leyó la pantalla.
- Quien pide puede ser quien autoriza (decisión de Roberto, 2026-10-13).
- Alcance de sucursal: el de la **sucursal del cliente del pago** (`exigirAlcanceSobre`, 403). Se comprueba
  **antes** de decir si el pago está borrado, para no revelar nada de otra sucursal.
- Dinero: centavos enteros en el cable; `aPesos`/`aCentavos` en el servidor; nunca `parseFloat(x) * 100`.
- Fechas de la bandeja (`creadaEn`, `resueltaEn`): texto `AAAA-MM-DD HH:MM` en hora de Tijuana, formateado en
  SQL (`at time zone 'America/Tijuana'`).
- Mensajes exactos del **servidor** (los usan las pruebas y la pantalla):
  - `No existe ese cobro.` (404)
  - `Este cobro ya se borró.` (409)
  - `Este cobro ya tiene una petición de borrado pendiente.` (409)
  - `No existe esa petición.` (404)
  - `Esta petición ya fue resuelta.` (409)
  - `El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.` (409)
  - `Escribe el motivo de la petición.` (400) · `El motivo no puede pasar de 500 caracteres.` (400)
  - `El comentario no puede pasar de 500 caracteres.` (400) · `Elige pendientes o historial.` (400)
  - Interbloqueo (`40P01`/`40001`): reusa `MOTIVO_INTERBLOQUEO_COBRO` de T-21 (409). Nunca 500.
- Mensajes exactos del **portal**:
  - Sin permiso: `No tienes permiso para ver peticiones`
  - Etiqueta en el cobro: `Borrado pedido · pendiente`
  - Petición enviada: `Petición enviada: borrar el pago de ${formatearPesos(monto)} de ${cliente}.`
  - Autorizada: `Petición autorizada: se borró el pago de ${formatearPesos(monto)} de ${cliente}.`
  - Denegada: `Petición denegada: el pago de ${cliente} no cambia.`
  - Vacías: `No hay peticiones pendientes.` · `No hay peticiones resueltas.`
- Comentarios y nombres en español, sin acentos en identificadores, con la densidad de comentarios del código
  vecino. Commits con mensaje `T-34: …` que terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Desviaciones del spec (decididas al escribir el plan; anotadas en la Tarea 8 para el PR)

1. **Vista previa con dos rutas en vez de un "o" de permisos.** `@RequierePermiso` acepta una sola clave y el
   spec decía resolver el "o" en el servicio. Es más simple y más claro: `GET /cobros/:id/vista-borrado`
   (`cobranza.editar_eliminar`, para quien pide) y `GET /peticiones/:id/vista-previa` (`peticiones.gestionar`,
   para quien autoriza). Mismo servicio, misma respuesta.
2. **`ck_cobro_borrado` relajado** a `eliminado_por_usuario_id is null or deleted_at is not null`: el relleno
   puede encontrar filas de prueba ya borradas sin usuario que las borró. El servicio siempre pone los dos.
3. **El relleno es una función** (`rellenar_cobros_t34()`) que la migración llama y deja creada: así pgTAP la
   puede probar con filas sembradas a propósito (dos transacciones = dos pagos). Solo toca filas con
   `cobro_id` null, así que volver a llamarla no hace nada.
4. **Pruebas existentes que insertan cobros a mano** (pgTAP de T-20/T-21 y e2e de sincronización, cobranza y
   edición de ventas) ganan su `cobro`/`cobro_id`, y sus limpiezas borran `cobro` antes que `cliente`. Sin
   eso, los checks nuevos las rompen.
5. **Panel en la página, no un diálogo modal:** el portal no tiene componente de diálogo (`components/ui/`
   solo trae `button` y `card`); "Pedir borrado", "Autorizar" y "Denegar" abren un panel debajo de la tabla,
   como "Registrar pago" en Cobranza.
6. **Autorizar con bloqueo:** si la vista previa trae bloqueo, el botón "Confirmar y borrar" queda
   deshabilitado y se lee el motivo (el servidor lo rechazaría igual).
7. **La vista previa toma los mismos candados que el borrado** (en una transacción que no escribe), en vez de
   leer sin candados: es lo que ya hace la vista previa del cobro en T-21 (`planearPago`), y así vista previa y
   borrado son literalmente el mismo cálculo. Los candados duran lo que la consulta.

## Puntos de revisión (Review Focus)

1. **Autorizar mientras entra otro movimiento del mismo cliente** (un cobro de la tablet, otro pago o una
   aplicación de saldo a favor desde el portal): se serializa por el candado de las notas del cliente; si el
   saldo a favor que dejó el pago ya se aplicó, 409 con el mensaje y **nada cambia** (la petición sigue
   pendiente). → orden de candados en la Tarea 3 (unitaria) y saldo ya aplicado en la Tarea 4 (e2e).
2. **Dos personas resuelven la misma petición a la vez** (autorizar/autorizar o autorizar/denegar): una gana y
   la otra recibe `Esta petición ya fue resuelta.`; el pago se borra una sola vez. → Tarea 4 (e2e con
   `Promise.all`).
3. **Una nota del pago en cuenta perdida, o que otro pago sigue cubriendo**: `cuenta_perdida` no cambia; con
   abonos restantes queda `abonado` (o `pagada` si cubren el total). → Tarea 2 (unitaria) y Tarea 4 (e2e de
   cuenta perdida y de pago parcial con otro pago vivo).
4. **Un usuario de una sucursal con el id de un cobro o petición de otra**: 403 siempre, aunque el cobro esté
   borrado o la petición resuelta (no se revela nada). → Tarea 4 (e2e).
5. **Pantalla vieja**: pedir el borrado de un cobro que otra persona ya pidió o que ya se borró → 409 con el
   mensaje del servidor visible, y la pantalla recarga mostrando el estado real. → Tarea 4 (e2e) y Tarea 6
   (portal).

## Mapa de archivos

| Archivo | Tarea | Responsabilidad |
|---|---|---|
| `supabase/migrations/20261013120000_peticiones_cobro.sql` | 1 | `cobro`, `cobro_id`, relleno, `peticion` |
| `supabase/tests/99_peticiones_cobro_test.sql` (nuevo) + `99_cobranza_saldo_favor_test.sql` + `99_cobranza_portal_test.sql` | 1 | Lo que la base garantiza |
| `apps/backend/src/database/schema.d.ts` | 1 | Tipos regenerados |
| `apps/backend/src/modules/ventas-cobranza/cobranzas.{repository,service}.ts` (+ `.spec`) | 1 | Todo cobro nace con su `cobro` |
| `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` + `docs/contrato-sincronizacion.md` | 1 | La entidad del push de cobranza es el `cobro` |
| `apps/backend/test/{sincronizacion,cobranzas-portal,ventas-editar}.e2e-spec.ts` | 1 | Inserciones a mano con `cobro_id` y limpieza |
| `apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.ts` (+ `.spec`) | 2 | `planearBorrado`, `statusTrasBorrar` |
| `apps/backend/src/modules/ventas-cobranza/cobros-borrado.{repository,service}.ts` (+ `.service.spec`) | 3 | Vista previa y borrado con candados |
| `apps/backend/src/modules/ventas-cobranza/peticiones.{repository,service,controller}.ts`, `cobros.controller.ts`, `dto/peticiones.dto.ts`, `ventas-cobranza.module.ts` | 4 | Endpoints |
| `apps/backend/test/peticiones.e2e-spec.ts` (nuevo) | 4, 5 | De punta a punta |
| `apps/backend/src/modules/ventas-cobranza/{ventas-consulta,cobranzas-portal}.repository.ts` | 5 | `cobroId` y `peticionPendiente` en los cobros |
| `apps/portal/src/lib/peticiones.ts` (+ `.test`), `lib/ventas.ts`, `lib/cobranzas.ts` | 6 | Tipos y llamadas |
| `apps/portal/src/components/peticiones/{vista-borrado,pedir-borrado-cobro}.tsx` (+ `.test`) | 6 | Pedir el borrado |
| `apps/portal/src/components/ventas/detalle-venta.tsx`, `components/cobranza/cobranza-cliente.tsx` (+ `.test`) | 6 | Botón "Pedir borrado" |
| `apps/portal/src/components/peticiones/{bandeja-peticiones,pantalla-peticiones}.tsx` (+ `.test`), `app/(portal)/operacion/peticiones/page.tsx` | 7 | Bandeja |
| `CLAUDE.md`, vault (`../jawa-obsidian-memory`) | 8 | Documentación |

## Modelo sugerido por tarea

| Tarea | Qué | Implementar | Revisar |
|---|---|---|---|
| 1 | Migración + relleno + pgTAP + tipos + todo cobro nace con su `cobro` + pruebas existentes | **`opus`** | **`opus`** |
| 2 | Regla pura `planearBorrado` | `haiku` | `sonnet` |
| 3 | `CobrosBorradoService` (candados, vista previa, borrar) | `sonnet` | **`opus`** |
| 4 | Peticiones: endpoints + e2e | **`opus`** | **`opus`** |
| 5 | Lectores: `cobroId` y `peticionPendiente` | `haiku` | `sonnet` |
| 6 | Portal: pedir el borrado | `sonnet` | `sonnet` |
| 7 | Portal: bandeja | `sonnet` | `sonnet` |
| 8 | Verificación, prueba a mano y documentación | `sonnet` | **`opus`** (revisión final de rama) |

---

### Tarea 1: El pago como entidad — migración, relleno, pgTAP y todo cobro nace con su `cobro`

Es la base de todo lo demás: sin `cobro_id` no hay "pago completo" que borrar. Va en un solo commit porque
los checks nuevos (`cobro_id` obligatorio salvo contado; `saldo_favor_movimiento.cobro_id not null`) rompen
el código y las pruebas que hoy escriben cobros sin pago: migración, servicio y pruebas cambian juntos.
**Modelo:** `opus` para implementar y para revisar.

**Archivos:**
- Crear: `supabase/migrations/20261013120000_peticiones_cobro.sql`
- Crear: `supabase/tests/99_peticiones_cobro_test.sql`
- Modificar: `supabase/tests/99_cobranza_portal_test.sql`, `supabase/tests/99_cobranza_saldo_favor_test.sql`
- Modificar (generado): `apps/backend/src/database/schema.d.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts` (`NuevoCobro`, `insertarCobro`, `cobroId` en `NuevoAbono`/`NuevoSaldoFavor`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts` (`EntidadCobranza`, `escribir`, `registrarCobranza`, `registrarPago`, `aplicarSaldoFavor`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts`
- Modificar: `apps/backend/src/modules/sincronizacion/sincronizacion.service.ts` (comentario del caso `cobranza`)
- Modificar: `docs/contrato-sincronizacion.md` (la entidad del push de cobranza)
- Crear: `apps/backend/test/apoyo-cobros.ts`
- Modificar: `apps/backend/test/cobranzas-portal.e2e-spec.ts`, `apps/backend/test/sincronizacion.e2e-spec.ts`,
  `apps/backend/test/ventas-editar.e2e-spec.ts`, `apps/backend/test/ventas.e2e-spec.ts`

**Interfaces:**
- Consume: nada nuevo.
- Produce:
  - Tablas `cobro` y `peticion` (columnas exactas en el Paso 3), columna `cobro_id` en `cobranza_abono`
    (null solo si `origen = 'venta_contado'`) y en `saldo_favor_movimiento` (not null). Función SQL
    `rellenar_cobros_t34() returns integer`.
  - En `cobranzas.repository.ts`:
    ```ts
    export interface NuevoCobro {
      clienteId: string;
      vendedorId: string | null;
      capturoUsuarioId: string | null;
      origen: 'cobro' | 'saldo_favor';
      metodoPago: MetodoAbono;
      monto: string;
      fechaPago: string;
      fechaOperacion: string;
    }
    insertarCobro(cobro: NuevoCobro, trx: Transaction<DB>): Promise<string>
    // NuevoAbono gana `cobroId?: string | null` (ausente/null = cobro de contado)
    // NuevoSaldoFavor gana `cobroId: string`
    ```
  - En `cobranzas.service.ts`: `export interface EntidadCobranza { tabla: 'cobro'; id: string }`.
  - En `apps/backend/test/apoyo-cobros.ts`:
    ```ts
    sembrarCobro(db: Database, datos: CobroSembrado): Promise<string>
    cobroParaNota(db: Database, ventaNotaId: string, datos: Omit<CobroSembrado, 'clienteId'>): Promise<string>
    borrarCobrosDe(db: Database, clienteIds: readonly string[]): Promise<void>
    ```

- [ ] **Paso 1: La prueba de la base que falla**

Crea `supabase/tests/99_peticiones_cobro_test.sql`:

```sql
begin;
select plan(31);

-- T-34: el pago como entidad (`cobro`) y las peticiones de borrado. Lo que la
-- BASE garantiza aunque alguien escriba por debajo del servicio. Prefijo
-- `zz-pgtap-t34`.

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t34', 'Usuario pgTAP T-34', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T34 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota, contado_credito,
     semana, mes, status, sucursal_id, origen, capturo_usuario_id)
  select f.folio, '2026-10-13', c.id, null, 300.00, null, 'credito',
         42, 10, 'pendiente', c.sucursal_id, 'portal', u.id
    from cliente c, usuario u,
         (values ('ZZPGTAPT3401'), ('ZZPGTAPT3402')) as f(folio)
   where c.nombre = 'ZZ-pgtap-T34 Cliente' and u.login = 'zz-pgtap-t34';
insert into cobro
    (cliente_id, vendedor_id, capturo_usuario_id, origen, metodo_pago, monto,
     fecha_pago, fecha_operacion)
  select c.id, null, u.id, 'cobro', 'efectivo', 100.00, '2026-10-13', '2026-10-13'
    from cliente c, usuario u
   where c.nombre = 'ZZ-pgtap-T34 Cliente' and u.login = 'zz-pgtap-t34';

create temporary table _t34 on commit drop as
select
  (select id from usuario where login = 'zz-pgtap-t34') as usuario,
  c.id as cliente,
  c.sucursal_id as sucursal,
  (select id from venta_nota where folio = 'ZZPGTAPT3401') as nota,
  (select id from venta_nota where folio = 'ZZPGTAPT3402') as nota2,
  (select id from cobro where cliente_id = c.id) as cobro
  from cliente c
 where c.nombre = 'ZZ-pgtap-T34 Cliente';

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_table('cobro', 'un renglon por pago recibido o saldo a favor aplicado');
select has_table('peticion', 'la bandeja de peticiones');
select fk_ok('cobranza_abono', 'cobro_id', 'cobro', 'id',
  'cada abono de un cobro apunta a su pago');
select fk_ok('saldo_favor_movimiento', 'cobro_id', 'cobro', 'id',
  'y el movimiento de saldo a favor tambien');
select col_not_null('saldo_favor_movimiento', 'cobro_id',
  'todo movimiento de saldo a favor sale de un pago');
select has_index('peticion', 'uq_peticion_cobro_pendiente',
  'una sola peticion pendiente por pago');

------------------------------------------------------------------
-- cobranza_abono.cobro_id
------------------------------------------------------------------

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen, cobro_id)
    select nota, '2026-10-13', '2026-10-13', null, 100.00, 'abono',
           200.00, 'efectivo', 'cobro', cobro
      from _t34$$,
  'un abono de cobro con su pago entra'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-13', '2026-10-13', null, 10.00, 'abono',
           190.00, 'efectivo', 'cobro'
      from _t34$$,
  '23514', null,
  'un abono de cobro sin pago no entra (ck_cobranza_abono_cobro)'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen, cobro_id)
    select nota, '2026-10-13', '2026-10-13', null, 10.00, 'cobranza',
           0.00, 'efectivo', 'venta_contado', cobro
      from _t34$$,
  '23514', null,
  'el cobro automatico de contado NO es un pago: no lleva cobro_id'
);

------------------------------------------------------------------
-- cobro
------------------------------------------------------------------

select throws_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago, fecha_operacion)
    select cliente, 'cobro', 'efectivo', 0.00, '2026-10-13', '2026-10-13' from _t34$$,
  '23514', null,
  'un pago de $0 no entra'
);

select throws_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago, fecha_operacion)
    select cliente, 'saldo_favor', 'efectivo', 10.00, '2026-10-13', '2026-10-13' from _t34$$,
  '23514', null,
  'una aplicacion de saldo a favor va con el metodo saldo_favor'
);

select throws_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago,
                       fecha_operacion, eliminado_por_usuario_id)
    select cliente, 'cobro', 'efectivo', 10.00, '2026-10-13', '2026-10-13', usuario
      from _t34$$,
  '23514', null,
  'quien lo borro solo tiene sentido en un pago borrado'
);

select lives_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago,
                       fecha_operacion, deleted_at)
    select cliente, 'cobro', 'efectivo', 10.00, '2026-10-13', '2026-10-13', now()
      from _t34$$,
  'un pago borrado sin quien lo borro entra: el relleno de filas viejas lo necesita'
);

------------------------------------------------------------------
-- saldo_favor_movimiento.cobro_id
------------------------------------------------------------------

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion)
    select cliente, null, 15.00, 'excedente_cobro', '2026-10-13' from _t34$$,
  '23502', null,
  'un excedente sin pago no entra'
);

------------------------------------------------------------------
-- peticion
------------------------------------------------------------------

select lives_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id)
    select 'eliminar_cobro', cobro, sucursal, 'Era de credito', usuario from _t34$$,
  'una peticion pendiente de borrar un cobro entra'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id)
    select 'eliminar_cobro', cobro, sucursal, 'Otra vez', usuario from _t34$$,
  '23505', null,
  'una segunda pendiente sobre el mismo pago no entra'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en)
    select 'eliminar_cobro', cobro, sucursal, '   ', usuario, 'denegada', usuario, now()
      from _t34$$,
  '23514', null,
  'el motivo no puede ir en blanco'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en)
    select 'eliminar_venta', cobro, sucursal, 'x', usuario, 'denegada', usuario, now()
      from _t34$$,
  '23514', null,
  'por ahora el unico tipo es eliminar_cobro'
);

select throws_ok(
  $$insert into peticion (tipo, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en)
    select 'eliminar_cobro', sucursal, 'x', usuario, 'denegada', usuario, now()
      from _t34$$,
  '23514', null,
  'borrar un cobro exige decir cual'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status)
    select 'eliminar_cobro', cobro, sucursal, 'x', usuario, 'autorizada' from _t34$$,
  '23514', null,
  'una peticion resuelta dice quien y cuando'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en, comentario_resolucion)
    select 'eliminar_cobro', cobro, sucursal, 'x', usuario, 'autorizada', usuario, now(), 'ok'
      from _t34$$,
  '23514', null,
  'el comentario de resolucion es solo de una denegada'
);

select lives_ok(
  $$update peticion
       set status = 'denegada', resuelta_por_usuario_id = (select usuario from _t34),
           resuelta_en = now(), comentario_resolucion = 'No procede'
     where cobro_id = (select cobro from _t34)$$,
  'denegar con comentario'
);

select lives_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id)
    select 'eliminar_cobro', cobro, sucursal, 'Ahora si', usuario from _t34$$,
  'resuelta la anterior, se puede volver a pedir'
);

------------------------------------------------------------------
-- Relleno de los cobros viejos, simulado
------------------------------------------------------------------

-- Despues de migrar ya no hay filas sin pago, asi que se recrea el estado de
-- antes dentro de esta transaccion (sin los checks) y se corre la MISMA
-- funcion de la migracion. created_at explicito: dentro de una transaccion
-- now() es el mismo para todo, y el relleno agrupa justamente por ese instante.
alter table cobranza_abono drop constraint ck_cobranza_abono_cobro;
alter table saldo_favor_movimiento alter column cobro_id drop not null;

-- t1: un pago a dos notas con excedente. t2: otro pago a una nota. t3: un
-- excedente sin filas en notas (todo el pago quedo a favor).
insert into cobranza_abono
    (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
     saldo_pendiente, metodo_pago, origen, capturo_usuario_id, created_at)
  select x.nota, '2026-10-13', '2026-10-13', null, x.monto, 'abono', 0.00,
         'efectivo', 'cobro', t.usuario, x.creado::timestamptz
    from _t34 t,
         lateral (values (t.nota, 50.00, '2026-10-13 10:00:00+00'),
                         (t.nota2, 60.00, '2026-10-13 10:00:00+00'),
                         (t.nota, 20.00, '2026-10-13 11:00:00+00')) as x(nota, monto, creado);
insert into saldo_favor_movimiento
    (cliente_id, vendedor_id, monto, origen, fecha_operacion, capturo_usuario_id, created_at)
  select t.cliente, null, x.monto, 'excedente_cobro', '2026-10-13', t.usuario, x.creado::timestamptz
    from _t34 t,
         lateral (values (15.00, '2026-10-13 10:00:00+00'),
                         (30.00, '2026-10-13 12:00:00+00')) as x(monto, creado);

select is(rellenar_cobros_t34(), 3,
  'tres pagos: el de dos notas con excedente, el de una nota y el excedente solo');

select is(
  (select c.monto from cobro c
    where c.id = (select cobro_id from cobranza_abono
                   where created_at = '2026-10-13 10:00:00+00' limit 1)),
  125.00::numeric,
  'el pago de las dos notas vale sus filas mas su excedente'
);

select is(
  (select count(distinct cobro_id) from (
     select cobro_id from cobranza_abono where created_at = '2026-10-13 10:00:00+00'
     union all
     select cobro_id from saldo_favor_movimiento where created_at = '2026-10-13 10:00:00+00') x),
  1::bigint,
  'las dos filas y el excedente del mismo instante son UN pago'
);

select is(
  (select count(distinct cobro_id) from cobranza_abono
    where created_at in ('2026-10-13 10:00:00+00', '2026-10-13 11:00:00+00')),
  2::bigint,
  'dos transacciones distintas son dos pagos'
);

select is(
  (select c.metodo_pago from cobro c
    where c.id = (select cobro_id from saldo_favor_movimiento
                   where created_at = '2026-10-13 12:00:00+00')),
  'efectivo',
  'un excedente solo gana su propio pago (el movimiento no guarda metodo: efectivo)'
);

select is(rellenar_cobros_t34(), 0, 'volver a correrlo no hace nada');

select lives_ok(
  $$alter table saldo_favor_movimiento alter column cobro_id set not null$$,
  'tras el relleno ningun movimiento queda sin pago'
);

select lives_ok(
  $$alter table cobranza_abono add constraint ck_cobranza_abono_cobro
      check ((origen = 'venta_contado') = (cobro_id is null))$$,
  'y ningun abono de cobro queda sin pago'
);

select * from finish();
rollback;
```

Cuenta: 6 de estructura + 3 de `cobranza_abono` + 4 de `cobro` + 1 de saldo a favor + 9 de `peticion` + 8 del
relleno = **31**.

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_peticiones_cobro_test.sql` (`relation "cobro" does not exist`). Los demás archivos pasan.

- [ ] **Paso 3: La migración**

Crea `supabase/migrations/20261013120000_peticiones_cobro.sql`:

```sql
-- T-34: el pago como entidad (`cobro`) y las peticiones de borrado.
--
-- 1. `cobro`: un renglon por pago recibido (tablet o portal) o por saldo a
--    favor aplicado (T-21). Hasta hoy un pago a varias notas eran filas
--    sueltas en `cobranza_abono` mas, si sobraba, un `saldo_favor_movimiento`,
--    sin nada que dijera "esto es un mismo pago". Borrar un pedazo dejaria las
--    cuentas chuecas: se borra el pago completo (decision de Roberto).
-- 2. `cobro_id` en `cobranza_abono` (null SOLO en el cobro automatico de una
--    venta de contado, que no es un pago aparte: se corrige editando la venta,
--    T-17) y en `saldo_favor_movimiento` (siempre sale de un pago).
-- 3. `rellenar_cobros_t34()` agrupa las filas que ya existen. Se queda creada:
--    la prueba pgTAP la corre sobre filas sembradas a proposito.
-- 4. `peticion`: la bandeja (Operacion -> Peticiones). Hoy un solo tipo,
--    `eliminar_cobro`; nace generica para sumar otros despues.
--
-- Ver docs/superpowers/specs/2026-10-13-t34-peticiones-borrar-cobro-design.md §4.1.

create table cobro (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  cliente_id               uuid not null references cliente(id),
  -- El cobrador: un vendedor, o null = Oficina (T-21). Una aplicacion de saldo
  -- a favor va siempre null: no entra dinero.
  vendedor_id              uuid references vendedor(id),
  -- Quien lo capturo en el portal; null = vino de la tablet.
  capturo_usuario_id       uuid references usuario(id),
  origen                   text not null,
  metodo_pago              text not null,
  -- Lo recibido (o lo aplicado), sobrante a saldo a favor incluido.
  monto                    numeric(12,2) not null,
  fecha_pago               date not null,
  fecha_operacion          date not null,
  eliminado_por_usuario_id uuid references usuario(id),
  constraint ck_cobro_origen check (origen in ('cobro', 'saldo_favor')),
  constraint ck_cobro_metodo
    check (metodo_pago in ('efectivo', 'transferencia', 'cheque', 'saldo_favor')),
  constraint ck_cobro_saldo_favor
    check ((origen = 'saldo_favor') = (metodo_pago = 'saldo_favor')),
  constraint ck_cobro_monto_positivo check (monto > 0),
  -- Quien lo borro solo en un pago borrado. Al reves no: el relleno puede
  -- encontrar filas de prueba ya borradas sin saber quien. El servicio de
  -- borrado (T-34) siempre pone los dos.
  constraint ck_cobro_borrado
    check (eliminado_por_usuario_id is null or deleted_at is not null)
);
create trigger trg_cobro_updated before update on cobro
  for each row execute function set_updated_at();
create index idx_cobro_cliente on cobro (cliente_id) where deleted_at is null;

alter table cobranza_abono add column cobro_id uuid references cobro(id);
alter table saldo_favor_movimiento add column cobro_id uuid references cobro(id);
create index idx_cobranza_abono_cobro on cobranza_abono (cobro_id);
create index idx_saldo_favor_cobro on saldo_favor_movimiento (cobro_id);

-- Un pago = las filas de cobro o de saldo a favor del mismo cliente que se
-- escribieron en la MISMA transaccion: `created_at` es now(), la hora de inicio
-- de la transaccion, identica para todas sus filas (la tablet y el portal
-- escriben cada cobro en su propia transaccion). Su movimiento de saldo a favor
-- es el del mismo cliente e instante. Solo toca filas sin `cobro_id`: volver a
-- llamarla no hace nada. Devuelve cuantos pagos creo.
create function rellenar_cobros_t34() returns integer
language plpgsql as $$
declare
  g record;
  nuevo uuid;
  creados integer := 0;
begin
  for g in
    select vn.cliente_id, ca.created_at, ca.origen, ca.vendedor_id,
           ca.capturo_usuario_id, ca.metodo_pago, ca.fecha_pago, ca.fecha_operacion,
           sum(ca.monto) as monto_filas,
           bool_and(ca.deleted_at is not null) as borrado,
           max(ca.deleted_at) as borrado_en
      from cobranza_abono ca
      join venta_nota vn on vn.id = ca.venta_nota_id
     where ca.cobro_id is null
       and ca.origen in ('cobro', 'saldo_favor')
     group by vn.cliente_id, ca.created_at, ca.origen, ca.vendedor_id,
              ca.capturo_usuario_id, ca.metodo_pago, ca.fecha_pago, ca.fecha_operacion
  loop
    insert into cobro (cliente_id, vendedor_id, capturo_usuario_id, origen, metodo_pago,
                       monto, fecha_pago, fecha_operacion, created_at, deleted_at)
    values (g.cliente_id, g.vendedor_id, g.capturo_usuario_id, g.origen, g.metodo_pago,
            g.monto_filas, g.fecha_pago, g.fecha_operacion, g.created_at,
            case when g.borrado then g.borrado_en end)
    returning id into nuevo;

    update cobranza_abono ca
       set cobro_id = nuevo
      from venta_nota vn
     where vn.id = ca.venta_nota_id
       and ca.cobro_id is null
       and vn.cliente_id = g.cliente_id
       and ca.created_at = g.created_at
       and ca.origen = g.origen
       and ca.vendedor_id is not distinct from g.vendedor_id
       and ca.capturo_usuario_id is not distinct from g.capturo_usuario_id
       and ca.metodo_pago = g.metodo_pago
       and ca.fecha_pago = g.fecha_pago
       and ca.fecha_operacion = g.fecha_operacion;

    update saldo_favor_movimiento sf
       set cobro_id = nuevo
     where sf.cobro_id is null
       and sf.cliente_id = g.cliente_id
       and sf.created_at = g.created_at
       and sf.origen = case when g.origen = 'saldo_favor'
                            then 'aplicacion' else 'excedente_cobro' end;

    -- El pago vale lo recibido: sus filas mas lo que sobro a saldo a favor.
    update cobro
       set monto = monto + coalesce((select sum(sf.monto)
                                       from saldo_favor_movimiento sf
                                      where sf.cobro_id = nuevo
                                        and sf.origen = 'excedente_cobro'), 0)
     where id = nuevo;

    creados := creados + 1;
  end loop;

  -- Un excedente sin filas en notas (todo el pago quedo a favor, T-20 D9). El
  -- movimiento no guarda metodo: se supone efectivo. Solo pasa con filas de
  -- prueba: en sinmex dev no habia cobros al migrar (2026-10-13).
  for g in
    select id, cliente_id, vendedor_id, capturo_usuario_id, monto,
           fecha_operacion, created_at, deleted_at
      from saldo_favor_movimiento
     where cobro_id is null and origen = 'excedente_cobro'
  loop
    insert into cobro (cliente_id, vendedor_id, capturo_usuario_id, origen, metodo_pago,
                       monto, fecha_pago, fecha_operacion, created_at, deleted_at)
    values (g.cliente_id, g.vendedor_id, g.capturo_usuario_id, 'cobro', 'efectivo',
            g.monto, g.fecha_operacion, g.fecha_operacion, g.created_at, g.deleted_at)
    returning id into nuevo;
    update saldo_favor_movimiento set cobro_id = nuevo where id = g.id;
    creados := creados + 1;
  end loop;

  return creados;
end;
$$;

select rellenar_cobros_t34();

-- Si algo quedo sin pago, la migracion falla ENTERA con un mensaje claro en vez
-- de que lo diga un check anonimo (o de dejar datos a medias).
do $$
begin
  if exists (select 1 from cobranza_abono
              where origen <> 'venta_contado' and cobro_id is null)
     or exists (select 1 from saldo_favor_movimiento where cobro_id is null) then
    raise exception 'T-34: quedaron cobros sin agrupar en cobranza_abono o saldo_favor_movimiento';
  end if;
end;
$$;

alter table cobranza_abono add constraint ck_cobranza_abono_cobro
  check ((origen = 'venta_contado') = (cobro_id is null));
alter table saldo_favor_movimiento alter column cobro_id set not null;

create table peticion (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  tipo                     text not null,
  status                   text not null default 'pendiente',
  cobro_id                 uuid references cobro(id),
  -- La sucursal del cliente al pedir: el filtro "Por sucursal" y el alcance.
  sucursal_id              uuid not null references sucursal(id),
  motivo                   text not null,
  solicito_usuario_id      uuid not null references usuario(id),
  resuelta_por_usuario_id  uuid references usuario(id),
  resuelta_en              timestamptz,
  comentario_resolucion    text,
  constraint ck_peticion_tipo check (tipo in ('eliminar_cobro')),
  constraint ck_peticion_status check (status in ('pendiente', 'autorizada', 'denegada')),
  constraint ck_peticion_objetivo check ((tipo = 'eliminar_cobro') = (cobro_id is not null)),
  constraint ck_peticion_motivo check (length(btrim(motivo)) between 1 and 500),
  constraint ck_peticion_resolucion check (
    (status = 'pendiente') = (resuelta_por_usuario_id is null)
    and (status = 'pendiente') = (resuelta_en is null)),
  constraint ck_peticion_comentario check (
    comentario_resolucion is null
    or (status = 'denegada' and length(comentario_resolucion) <= 500))
);
-- Sin deleted_at: una peticion no se borra, se resuelve.
create trigger trg_peticion_updated before update on peticion
  for each row execute function set_updated_at();
create unique index uq_peticion_cobro_pendiente on peticion (cobro_id)
  where status = 'pendiente';
create index idx_peticion_status_sucursal on peticion (status, sucursal_id, created_at);
```

- [ ] **Paso 4: Aplicar, probar la base y regenerar los tipos**

Run: `npm run supabase -- migration up --local`
Expected: `Applying migration 20261013120000_peticiones_cobro.sql...` y `Migrations applied`.

Run: `npm run supabase -- test db`
Expected: `99_peticiones_cobro_test.sql` pasa (31/31). **Fallan** `99_cobranza_portal_test.sql` y
`99_cobranza_saldo_favor_test.sql`: insertan cobros sin pago (se arreglan en el Paso 5).

Run: `npm run db:types --workspace=apps/backend`
Expected: `apps/backend/src/database/schema.d.ts` gana `Cobro`, `Peticion` y `cobro_id` en `CobranzaAbono` y
`SaldoFavorMovimiento` (revisa con `git diff --stat`).

- [ ] **Paso 5: Las pruebas pgTAP de T-20 y T-21 escriben cobros con su pago**

`supabase/tests/99_cobranza_portal_test.sql` (el `plan(14)` no cambia):
- después del `insert into venta_nota …` del arranque, agrega:

```sql
insert into cobro
    (cliente_id, vendedor_id, capturo_usuario_id, origen, metodo_pago, monto,
     fecha_pago, fecha_operacion)
  select c.id, null, u.id, x.origen, x.metodo, 100.00, '2026-10-07', '2026-10-07'
    from cliente c, usuario u,
         (values ('cobro', 'efectivo'), ('saldo_favor', 'saldo_favor')) as x(origen, metodo)
   where c.nombre = 'ZZ-pgtap-T21 Cliente' and u.login = 'zz-pgtap-t21';
```

- en `create temporary table _t21 …` agrega dos columnas:

```sql
  (select id from cobro where origen = 'cobro'
      and cliente_id = (select id from cliente where nombre = 'ZZ-pgtap-T21 Cliente')) as cobro,
  (select id from cobro where origen = 'saldo_favor'
      and cliente_id = (select id from cliente where nombre = 'ZZ-pgtap-T21 Cliente')) as cobro_sf
```

- en **cada** `insert into cobranza_abono` y `insert into saldo_favor_movimiento` del archivo agrega la columna
  `cobro_id` al final de la lista de columnas y el valor al final del `select`: `cobro_sf` en las filas con
  `'saldo_favor'` como origen o método y en los movimientos `'aplicacion'`; `cobro` en las demás. Ejemplo, el
  primer `lives_ok` queda:

```sql
select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen, capturo_usuario_id, cobro_id)
    select nota, '2026-10-07', '2026-10-07', null, 100.00, 'abono',
           200.00, 'saldo_favor', 'saldo_favor', usuario, cobro_sf
      from _t21$$,
  'aplicar saldo a favor: metodo y origen saldo_favor, sin cobrador'
);
```

  Así cada `throws_ok` vuelve a fallar **por el check que nombra su descripción**, no por la falta de pago.

`supabase/tests/99_cobranza_saldo_favor_test.sql` (el `plan(23)` no cambia):
- después del `insert into venta_nota …` del arranque, agrega:

```sql
insert into cobro
    (cliente_id, vendedor_id, origen, metodo_pago, monto, fecha_pago, fecha_operacion)
  select c.id, v.id, 'cobro', 'efectivo', 250.00, '2026-09-14', '2026-09-14'
    from cliente c, vendedor v
   where c.nombre = 'ZZ-pgtap-T20 Cliente' and v.login = 'zz-pgtap-t20';
```

- en `create temporary table _t20 …` agrega
  `(select id from cobro where cliente_id = (select id from cliente where nombre = 'ZZ-pgtap-T20 Cliente')) as cobro`;
- agrega `cobro_id` (valor `cobro`) a **cada** `insert into cobranza_abono` **salvo** el de
  `'venta_contado'` (`'acepta el cobro automatico de una venta de contado'`), y a cada
  `insert into saldo_favor_movimiento`. Incluye el insert de la simulación del backfill de `fecha_operacion`
  (el de `fecha_pago = '2026-09-11'`).
- cambia el comentario `-- Un mismo cobro reparte a varias filas; nada en la base lo impide.` por
  `-- Un mismo cobro reparte a varias filas del mismo pago (T-34: cobro_id).`

Run: `npm run supabase -- test db`
Expected: PASS en todos los archivos.

- [ ] **Paso 6: Pruebas unitarias que fallan — todo cobro nace con su pago**

En `apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts`:

1. En `montar`, agrega al objeto `repo` (antes de `insertarAbono`):

```ts
    insertarCobro: jest.fn().mockResolvedValue('cobro-1'),
```

2. En los seis `toHaveBeenCalledWith`/`toHaveBeenNthCalledWith` que comparan un objeto **completo** de
   `insertarAbono` o `insertarSaldoFavor` (los de las pruebas `un abono parcial deja una fila abono…`,
   `el excedente va a las otras notas…`, `paga primero la palomeada mas vieja…`,
   `lo que sobra va a las demas…` y los dos de `reparte solo entre las palomeadas…`), agrega como última
   propiedad `cobroId: 'cobro-1',`.
3. Cambia las tres expectativas `{ tabla: 'cobranza_abono', id: 'abono-1' }` por
   `{ tabla: 'cobro', id: 'cobro-1' }`. La prueba `si todo queda a favor, el buzon apunta al movimiento de
   saldo a favor` pasa a llamarse `si todo queda a favor, el buzon igual apunta al pago (T-34)` y espera
   `{ tabla: 'cobro', id: 'cobro-1' }`.
4. Agrega al final del archivo:

```ts
describe('todo pago nace con su cobro (T-34)', () => {
  it('tablet: el pago completo, antes de sus filas, y cada fila y el excedente cuelgan de el', async () => {
    const { servicio, repo } = montar({
      bloqueadas: [bloqueada(A, '2026-08-01', '100.00')],
      abonado: new Map(),
    });

    await servicio.registrarCobranza(
      cobro({ montoCentavos: 13050 }),
      contexto,
      trx,
    );

    expect(repo.insertarCobro).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: 'vendedor-1',
        capturoUsuarioId: null,
        origen: 'cobro',
        metodoPago: 'efectivo',
        monto: '130.50',
        fechaPago: '2026-09-10',
        fechaOperacion: '2026-09-14',
      },
      trx,
    );
    expect(repo.insertarCobro.mock.invocationCallOrder[0]).toBeLessThan(
      repo.insertarAbono.mock.invocationCallOrder[0],
    );
    expect(repo.insertarAbono).toHaveBeenCalledWith(
      expect.objectContaining({ cobroId: 'cobro-1' }),
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '30.50', cobroId: 'cobro-1' }),
      trx,
    );
  });

  it('portal: Oficina y quien capturo, con el monto completo aunque sobre', async () => {
    const { servicio, repo } = tresNotas();
    await servicio.registrarPago(
      pago({ notaIds: [C], montoCentavos: 30000 }),
      contextoPortal,
      trx,
    );
    expect(repo.insertarCobro).toHaveBeenCalledTimes(1);
    expect(repo.insertarCobro).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: null,
        capturoUsuarioId: 'usuario-1',
        origen: 'cobro',
        metodoPago: 'transferencia',
        monto: '300.00',
        fechaPago: '2026-10-05',
        fechaOperacion: '2026-10-07',
      },
      trx,
    );
  });

  it('aplicar saldo a favor: un pago saldo_favor sin cobrador, y el movimiento negativo es del mismo pago', async () => {
    const { servicio, repo } = tresNotas(['150.00']);
    await servicio.aplicarSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A], montoCentavos: 1000 },
      { ...contextoPortal, vendedorId: 'vendedor-1' },
      trx,
    );
    expect(repo.insertarCobro).toHaveBeenCalledWith(
      {
        clienteId: CLIENTE,
        vendedorId: null,
        capturoUsuarioId: 'usuario-1',
        origen: 'saldo_favor',
        metodoPago: 'saldo_favor',
        monto: '10.00',
        fechaPago: '2026-10-07',
        fechaOperacion: '2026-10-07',
      },
      trx,
    );
    expect(repo.insertarSaldoFavor).toHaveBeenCalledWith(
      expect.objectContaining({ origen: 'aplicacion', cobroId: 'cobro-1' }),
      trx,
    );
  });

  it('las vistas previas no crean pago', async () => {
    const { servicio, repo } = tresNotas(['150.00']);
    await servicio.planearPago(
      { clienteId: CLIENTE, notaIds: [A], montoCentavos: 1000 },
      trx,
    );
    await servicio.planearSaldoFavor(
      { clienteId: CLIENTE, notaIds: [A], montoCentavos: 1000 },
      trx,
    );
    expect(repo.insertarCobro).not.toHaveBeenCalled();
  });
});
```

Run: `npm test --workspace=apps/backend -- cobranzas.service`
Expected: FAIL — `insertarCobro` nunca se llama, las entidades siguen siendo `cobranza_abono` y las filas no
llevan `cobroId`.

- [ ] **Paso 7: El repositorio y el servicio**

`apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts`:

- en `NuevoAbono`, después de `capturoUsuarioId?: string | null;`, agrega:

```ts
  /**
   * El pago al que pertenece (T-34). Ausente o null SOLO en el cobro automatico
   * de una venta de contado, que no es un pago aparte (`ck_cobranza_abono_cobro`).
   */
  cobroId?: string | null;
```

- en `NuevoSaldoFavor`, después de `capturoUsuarioId: string | null;`, agrega:

```ts
  /** El pago del que sale: el excedente o la aplicacion (T-34, not null en la base). */
  cobroId: string;
```

- arriba de `@Injectable()`, agrega:

```ts
/**
 * Un pago (T-34): lo recibido de un cliente (tablet o portal) o el saldo a
 * favor aplicado. Sus filas de `cobranza_abono` y su movimiento de saldo a
 * favor cuelgan de el con `cobro_id`; borrar un pago es borrarlo completo.
 */
export interface NuevoCobro {
  clienteId: string;
  /** El cobrador; null = Oficina, y siempre null al aplicar saldo a favor. */
  vendedorId: string | null;
  capturoUsuarioId: string | null;
  origen: 'cobro' | 'saldo_favor';
  metodoPago: MetodoAbono;
  /** Texto `numeric`: el pago completo, sobrante a saldo a favor incluido. */
  monto: string;
  fechaPago: string;
  fechaOperacion: string;
}
```

- en `insertarAbono`, después de `capturo_usuario_id: abono.capturoUsuarioId ?? null,`, agrega
  `cobro_id: abono.cobroId ?? null,`;
- en `insertarSaldoFavor`, después de `capturo_usuario_id: movimiento.capturoUsuarioId,`, agrega
  `cobro_id: movimiento.cobroId,`;
- agrega, antes de `insertarAbono`:

```ts
  async insertarCobro(cobro: NuevoCobro, trx: Transaction<DB>): Promise<string> {
    const fila = await trx
      .insertInto('cobro')
      .values({
        cliente_id: cobro.clienteId,
        vendedor_id: cobro.vendedorId,
        capturo_usuario_id: cobro.capturoUsuarioId,
        origen: cobro.origen,
        metodo_pago: cobro.metodoPago,
        monto: cobro.monto,
        fecha_pago: cobro.fechaPago,
        fecha_operacion: cobro.fechaOperacion,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }
```

`apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts`:

- `EntidadCobranza` queda:

```ts
/**
 * La fila a la que apunta el buzon (`sync_operacion.entidad_*`): el pago
 * (T-34). Antes era la primera fila de `cobranza_abono` o el movimiento de
 * saldo a favor; ahora el pago las agrupa a todas.
 */
export interface EntidadCobranza {
  tabla: 'cobro';
  id: string;
}
```

- en el comentario de `registrarCobranza`, cambia el párrafo `Devuelve la primera fila…` por
  `Devuelve el pago (T-34): todas sus filas y su excedente cuelgan de el.`
- en `registrarCobranza`, reemplaza desde `const entidad = await this.escribir(` hasta el `return entidad;`
  (incluidos el comentario y el `throw` de "no escribio ninguna fila") por:

```ts
    const cobroId = await this.escribir(
      reparto,
      { clienteId: cobranza.clienteId, montoCentavos: cobranza.montoCentavos },
      {
        fechaPago: cobranza.fechaPago,
        metodoPago: cobranza.metodoPago,
        origen: 'cobro',
      },
      contexto,
      trx,
    );
    return { tabla: 'cobro', id: cobroId };
```

- en `registrarPago`, el segundo argumento de `this.escribir(` pasa de `pago.clienteId,` a
  `{ clienteId: pago.clienteId, montoCentavos: pago.montoCentavos },`;
- en `aplicarSaldoFavor`, `await this.escribir(` pasa a `const cobroId = await this.escribir(`, su segundo
  argumento a `{ clienteId: pago.clienteId, montoCentavos: pago.montoCentavos },`, y el
  `insertarSaldoFavor` que sigue gana `cobroId,` después de `capturoUsuarioId: contexto.usuarioId,`;
- `escribir` queda:

```ts
  /**
   * El pago (T-34) y, colgadas de el, las filas `cobranza_abono` del reparto,
   * el status de cada nota (se escribe aunque no cambie: el trigger le toca
   * `updated_at` y el pull la ve, D12) y, si sobra, el excedente a saldo a
   * favor. Devuelve el id del pago.
   */
  private async escribir(
    reparto: Reparto,
    pago: { clienteId: string; montoCentavos: number },
    forma: FormaDelAbono,
    contexto: ContextoCobranza,
    trx: Transaction<DB>,
  ): Promise<string> {
    const cobroId = await this.repo.insertarCobro(
      {
        clienteId: pago.clienteId,
        vendedorId: contexto.vendedorId,
        capturoUsuarioId: contexto.usuarioId,
        origen: forma.origen,
        metodoPago: forma.metodoPago,
        monto: aPesos(pago.montoCentavos),
        fechaPago: forma.fechaPago,
        fechaOperacion: contexto.fechaOperacion,
      },
      trx,
    );

    for (const a of reparto.aplicaciones) {
      await this.repo.insertarAbono(
        {
          ventaNotaId: a.notaId,
          vendedorId: contexto.vendedorId,
          fechaPago: forma.fechaPago,
          fechaOperacion: contexto.fechaOperacion,
          monto: aPesos(a.montoCentavos),
          tipo: a.tipo,
          // La foto del saldo tras esta fila (D7); nunca se lee como fuente.
          saldoPendiente: aPesos(a.saldoDespuesCentavos),
          metodoPago: forma.metodoPago,
          origen: forma.origen,
          capturoUsuarioId: contexto.usuarioId,
          cobroId,
        },
        trx,
      );
      await this.repo.actualizarStatusNota(a.notaId, a.status, trx);
    }

    if (reparto.saldoFavorCentavos > 0) {
      await this.repo.insertarSaldoFavor(
        {
          clienteId: pago.clienteId,
          vendedorId: contexto.vendedorId,
          monto: aPesos(reparto.saldoFavorCentavos),
          origen: 'excedente_cobro',
          fechaOperacion: contexto.fechaOperacion,
          capturoUsuarioId: contexto.usuarioId,
          cobroId,
        },
        trx,
      );
    }

    return cobroId;
  }
```

  (Antes de reemplazarlo, comprueba que `aplicarSaldoFavor` pasa `{ ...contexto, vendedorId: null }` a
  `escribir`: así el pago de saldo a favor también queda sin cobrador.)

`ventas.service.ts` y `ventas-edicion.service.ts` **no cambian**: su `insertarAbono` del cobro de contado no
pasa `cobroId`, que queda null — justo lo que exige `ck_cobranza_abono_cobro`.

`apps/backend/src/modules/sincronizacion/sincronizacion.service.ts`, caso `cobranza` de `proyectar`: cambia el
comentario por

```ts
        // Devuelve el pago (`cobro`, T-34): sus filas en notas y su excedente
        // cuelgan de el. Sin folio (T-21).
```

`docs/contrato-sincronizacion.md`, en la lista de "El módulo dueño escribe sus tablas…", cambia la viñeta de
`CobranzasService.registrarCobranza` por:

```md
   - `CobranzasService.registrarCobranza` → bloquea `for update`, en orden de `id`, las notas
     cobrables del cliente y la elegida; reparte; escribe el pago en `cobro` (T-34) y, colgadas de él
     con `cobro_id`, una fila `cobranza_abono` por nota que recibe dinero, su `status` y, si sobra, un
     `saldo_favor_movimiento`. La entidad es el `cobro` (antes de T-34 era la primera fila
     `cobranza_abono` o el movimiento). El contrato con la tablet no cambia.
```

Run: `npm test --workspace=apps/backend -- cobranzas.service`
Expected: PASS.

Run: `npm run build --workspace=apps/backend`
Expected: compila (los tipos de `schema.d.ts` ya conocen `cobro`).

- [ ] **Paso 8: Ayuda de e2e para sembrar pagos**

Crea `apps/backend/test/apoyo-cobros.ts`:

```ts
import type { Database } from './../src/database/database.tokens';

/** Lo minimo de un pago sembrado a mano en una prueba. */
export interface CobroSembrado {
  clienteId: string;
  vendedorId: string | null;
  /** Texto `numeric`, como en la base. */
  monto: string;
  /** `AAAA-MM-DD`: fecha de pago y de operacion. */
  fecha: string;
  metodoPago?: 'efectivo' | 'transferencia' | 'cheque' | 'saldo_favor';
  capturoUsuarioId?: string | null;
}

/**
 * Un `cobro` (T-34) para filas que una prueba escribe por debajo del servicio.
 * Desde T-34 toda fila de `cobranza_abono` que no sea de contado y todo
 * `saldo_favor_movimiento` cuelgan de un pago (`ck_cobranza_abono_cobro`,
 * `cobro_id not null`). El metodo `saldo_favor` hace un pago de origen
 * `saldo_favor` y sin cobrador, como el que deja aplicar saldo a favor.
 */
export async function sembrarCobro(
  db: Database,
  datos: CobroSembrado,
): Promise<string> {
  const metodo = datos.metodoPago ?? 'efectivo';
  const saldoFavor = metodo === 'saldo_favor';
  const { id } = await db
    .insertInto('cobro')
    .values({
      cliente_id: datos.clienteId,
      vendedor_id: saldoFavor ? null : datos.vendedorId,
      capturo_usuario_id: datos.capturoUsuarioId ?? null,
      origen: saldoFavor ? 'saldo_favor' : 'cobro',
      metodo_pago: metodo,
      monto: datos.monto,
      fecha_pago: datos.fecha,
      fecha_operacion: datos.fecha,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** `sembrarCobro` para el cliente de una nota que la prueba ya tiene. */
export async function cobroParaNota(
  db: Database,
  ventaNotaId: string,
  datos: Omit<CobroSembrado, 'clienteId'>,
): Promise<string> {
  const { cliente_id } = await db
    .selectFrom('venta_nota')
    .select('cliente_id')
    .where('id', '=', ventaNotaId)
    .executeTakeFirstOrThrow();
  return sembrarCobro(db, { ...datos, clienteId: cliente_id });
}

/**
 * Limpieza en orden de llaves foraneas: las peticiones de esos pagos y los
 * pagos. Va DESPUES de borrar sus `cobranza_abono` y `saldo_favor_movimiento`,
 * y ANTES de sus notas, del cliente y de los usuarios que pidieron o
 * resolvieron.
 */
export async function borrarCobrosDe(
  db: Database,
  clienteIds: readonly string[],
): Promise<void> {
  if (clienteIds.length === 0) return;
  const cobros = db
    .selectFrom('cobro')
    .select('id')
    .where('cliente_id', 'in', [...clienteIds]);
  await db.deleteFrom('peticion').where('cobro_id', 'in', cobros).execute();
  await db
    .deleteFrom('cobro')
    .where('cliente_id', 'in', [...clienteIds])
    .execute();
}
```

- [ ] **Paso 9: Las e2e existentes siembran pagos, y prueban que todo cobro nace con el suyo**

`apps/backend/test/cobranzas-portal.e2e-spec.ts`:
- importa `import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';`
- `darSaldoFavor` queda:

```ts
  const darSaldoFavor = async (clienteId: string, monto: string) =>
    db
      .insertInto('saldo_favor_movimiento')
      .values({
        cliente_id: clienteId,
        vendedor_id: null,
        monto,
        origen: 'excedente_cobro',
        fecha_operacion: F1,
        cobro_id: await sembrarCobro(db, {
          clienteId,
          vendedorId: null,
          monto,
          fecha: F1,
        }),
      })
      .execute();
```

- en los tres `insertInto('cobranza_abono')` a mano (prueba `por cliente: sus notas por cobrar…`, prueba
  `Review Focus 1: una palomeada que se pago mientras…` y la carrera `el cobro del portal espera el candado…`)
  agrega `cobro_id` con un pago sembrado **antes** del insert (en la carrera, antes de `db.transaction()`):
  `await sembrarCobro(db, { clienteId: cli, vendedorId: <el vendedor_id de esa fila>, monto: <su monto>, fecha: F2, metodoPago: <su metodo_pago> })`.
- en `afterAll`, justo después del `deleteFrom('saldo_favor_movimiento')`, agrega
  `await borrarCobrosDe(db, clienteIds);`.
- agrega, antes de `describe('la tablet ve lo que cobro la oficina', …)`:

```ts
  describe('todo pago nace con su cobro (T-34)', () => {
    it('un pago a varias notas con excedente es UN cobro con el monto completo; filas y excedente cuelgan de el', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);

      await cobrar(
        cookieGeneral,
        pago(cli, [n1.id, n2.id], { montoCentavos: 20000 }),
      ).expect(201);

      const pagos = await db
        .selectFrom('cobro')
        .select(['id', 'monto', 'origen', 'metodo_pago', 'vendedor_id', 'capturo_usuario_id'])
        .where('cliente_id', '=', cli)
        .execute();
      expect(pagos).toEqual([
        {
          id: expect.any(String),
          monto: '200.00',
          origen: 'cobro',
          metodo_pago: 'transferencia',
          vendedor_id: null,
          capturo_usuario_id: usuarioGeneralId,
        },
      ]);
      const filas = await db
        .selectFrom('cobranza_abono')
        .select('cobro_id')
        .where('venta_nota_id', 'in', [n1.id, n2.id])
        .execute();
      expect(filas.map((f) => f.cobro_id)).toEqual([pagos[0].id, pagos[0].id]);
      const favor = await db
        .selectFrom('saldo_favor_movimiento')
        .select(['monto', 'cobro_id'])
        .where('cliente_id', '=', cli)
        .execute();
      expect(favor).toEqual([{ monto: '20.00', cobro_id: pagos[0].id }]);
    });

    it('aplicar saldo a favor es un cobro saldo_favor y su movimiento negativo es del mismo pago', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      await darSaldoFavor(cli, '50.00');

      await aplicarSaldo(cookieGeneral, {
        clienteId: cli,
        notaIds: [n1.id],
        montoCentavos: 3000,
      }).expect(201);

      const aplicacion = await db
        .selectFrom('cobro')
        .select(['id', 'monto', 'origen', 'metodo_pago', 'vendedor_id'])
        .where('cliente_id', '=', cli)
        .where('origen', '=', 'saldo_favor')
        .executeTakeFirstOrThrow();
      expect(aplicacion).toMatchObject({
        monto: '30.00',
        metodo_pago: 'saldo_favor',
        vendedor_id: null,
      });
      const negativo = await db
        .selectFrom('saldo_favor_movimiento')
        .select('cobro_id')
        .where('cliente_id', '=', cli)
        .where('origen', '=', 'aplicacion')
        .executeTakeFirstOrThrow();
      expect(negativo.cobro_id).toBe(aplicacion.id);
    });
  });
```

  (`sembrarCliente`, `sembrarNota`, `cobrar`, `pago`, `aplicarSaldo` y `darSaldoFavor` son las ayudas que ya
  usan las pruebas de T-21 en ese archivo; `pago()` arma una transferencia de Oficina con `fechaPago: PAGO`.)

`apps/backend/test/sincronizacion.e2e-spec.ts`:
- importa `import { borrarCobrosDe, sembrarCobro } from './apoyo-cobros';`
- en `clienteConNotas`, el `insertInto('cobranza_abono')` de `abonos` gana
  `cobro_id: await sembrarCobro(db, { clienteId: cliente, vendedorId, monto, fecha: n.fecha }),`
- en el `beforeAll`, el abono de `notaId` gana
  `cobro_id: await sembrarCobro(db, { clienteId, vendedorId, monto: '100.00', fecha: '2026-08-03' }),`
- en la prueba `el saldo es derivado de los abonos vivos…` cambia `const { notas } = await clienteConNotas(`
  por `const { clienteId: cli, notas } = await clienteConNotas(` y el abono borrado gana
  `cobro_id: await sembrarCobro(db, { clienteId: cli, vendedorId, monto: '25.00', fecha: '2026-08-02', metodoPago: 'cheque' }),`
- en `el cliente baja con su saldo a favor…`, cada uno de los tres movimientos gana
  `cobro_id: await sembrarCobro(db, { clienteId: cli, vendedorId, monto: <su monto>, fecha: FECHA_COBROS }),`
  (arma el arreglo con `await` antes del `insertInto`).
- en `afterAll`, justo después del bloque `if (clientesCobro.length > 0) { … saldo_favor_movimiento … }`, agrega:

```ts
    // T-34: las peticiones y los pagos de esos clientes, antes que el cliente.
    await borrarCobrosDe(db, [clienteId, clienteAjenoId, ...clientesCobro]);
```

- las cuatro expectativas del buzón de cobranza cambian a la entidad `cobro`:
  - `una cobranza valida entra a cobranza_abono y el buzon apunta a la fila` → renómbrala a
    `una cobranza valida entra a cobranza_abono y el buzon apunta a su pago (T-34)` y su `buzonDe` espera
    `{ id: res.resultados[0].id_servidor, entidad_tabla: 'cobro', entidad_id: <el cobro_id de abonos[0]> }`
    (agrega `'cobro_id'` al `select` de `abonosDe` y usa `abonos[0].cobro_id`);
  - las dos `toMatchObject({ entidad_tabla: 'cobranza_abono', entidad_id: … })` pasan a
    `{ entidad_tabla: 'cobro', entidad_id: aElegida.cobro_id }` y `{ entidad_tabla: 'cobro', entidad_id: aOtra.cobro_id }`;
  - `si no hay nota que reciba dinero, el buzon apunta al movimiento de saldo a favor` → renómbrala a
    `si no hay nota que reciba dinero, el buzon apunta al pago del excedente` y espera
    `{ entidad_tabla: 'cobro', entidad_id: favor[0].cobro_id }` (agrega `'cobro_id'` al `select` de `saldoFavorDe`).

`apps/backend/test/ventas-editar.e2e-spec.ts`:
- importa `import { borrarCobrosDe, cobroParaNota } from './apoyo-cobros';`
- `abonar` gana en su `insertInto('cobranza_abono')`
  `cobro_id: await cobroParaNota(db, ventaId, { vendedorId: vendedorTj, monto, fecha: FECHA_A }),`
- en `una venta con un abono de saldo a favor no se edita…` el insert gana
  `cobro_id: await cobroParaNota(db, v.id, { vendedorId: null, monto: '70.00', fecha: FECHA_EDICION, metodoPago: 'saldo_favor', capturoUsuarioId: usuarioGeneralId }),`
- en `afterAll`, justo después del `deleteFrom('cobranza_abono')`, agrega `await borrarCobrosDe(db, clientes);`.

`apps/backend/test/ventas.e2e-spec.ts`: agrega `'cobro_id'` al `select` de `abonosDe` y `cobro_id: null` a los
dos objetos esperados de las pruebas `contado deja su cobro por transferencia…` y `contado en efectivo…`
(el cobro de contado **no** es un pago).

- [ ] **Paso 10: Correr todo lo del backend**

Run: `npm run lint --workspace=apps/backend`
Expected: sin errores.

Run: `npm test --workspace=apps/backend`
Expected: PASS.

Run: `npm run test:e2e --workspace=apps/backend`
Expected: PASS (incluidas las dos pruebas nuevas de `cobranzas-portal` y las cuatro del buzón renombradas).

Run: `npm run supabase -- test db`
Expected: PASS.

- [ ] **Paso 11: Commit**

```bash
git add supabase/migrations/20261013120000_peticiones_cobro.sql supabase/tests/99_peticiones_cobro_test.sql \
  supabase/tests/99_cobranza_portal_test.sql supabase/tests/99_cobranza_saldo_favor_test.sql \
  apps/backend/src/database/schema.d.ts \
  apps/backend/src/modules/ventas-cobranza/cobranzas.repository.ts \
  apps/backend/src/modules/ventas-cobranza/cobranzas.service.ts \
  apps/backend/src/modules/ventas-cobranza/cobranzas.service.spec.ts \
  apps/backend/src/modules/sincronizacion/sincronizacion.service.ts docs/contrato-sincronizacion.md \
  apps/backend/test/apoyo-cobros.ts apps/backend/test/cobranzas-portal.e2e-spec.ts \
  apps/backend/test/sincronizacion.e2e-spec.ts apps/backend/test/ventas-editar.e2e-spec.ts \
  apps/backend/test/ventas.e2e-spec.ts
git commit -m "T-34: el pago como entidad — tabla cobro, cobro_id, relleno y peticion; todo cobro nace con su pago

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Tarea 2: La regla pura — qué pasa al borrar un pago

Sin base ni Nest, como `reglas-cobranza.ts`: con lo que hay hoy en las notas y en el saldo a favor, dice cómo
quedaría cada nota del pago y el saldo a favor, y si hay algo que lo impide. La usan la vista previa y el
borrado (Tarea 3). **Modelo:** `haiku` para implementar, `sonnet` para revisar.

**Archivos:**
- Crear: `apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.spec.ts`

**Interfaces:**
- Consume: `saldoDerivadoCentavos(montoTotalCentavos, abonadoCentavos)` de `./reglas-cobranza`.
- Produce (todo exportado desde `reglas-borrado-cobro.ts`):
  ```ts
  export const MOTIVO_SALDO_FAVOR_APLICADO: string;
  export type StatusNota = 'pendiente' | 'abonado' | 'pagada' | 'cuenta_perdida';
  export interface NotaDelPago {
    id: string; folio: string; numNota: string | null; fecha: string;
    status: string;              // el de hoy, leido de la base
    montoTotalCentavos: number;
    abonadoVivoCentavos: number; // todo lo abonado vivo hoy, este pago incluido
    delPagoCentavos: number;     // lo que este pago le abono
  }
  export interface EntradaBorrado {
    notas: NotaDelPago[];
    saldoFavorVivoCentavos: number;    // suma de los movimientos vivos del cliente, el del pago incluido
    movimientoDelPagoCentavos: number; // + excedente, - aplicacion, 0 si el pago no movio saldo a favor
  }
  export interface NotaTrasBorrar {
    notaId: string; folio: string; numNota: string | null; fecha: string;
    delPagoCentavos: number; saldoAntesCentavos: number; saldoDespuesCentavos: number;
    statusDespues: StatusNota;
  }
  export interface BloqueoBorrado { codigo: 'saldo-favor-aplicado'; motivo: string }
  export interface PlanBorrado {
    notas: NotaTrasBorrar[];           // por fecha y folio
    saldoFavorAntesCentavos: number;
    saldoFavorDespuesCentavos: number;
    bloqueo: BloqueoBorrado | null;
  }
  export function statusTrasBorrar(statusActual: string, montoTotalCentavos: number, abonadoRestanteCentavos: number): StatusNota;
  export function planearBorrado(entrada: EntradaBorrado): PlanBorrado;
  ```

- [ ] **Paso 1: Las pruebas que fallan**

Crea `apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.spec.ts`:

```ts
import {
  MOTIVO_SALDO_FAVOR_APLICADO,
  planearBorrado,
  statusTrasBorrar,
  type NotaDelPago,
} from './reglas-borrado-cobro';

const nota = (
  id: string,
  fecha: string,
  extra: Partial<NotaDelPago> = {},
): NotaDelPago => ({
  id,
  folio: `TJ${fecha.slice(2, 4)}${fecha.slice(5, 7)}${fecha.slice(8, 10)}AP01`,
  numNota: null,
  fecha,
  status: 'pagada',
  montoTotalCentavos: 10000,
  abonadoVivoCentavos: 10000,
  delPagoCentavos: 10000,
  ...extra,
});

describe('statusTrasBorrar', () => {
  it.each([
    ['sin nada abonado vuelve a pendiente', 'pagada', 10000, 0, 'pendiente'],
    ['con algo abonado queda abonado', 'pagada', 10000, 4000, 'abonado'],
    ['si otro pago la sigue cubriendo completa, pagada', 'pagada', 10000, 10000, 'pagada'],
    ['abonos por encima del total (datos viejos) siguen siendo pagada', 'pagada', 10000, 12000, 'pagada'],
    ['una abonada que pierde su unico abono vuelve a pendiente', 'abonado', 10000, 0, 'pendiente'],
    ['cuenta perdida se queda en cuenta perdida', 'cuenta_perdida', 10000, 0, 'cuenta_perdida'],
  ])('%s', (_n, actual, total, restante, esperado) => {
    expect(statusTrasBorrar(actual, total, restante)).toBe(esperado);
  });
});

describe('planearBorrado', () => {
  it('un pago a dos notas con excedente: cada nota vuelve a deber lo suyo y el saldo a favor baja', () => {
    const plan = planearBorrado({
      notas: [
        nota('B', '2026-08-03', {
          montoTotalCentavos: 50000,
          abonadoVivoCentavos: 50000,
          delPagoCentavos: 50000,
        }),
        nota('A', '2026-08-01', {
          montoTotalCentavos: 60000,
          abonadoVivoCentavos: 60000,
          delPagoCentavos: 40000,
        }),
      ],
      saldoFavorVivoCentavos: 30000,
      movimientoDelPagoCentavos: 10000,
    });

    expect(plan).toEqual({
      notas: [
        {
          notaId: 'A',
          folio: 'TJ260801AP01',
          numNota: null,
          fecha: '2026-08-01',
          delPagoCentavos: 40000,
          saldoAntesCentavos: 0,
          saldoDespuesCentavos: 40000,
          statusDespues: 'abonado',
        },
        {
          notaId: 'B',
          folio: 'TJ260803AP01',
          numNota: null,
          fecha: '2026-08-03',
          delPagoCentavos: 50000,
          saldoAntesCentavos: 0,
          saldoDespuesCentavos: 50000,
          statusDespues: 'pendiente',
        },
      ],
      saldoFavorAntesCentavos: 30000,
      saldoFavorDespuesCentavos: 20000,
      bloqueo: null,
    });
  });

  it('borrar una aplicacion de saldo a favor devuelve el saldo', () => {
    const plan = planearBorrado({
      notas: [
        nota('A', '2026-08-01', {
          status: 'abonado',
          abonadoVivoCentavos: 3000,
          delPagoCentavos: 3000,
        }),
      ],
      saldoFavorVivoCentavos: 2000,
      movimientoDelPagoCentavos: -3000,
    });
    expect(plan.saldoFavorAntesCentavos).toBe(2000);
    expect(plan.saldoFavorDespuesCentavos).toBe(5000);
    expect(plan.notas[0]).toMatchObject({
      saldoAntesCentavos: 7000,
      saldoDespuesCentavos: 10000,
      statusDespues: 'pendiente',
    });
    expect(plan.bloqueo).toBeNull();
  });

  it('el excedente justo igual al saldo vivo se puede borrar (queda en 0)', () => {
    const plan = planearBorrado({
      notas: [],
      saldoFavorVivoCentavos: 5000,
      movimientoDelPagoCentavos: 5000,
    });
    expect(plan.saldoFavorDespuesCentavos).toBe(0);
    expect(plan.bloqueo).toBeNull();
  });

  it('Review Focus 1: si el excedente ya se aplico (quedaria en -$0.01), se bloquea con el mensaje', () => {
    const plan = planearBorrado({
      notas: [nota('A', '2026-08-01')],
      saldoFavorVivoCentavos: 4999,
      movimientoDelPagoCentavos: 5000,
    });
    expect(plan.saldoFavorDespuesCentavos).toBe(-1);
    expect(plan.bloqueo).toEqual({
      codigo: 'saldo-favor-aplicado',
      motivo: MOTIVO_SALDO_FAVOR_APLICADO,
    });
    expect(MOTIVO_SALDO_FAVOR_APLICADO).toBe(
      'El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.',
    );
  });

  it('Review Focus 3: con otro pago vivo la nota queda abonada, y en cuenta perdida no cambia', () => {
    const plan = planearBorrado({
      notas: [
        nota('A', '2026-08-01', {
          abonadoVivoCentavos: 10000,
          delPagoCentavos: 6000,
        }),
        nota('B', '2026-08-02', {
          status: 'cuenta_perdida',
          abonadoVivoCentavos: 2000,
          delPagoCentavos: 2000,
        }),
      ],
      saldoFavorVivoCentavos: 0,
      movimientoDelPagoCentavos: 0,
    });
    expect(plan.notas.map((n) => [n.notaId, n.statusDespues, n.saldoDespuesCentavos])).toEqual([
      ['A', 'abonado', 6000],
      ['B', 'cuenta_perdida', 10000],
    ]);
  });

  it('a igual fecha ordena por folio', () => {
    const plan = planearBorrado({
      notas: [
        nota('Z', '2026-08-01', { folio: 'TJ260801AP09' }),
        nota('Y', '2026-08-01', { folio: 'TJ260801AP02' }),
      ],
      saldoFavorVivoCentavos: 0,
      movimientoDelPagoCentavos: 0,
    });
    expect(plan.notas.map((n) => n.notaId)).toEqual(['Y', 'Z']);
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm test --workspace=apps/backend -- reglas-borrado-cobro`
Expected: FAIL — `Cannot find module './reglas-borrado-cobro'`.

- [ ] **Paso 3: La regla**

Crea `apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.ts`:

```ts
import { saldoDerivadoCentavos } from './reglas-cobranza';

/**
 * Reglas puras de borrar un pago (T-34), sin base de datos ni Nest.
 *
 * Se borra el pago COMPLETO (decision de Roberto, 2026-10-13): todas sus filas
 * en notas y su movimiento de saldo a favor. Esta regla no decide nada de
 * candados ni de permisos: con lo que hay hoy dice como quedaria cada nota y
 * el saldo a favor, y si algo lo impide. La vista previa la llama sin candados;
 * el borrado, sobre lo bloqueado (`CobrosBorradoService`).
 */

export const MOTIVO_SALDO_FAVOR_APLICADO =
  'El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.';

export type StatusNota = 'pendiente' | 'abonado' | 'pagada' | 'cuenta_perdida';

/** Una nota que recibio dinero de este pago, como esta hoy. */
export interface NotaDelPago {
  id: string;
  folio: string;
  numNota: string | null;
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** El status de hoy, leido de la base. */
  status: string;
  montoTotalCentavos: number;
  /** Todo lo abonado vivo hoy, este pago incluido. */
  abonadoVivoCentavos: number;
  /** Lo que este pago le abono (sus filas vivas). */
  delPagoCentavos: number;
}

export interface EntradaBorrado {
  notas: NotaDelPago[];
  /** La suma de los movimientos vivos de saldo a favor del cliente, el del pago incluido. */
  saldoFavorVivoCentavos: number;
  /** El movimiento del pago: + excedente, - aplicacion, 0 si no movio saldo a favor. */
  movimientoDelPagoCentavos: number;
}

/** Como quedaria una nota del pago. */
export interface NotaTrasBorrar {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  delPagoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  statusDespues: StatusNota;
}

export interface BloqueoBorrado {
  codigo: 'saldo-favor-aplicado';
  motivo: string;
}

export interface PlanBorrado {
  /** Por fecha y luego folio, como el resto de la cobranza. */
  notas: NotaTrasBorrar[];
  saldoFavorAntesCentavos: number;
  saldoFavorDespuesCentavos: number;
  /** `null` si se puede borrar. */
  bloqueo: BloqueoBorrado | null;
}

/**
 * El status de una nota sin las filas del pago. `cuenta_perdida` se queda: la
 * nota ya se dio por perdida y quitarle un cobro solo agranda lo perdido. Lo
 * demas sale de lo que le queda abonado vivo.
 */
export function statusTrasBorrar(
  statusActual: string,
  montoTotalCentavos: number,
  abonadoRestanteCentavos: number,
): StatusNota {
  if (statusActual === 'cuenta_perdida') return 'cuenta_perdida';
  if (abonadoRestanteCentavos <= 0) return 'pendiente';
  if (abonadoRestanteCentavos >= montoTotalCentavos) return 'pagada';
  return 'abonado';
}

function porFechaYFolio(a: NotaDelPago, b: NotaDelPago): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Que pasa si se borra el pago. Bloquea si el saldo a favor del cliente
 * quedaria negativo: el excedente que dejo este pago ya se uso en otra
 * aplicacion, y borrarlo seria regalar ese dinero dos veces.
 */
export function planearBorrado(entrada: EntradaBorrado): PlanBorrado {
  const notas = [...entrada.notas].sort(porFechaYFolio).map((n) => {
    const restante = n.abonadoVivoCentavos - n.delPagoCentavos;
    return {
      notaId: n.id,
      folio: n.folio,
      numNota: n.numNota,
      fecha: n.fecha,
      delPagoCentavos: n.delPagoCentavos,
      saldoAntesCentavos: saldoDerivadoCentavos(
        n.montoTotalCentavos,
        n.abonadoVivoCentavos,
      ),
      saldoDespuesCentavos: saldoDerivadoCentavos(n.montoTotalCentavos, restante),
      statusDespues: statusTrasBorrar(n.status, n.montoTotalCentavos, restante),
    };
  });

  const saldoFavorDespuesCentavos =
    entrada.saldoFavorVivoCentavos - entrada.movimientoDelPagoCentavos;

  return {
    notas,
    saldoFavorAntesCentavos: entrada.saldoFavorVivoCentavos,
    saldoFavorDespuesCentavos,
    bloqueo:
      saldoFavorDespuesCentavos < 0
        ? { codigo: 'saldo-favor-aplicado', motivo: MOTIVO_SALDO_FAVOR_APLICADO }
        : null,
  };
}
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npm test --workspace=apps/backend -- reglas-borrado-cobro`
Expected: PASS (6 casos de `statusTrasBorrar` + 6 de `planearBorrado`).

Run: `npm run lint --workspace=apps/backend`
Expected: sin errores (el script de lint ya corre con `--fix` y reacomoda las líneas largas).

- [ ] **Paso 5: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.ts \
  apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.spec.ts
git commit -m "T-34: regla pura de borrar un pago — status tras borrar y saldo a favor ya aplicado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Tarea 3: `CobrosBorradoService` — la vista previa y el borrado, con los candados del cobro

El borrado de verdad. **Una sola ruta para los dos**, como la vista previa de T-21 (`planearPago` bloquea y
calcula sin escribir): `planear` toma los candados y calcula; `borrar` = `planear` + escribir. Así la vista
previa y el borrado no pueden discrepar. La vista previa corre en una transacción que no escribe nada; sus
candados duran milisegundos (desviación 7, anotada abajo). Las pruebas de esta tarea son unitarias con el
repositorio de mentira; las e2e de punta a punta llegan con los endpoints (Tarea 4).
**Modelo:** `sonnet` para implementar, **`opus`** para revisar (candados).

**Archivos:**
- Crear: `apps/backend/src/modules/ventas-cobranza/cobros-borrado.repository.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/cobros-borrado.service.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/cobros-borrado.service.spec.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts` (proveedores)

**Interfaces:**
- Consume:
  - de la Tarea 1: tablas `cobro`, `cobranza_abono.cobro_id`, `saldo_favor_movimiento.cobro_id`;
  - de la Tarea 2: `planearBorrado`, `NotaTrasBorrar`, `BloqueoBorrado`, `StatusNota`, `MOTIVO_SALDO_FAVOR_APLICADO`;
  - de T-20/T-21 (`cobranzas.repository.ts`, sin cambios): `bloquearNotasDelCliente(clienteId, notaIds, trx): Promise<NotaBloqueada[]>`,
    `abonadoPorNota(ids, trx): Promise<Map<string, string>>`, `bloquearSaldoFavor(clienteId, trx): Promise<string[]>`.
- Produce:
  ```ts
  // cobros-borrado.repository.ts
  export interface CabeceraCobro {
    id: string; clienteId: string; cliente: string; sucursalId: string; sucursalCodigo: string;
    origen: 'cobro' | 'saldo_favor'; metodoPago: string; monto: string;   // texto numeric
    fechaPago: string; fechaOperacion: string;                              // AAAA-MM-DD
    cobrador: string | null;                                                // nombre del vendedor; null = Oficina
    borrado: boolean;
  }
  class CobrosBorradoRepository {
    cabecera(cobroId: string, conexion?: Database): Promise<CabeceraCobro | undefined>;
    delPagoPorNota(cobroId: string, trx: Transaction<DB>): Promise<Map<string, string>>;
    bloquearCobro(cobroId: string, trx: Transaction<DB>): Promise<{ borrado: boolean }>;
    movimientoDelPago(cobroId: string, trx: Transaction<DB>): Promise<string>;
    borrarPago(cobroId: string, usuarioId: string, trx: Transaction<DB>): Promise<void>;
    escribirStatusNota(notaId: string, status: StatusNota, trx: Transaction<DB>): Promise<void>;
    tocarCliente(clienteId: string, trx: Transaction<DB>): Promise<void>;
  }
  // cobros-borrado.service.ts
  export const MOTIVO_COBRO_NO_EXISTE = 'No existe ese cobro.';
  export const MOTIVO_COBRO_BORRADO = 'Este cobro ya se borró.';
  export type RazonNoBorrable = 'no-existe' | 'cobro-borrado' | 'saldo-favor-aplicado';
  export class CobroNoBorrable extends Error { readonly razon: RazonNoBorrable }
  export interface CobroEnVista {
    id: string; clienteId: string; cliente: string; sucursalCodigo: string;
    origen: 'cobro' | 'saldo_favor'; metodoPago: string; montoCentavos: number;
    fechaPago: string; fechaOperacion: string; cobrador: string | null;
  }
  export interface VistaBorrado {
    cobro: CobroEnVista;
    notas: NotaTrasBorrar[];
    saldoFavorAntesCentavos: number;
    saldoFavorDespuesCentavos: number;
    movimientoSaldoFavorCentavos: number;  // + excedente, - aplicacion, 0
    bloqueo: BloqueoBorrado | null;
  }
  class CobrosBorradoService {
    planear(cobroId: string, trx: Transaction<DB>): Promise<VistaBorrado>;
    borrar(cobroId: string, usuarioId: string, trx: Transaction<DB>): Promise<VistaBorrado>;
  }
  ```
  `planear` y `borrar` **no** exigen alcance ni permisos: los llama `PeticionesService` (Tarea 4) después de
  comprobar el alcance con `repo.cabecera`.

- [ ] **Paso 1: Pruebas unitarias que fallan**

Crea `apps/backend/src/modules/ventas-cobranza/cobros-borrado.service.spec.ts`:

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { CabeceraCobro } from './cobros-borrado.repository';
import {
  CobroNoBorrable,
  CobrosBorradoService,
  MOTIVO_COBRO_BORRADO,
  MOTIVO_COBRO_NO_EXISTE,
} from './cobros-borrado.service';
import type { NotaBloqueada } from './cobranzas.repository';
import { MOTIVO_SALDO_FAVOR_APLICADO } from './reglas-borrado-cobro';

const trx = {} as Transaction<DB>;
const COBRO = 'cobro-1';
const CLIENTE = 'cliente-1';
const A = 'nota-a';
const B = 'nota-b';

const cabecera = (extra: Partial<CabeceraCobro> = {}): CabeceraCobro => ({
  id: COBRO,
  clienteId: CLIENTE,
  cliente: 'Tacos Erick',
  sucursalId: 'sucursal-tj',
  sucursalCodigo: 'TJ',
  origen: 'cobro',
  metodoPago: 'efectivo',
  monto: '1000.00',
  fechaPago: '2026-10-10',
  fechaOperacion: '2026-10-10',
  cobrador: 'Juan Perez',
  borrado: false,
  ...extra,
});

const bloqueada = (
  id: string,
  fecha: string,
  montoTotal: string,
  status = 'pagada',
): NotaBloqueada => ({
  id,
  fecha,
  folio: `TJ${fecha.slice(2, 4)}${fecha.slice(5, 7)}${fecha.slice(8, 10)}AP01`,
  numNota: null,
  status,
  borrada: false,
  montoTotal,
});

/** Pago de $1,000: $400 a A, $500 a B y $100 a saldo a favor. */
function montar(
  opciones: {
    cab?: CabeceraCobro | undefined;
    delPago?: Map<string, string>;
    abonado?: Map<string, string>;
    saldoFavor?: string[];
    movimiento?: string;
    borradoAlBloquear?: boolean;
  } = {},
) {
  const repo = {
    cabecera: jest
      .fn()
      .mockResolvedValue('cab' in opciones ? opciones.cab : cabecera()),
    delPagoPorNota: jest.fn().mockResolvedValue(
      opciones.delPago ??
        new Map([
          [A, '400.00'],
          [B, '500.00'],
        ]),
    ),
    bloquearCobro: jest
      .fn()
      .mockResolvedValue({ borrado: opciones.borradoAlBloquear ?? false }),
    movimientoDelPago: jest.fn().mockResolvedValue(opciones.movimiento ?? '100.00'),
    borrarPago: jest.fn().mockResolvedValue(undefined),
    escribirStatusNota: jest.fn().mockResolvedValue(undefined),
    tocarCliente: jest.fn().mockResolvedValue(undefined),
  };
  const cobranzas = {
    bloquearNotasDelCliente: jest
      .fn()
      .mockResolvedValue([
        bloqueada(A, '2026-08-01', '600.00'),
        bloqueada(B, '2026-08-03', '500.00'),
      ]),
    abonadoPorNota: jest.fn().mockResolvedValue(
      opciones.abonado ??
        new Map([
          [A, '600.00'],
          [B, '500.00'],
        ]),
    ),
    bloquearSaldoFavor: jest.fn().mockResolvedValue(opciones.saldoFavor ?? ['300.00']),
  };
  const servicio = new CobrosBorradoService(repo as never, cobranzas as never);
  return { servicio, repo, cobranzas };
}

describe('CobrosBorradoService.planear', () => {
  it('cada nota vuelve a deber lo que le abono el pago, y el saldo a favor baja el excedente', async () => {
    const { servicio } = montar();
    await expect(servicio.planear(COBRO, trx)).resolves.toEqual({
      cobro: {
        id: COBRO,
        clienteId: CLIENTE,
        cliente: 'Tacos Erick',
        sucursalCodigo: 'TJ',
        origen: 'cobro',
        metodoPago: 'efectivo',
        montoCentavos: 100000,
        fechaPago: '2026-10-10',
        fechaOperacion: '2026-10-10',
        cobrador: 'Juan Perez',
      },
      notas: [
        {
          notaId: A,
          folio: 'TJ260801AP01',
          numNota: null,
          fecha: '2026-08-01',
          delPagoCentavos: 40000,
          saldoAntesCentavos: 0,
          saldoDespuesCentavos: 40000,
          statusDespues: 'abonado',
        },
        {
          notaId: B,
          folio: 'TJ260803AP01',
          numNota: null,
          fecha: '2026-08-03',
          delPagoCentavos: 50000,
          saldoAntesCentavos: 0,
          saldoDespuesCentavos: 50000,
          statusDespues: 'pendiente',
        },
      ],
      saldoFavorAntesCentavos: 30000,
      saldoFavorDespuesCentavos: 20000,
      movimientoSaldoFavorCentavos: 10000,
      bloqueo: null,
    });
  });

  it('Review Focus 1: candados en el orden del cobro — notas, saldo a favor, pago — y lo del pago se relee despues', async () => {
    const { servicio, repo, cobranzas } = montar();
    await servicio.planear(COBRO, trx);

    expect(cobranzas.bloquearNotasDelCliente).toHaveBeenCalledWith(
      CLIENTE,
      [A, B],
      trx,
    );
    const orden = [
      cobranzas.bloquearNotasDelCliente.mock.invocationCallOrder[0],
      cobranzas.abonadoPorNota.mock.invocationCallOrder[0],
      cobranzas.bloquearSaldoFavor.mock.invocationCallOrder[0],
      repo.bloquearCobro.mock.invocationCallOrder[0],
      repo.movimientoDelPago.mock.invocationCallOrder[0],
    ];
    expect([...orden].sort((x, y) => x - y)).toEqual(orden);
    // La segunda lectura de lo del pago va despues del candado del pago.
    expect(repo.delPagoPorNota.mock.invocationCallOrder[1]).toBeGreaterThan(
      repo.bloquearCobro.mock.invocationCallOrder[0],
    );
  });

  it('un pago que solo dejo saldo a favor igual bloquea las notas del cliente (mismo orden de candados)', async () => {
    const { servicio, cobranzas } = montar({ delPago: new Map() });
    const vista = await servicio.planear(COBRO, trx);
    expect(cobranzas.bloquearNotasDelCliente).toHaveBeenCalledWith(CLIENTE, [], trx);
    expect(vista.notas).toEqual([]);
  });

  it('un pago que no existe es no-existe', async () => {
    const { servicio, cobranzas } = montar({ cab: undefined });
    await expect(servicio.planear(COBRO, trx)).rejects.toMatchObject({
      razon: 'no-existe',
      message: MOTIVO_COBRO_NO_EXISTE,
    });
    expect(cobranzas.bloquearNotasDelCliente).not.toHaveBeenCalled();
  });

  it('un pago que resulto borrado al tomar su candado es cobro-borrado', async () => {
    const { servicio } = montar({ borradoAlBloquear: true });
    const error = await servicio.planear(COBRO, trx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CobroNoBorrable);
    expect(error).toMatchObject({
      razon: 'cobro-borrado',
      message: MOTIVO_COBRO_BORRADO,
    });
  });

  it('el bloqueo de saldo a favor ya aplicado viaja en la vista (no lanza)', async () => {
    const { servicio } = montar({ saldoFavor: ['100.00', '-60.00'] });
    const vista = await servicio.planear(COBRO, trx);
    expect(vista.saldoFavorDespuesCentavos).toBe(-6000);
    expect(vista.bloqueo).toEqual({
      codigo: 'saldo-favor-aplicado',
      motivo: MOTIVO_SALDO_FAVOR_APLICADO,
    });
  });
});

describe('CobrosBorradoService.borrar', () => {
  it('borra el pago completo, escribe el status de cada nota y toca al cliente por el saldo a favor', async () => {
    const { servicio, repo } = montar();
    const vista = await servicio.borrar(COBRO, 'usuario-1', trx);

    expect(repo.borrarPago).toHaveBeenCalledWith(COBRO, 'usuario-1', trx);
    expect(repo.escribirStatusNota).toHaveBeenCalledTimes(2);
    expect(repo.escribirStatusNota).toHaveBeenCalledWith(A, 'abonado', trx);
    expect(repo.escribirStatusNota).toHaveBeenCalledWith(B, 'pendiente', trx);
    expect(repo.tocarCliente).toHaveBeenCalledWith(CLIENTE, trx);
    expect(vista.saldoFavorDespuesCentavos).toBe(20000);
  });

  it('borrar una aplicacion de saldo a favor tambien toca al cliente (su saldo sube)', async () => {
    const { servicio, repo } = montar({
      cab: cabecera({ origen: 'saldo_favor', metodoPago: 'saldo_favor', cobrador: null }),
      delPago: new Map([[A, '30.00']]),
      abonado: new Map([[A, '30.00']]),
      movimiento: '-30.00',
      saldoFavor: ['20.00'],
    });
    const vista = await servicio.borrar(COBRO, 'usuario-1', trx);
    expect(vista.saldoFavorDespuesCentavos).toBe(5000);
    expect(repo.tocarCliente).toHaveBeenCalledWith(CLIENTE, trx);
  });

  it('un pago sin movimiento de saldo a favor no toca al cliente', async () => {
    const { servicio, repo } = montar({ movimiento: '0' });
    await servicio.borrar(COBRO, 'usuario-1', trx);
    expect(repo.tocarCliente).not.toHaveBeenCalled();
  });

  it('Review Focus 1: con el saldo a favor ya aplicado lanza y no escribe nada', async () => {
    const { servicio, repo } = montar({ saldoFavor: ['50.00'] });
    await expect(servicio.borrar(COBRO, 'usuario-1', trx)).rejects.toMatchObject({
      razon: 'saldo-favor-aplicado',
      message: MOTIVO_SALDO_FAVOR_APLICADO,
    });
    expect(repo.borrarPago).not.toHaveBeenCalled();
    expect(repo.escribirStatusNota).not.toHaveBeenCalled();
    expect(repo.tocarCliente).not.toHaveBeenCalled();
  });

  it('un pago ya borrado no se vuelve a borrar', async () => {
    const { servicio, repo } = montar({ borradoAlBloquear: true });
    await expect(servicio.borrar(COBRO, 'usuario-1', trx)).rejects.toMatchObject({
      razon: 'cobro-borrado',
    });
    expect(repo.borrarPago).not.toHaveBeenCalled();
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm test --workspace=apps/backend -- cobros-borrado`
Expected: FAIL — `Cannot find module './cobros-borrado.repository'`.

- [ ] **Paso 3: El repositorio**

Crea `apps/backend/src/modules/ventas-cobranza/cobros-borrado.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import type { StatusNota } from './reglas-borrado-cobro';

/** Un pago con lo necesario para pintarlo y exigir el alcance (T-34). */
export interface CabeceraCobro {
  id: string;
  clienteId: string;
  /** Nombre del cliente. */
  cliente: string;
  /** La sucursal del CLIENTE: la que define el alcance, como en el cobro. */
  sucursalId: string;
  sucursalCodigo: string;
  origen: 'cobro' | 'saldo_favor';
  metodoPago: string;
  /** Texto `numeric`: el pago completo. */
  monto: string;
  /** `AAAA-MM-DD` con `to_char`: un `date` leido como `Date` se corre un dia. */
  fechaPago: string;
  fechaOperacion: string;
  /** Nombre del vendedor que cobro; `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
  borrado: boolean;
}

/**
 * SQL de borrar un pago (T-34). Como `CobranzasRepository`: lo que escribe
 * recibe la `trx` de quien llama y ninguno abre la suya.
 */
@Injectable()
export class CobrosBorradoRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** El pago, **incluso borrado** (quien llama decide). Sin candado. */
  async cabecera(
    cobroId: string,
    conexion: Database = this.db,
  ): Promise<CabeceraCobro | undefined> {
    const filas = await sql<{
      id: string;
      cliente_id: string;
      cliente: string;
      sucursal_id: string;
      sucursal_codigo: string;
      origen: string;
      metodo_pago: string;
      monto: string;
      fecha_pago: string;
      fecha_operacion: string;
      cobrador: string | null;
      borrado: boolean;
    }>`
      select co.id, co.cliente_id, c.nombre as cliente, c.sucursal_id,
             s.codigo as sucursal_codigo, co.origen, co.metodo_pago,
             co.monto::text as monto,
             to_char(co.fecha_pago, 'YYYY-MM-DD') as fecha_pago,
             to_char(co.fecha_operacion, 'YYYY-MM-DD') as fecha_operacion,
             v.nombre as cobrador,
             co.deleted_at is not null as borrado
        from cobro co
        join cliente c on c.id = co.cliente_id
        join sucursal s on s.id = c.sucursal_id
        left join vendedor v on v.id = co.vendedor_id
       where co.id = ${cobroId}
    `.execute(conexion);
    const f = filas.rows[0];
    return f
      ? {
          id: f.id,
          clienteId: f.cliente_id,
          cliente: f.cliente,
          sucursalId: f.sucursal_id,
          sucursalCodigo: f.sucursal_codigo,
          origen: f.origen as 'cobro' | 'saldo_favor',
          metodoPago: f.metodo_pago,
          monto: f.monto,
          fechaPago: f.fecha_pago,
          fechaOperacion: f.fecha_operacion,
          cobrador: f.cobrador,
          borrado: f.borrado,
        }
      : undefined;
  }

  /** Lo que el pago le abono a cada nota (sus filas vivas), texto `numeric`. */
  async delPagoPorNota(
    cobroId: string,
    trx: Transaction<DB>,
  ): Promise<Map<string, string>> {
    const filas = await trx
      .selectFrom('cobranza_abono')
      .select(['venta_nota_id', sql<string>`sum(monto)::text`.as('monto')])
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .groupBy('venta_nota_id')
      .execute();
    return new Map(filas.map((f) => [f.venta_nota_id, f.monto]));
  }

  /** `for update` de la fila del pago: el ultimo candado (despues de notas y saldo a favor). */
  async bloquearCobro(
    cobroId: string,
    trx: Transaction<DB>,
  ): Promise<{ borrado: boolean }> {
    const filas = await sql<{ borrado: boolean }>`
      select deleted_at is not null as borrado
        from cobro
       where id = ${cobroId}
         for update
    `.execute(trx);
    const fila = filas.rows[0];
    if (!fila) throw new Error(`El cobro ${cobroId} desaparecio bajo el candado.`);
    return fila;
  }

  /** Su movimiento vivo de saldo a favor: + excedente, - aplicacion, `0` si no tiene. */
  async movimientoDelPago(
    cobroId: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .selectFrom('saldo_favor_movimiento')
      .select(sql<string>`coalesce(sum(monto), 0)::text`.as('total'))
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return fila.total;
  }

  /** El pago completo: el `cobro` (con quien lo borro), sus filas en notas y su saldo a favor. */
  async borrarPago(
    cobroId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('cobranza_abono')
      .set({ deleted_at: sql`now()` })
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .execute();
    await trx
      .updateTable('saldo_favor_movimiento')
      .set({ deleted_at: sql`now()` })
      .where('cobro_id', '=', cobroId)
      .where('deleted_at', 'is', null)
      .execute();
    await trx
      .updateTable('cobro')
      .set({ deleted_at: sql`now()`, eliminado_por_usuario_id: usuarioId })
      .where('id', '=', cobroId)
      .execute();
  }

  /**
   * El status tras borrar. Se escribe aunque no cambie: el trigger le toca
   * `updated_at` y el pull incremental de la tablet la vuelve a bajar (D12).
   */
  async escribirStatusNota(
    notaId: string,
    status: StatusNota,
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('venta_nota')
      .set({ status })
      .where('id', '=', notaId)
      .execute();
  }

  /** `updated_at` del cliente: asi el pull incremental le baja el saldo a favor nuevo. */
  async tocarCliente(clienteId: string, trx: Transaction<DB>): Promise<void> {
    await trx
      .updateTable('cliente')
      .set({ updated_at: sql`now()` })
      .where('id', '=', clienteId)
      .execute();
  }
}
```

- [ ] **Paso 4: El servicio**

Crea `apps/backend/src/modules/ventas-cobranza/cobros-borrado.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { aCentavos } from '../sincronizacion/dinero';
import {
  CobrosBorradoRepository,
  type CabeceraCobro,
} from './cobros-borrado.repository';
import { CobranzasRepository } from './cobranzas.repository';
import {
  planearBorrado,
  type BloqueoBorrado,
  type NotaTrasBorrar,
} from './reglas-borrado-cobro';

export const MOTIVO_COBRO_NO_EXISTE = 'No existe ese cobro.';
export const MOTIVO_COBRO_BORRADO = 'Este cobro ya se borró.';

export type RazonNoBorrable =
  | 'no-existe'
  | 'cobro-borrado'
  | 'saldo-favor-aplicado';

/** Un pago que no se puede borrar (o ver) ahora. Quien llama lo traduce a HTTP. */
export class CobroNoBorrable extends Error {
  constructor(
    readonly razon: RazonNoBorrable,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'CobroNoBorrable';
  }
}

/** El pago, listo para la pantalla: dinero en centavos. */
export interface CobroEnVista {
  id: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  origen: 'cobro' | 'saldo_favor';
  metodoPago: string;
  montoCentavos: number;
  fechaPago: string;
  fechaOperacion: string;
  /** `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
}

/** `GET /cobros/:id/vista-borrado` y `GET /peticiones/:id/vista-previa` (§3.1). */
export interface VistaBorrado {
  cobro: CobroEnVista;
  notas: NotaTrasBorrar[];
  saldoFavorAntesCentavos: number;
  saldoFavorDespuesCentavos: number;
  /** El movimiento del pago: + excedente, - aplicacion, 0 si no movio saldo a favor. */
  movimientoSaldoFavorCentavos: number;
  bloqueo: BloqueoBorrado | null;
}

const enVista = (c: CabeceraCobro): CobroEnVista => ({
  id: c.id,
  clienteId: c.clienteId,
  cliente: c.cliente,
  sucursalCodigo: c.sucursalCodigo,
  origen: c.origen,
  metodoPago: c.metodoPago,
  montoCentavos: aCentavos(c.monto),
  fechaPago: c.fechaPago,
  fechaOperacion: c.fechaOperacion,
  cobrador: c.cobrador,
});

/**
 * Borrar un pago completo (T-34). No sabe de peticiones, permisos ni alcance:
 * `PeticionesService` exige el alcance con `cabecera` antes de llamarlo.
 *
 * Candados en el MISMO orden que el cobro (T-20/T-21): las notas del cliente
 * (`bloquearNotasDelCliente`, en orden de id), su saldo a favor, y al final la
 * fila del pago. Un cobro de la tablet o del portal sobre el mismo cliente se
 * serializa con el borrado, sin abrazo mortal; las decisiones se toman sobre lo
 * bloqueado, nunca sobre lo que leyo la pantalla (leccion de T-19).
 */
@Injectable()
export class CobrosBorradoService {
  constructor(
    private readonly repo: CobrosBorradoRepository,
    private readonly cobranzas: CobranzasRepository,
  ) {}

  /**
   * Toma los candados y dice que pasaria. No escribe nada. El bloqueo (saldo a
   * favor ya aplicado) viaja en la vista, no se lanza: la pantalla lo muestra.
   *
   * @throws {CobroNoBorrable} `no-existe` o `cobro-borrado`.
   */
  async planear(cobroId: string, trx: Transaction<DB>): Promise<VistaBorrado> {
    const cabecera = await this.repo.cabecera(cobroId, trx);
    if (!cabecera)
      throw new CobroNoBorrable('no-existe', MOTIVO_COBRO_NO_EXISTE);

    // Las notas de un pago no cambian nunca (sus filas se escriben al cobrar),
    // asi que se pueden leer antes del candado para saber cuales bloquear.
    const notaIds = [...(await this.repo.delPagoPorNota(cobroId, trx)).keys()];
    const bloqueadas = await this.cobranzas.bloquearNotasDelCliente(
      cabecera.clienteId,
      notaIds,
      trx,
    );
    const abonado = await this.cobranzas.abonadoPorNota(notaIds, trx);
    const saldoFavorVivo = (
      await this.cobranzas.bloquearSaldoFavor(cabecera.clienteId, trx)
    ).reduce((total, monto) => total + aCentavos(monto), 0);

    if ((await this.repo.bloquearCobro(cobroId, trx)).borrado)
      throw new CobroNoBorrable('cobro-borrado', MOTIVO_COBRO_BORRADO);

    // Ya con el pago bloqueado: lo suyo, releido.
    const delPago = await this.repo.delPagoPorNota(cobroId, trx);
    const movimiento = aCentavos(await this.repo.movimientoDelPago(cobroId, trx));

    const porId = new Map(bloqueadas.map((n) => [n.id, n]));
    const plan = planearBorrado({
      notas: [...delPago].map(([id, monto]) => {
        const nota = porId.get(id);
        // Imposible por construccion: el pago y sus notas son del mismo cliente.
        if (!nota) throw new Error(`La nota ${id} del cobro ${cobroId} no es de su cliente.`);
        return {
          id,
          folio: nota.folio,
          numNota: nota.numNota,
          fecha: nota.fecha,
          status: nota.status,
          montoTotalCentavos: aCentavos(nota.montoTotal),
          abonadoVivoCentavos: aCentavos(abonado.get(id)),
          delPagoCentavos: aCentavos(monto),
        };
      }),
      saldoFavorVivoCentavos: saldoFavorVivo,
      movimientoDelPagoCentavos: movimiento,
    });

    return {
      cobro: enVista(cabecera),
      ...plan,
      movimientoSaldoFavorCentavos: movimiento,
    };
  }

  /**
   * Borra el pago completo dentro de la transaccion de quien llama: el
   * `cobro`, sus filas en notas y su saldo a favor (`deleted_at`), el status de
   * cada nota y, si movio saldo a favor, el `updated_at` del cliente (pull).
   *
   * @throws {CobroNoBorrable} `no-existe`, `cobro-borrado` o
   * `saldo-favor-aplicado`. No escribe nada antes de lanzar.
   */
  async borrar(
    cobroId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<VistaBorrado> {
    const vista = await this.planear(cobroId, trx);
    if (vista.bloqueo)
      throw new CobroNoBorrable('saldo-favor-aplicado', vista.bloqueo.motivo);

    await this.repo.borrarPago(cobroId, usuarioId, trx);
    for (const nota of vista.notas)
      await this.repo.escribirStatusNota(nota.notaId, nota.statusDespues, trx);
    if (vista.movimientoSaldoFavorCentavos !== 0)
      await this.repo.tocarCliente(vista.cobro.clienteId, trx);
    return vista;
  }
}
```

`cabecera` recibe la `trx` como `Database`: `Transaction<DB>` extiende `Kysely<DB>`, así que el tipo encaja.

En `ventas-cobranza.module.ts`, importa `CobrosBorradoRepository` y `CobrosBorradoService` y agrégalos a
`providers` con el comentario `// T-34: borrar un pago (via peticion)`.

- [ ] **Paso 5: Correr y ver que pasa**

Run: `npm test --workspace=apps/backend -- cobros-borrado`
Expected: PASS (6 de `planear` + 5 de `borrar`).

Run: `npm run build --workspace=apps/backend && npm run lint --workspace=apps/backend`
Expected: compila y sin errores de lint (el script de lint ya corre con `--fix`).

- [ ] **Paso 6: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/cobros-borrado.repository.ts \
  apps/backend/src/modules/ventas-cobranza/cobros-borrado.service.ts \
  apps/backend/src/modules/ventas-cobranza/cobros-borrado.service.spec.ts \
  apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts
git commit -m "T-34: CobrosBorradoService — vista previa y borrado del pago completo con los candados del cobro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Tarea 4: Peticiones — los endpoints y las pruebas de punta a punta

Pedir, ver la bandeja, autorizar y denegar, y la vista previa por cobro o por petición. Toda decisión se toma
dentro de **una** transacción y **después** de los candados. El alcance se exige **antes** de decir si el
pago está borrado o la petición resuelta (Review Focus 4). **Modelo:** **`opus`** para implementar y revisar.

**Archivos:**
- Crear: `apps/backend/src/modules/ventas-cobranza/peticiones.repository.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/peticiones.service.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/peticiones.service.spec.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/peticiones.controller.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/cobros.controller.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/dto/peticiones.dto.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`
- Crear: `apps/backend/test/peticiones.e2e-spec.ts`

**Interfaces:**
- Consume:
  - Tarea 3: `CobrosBorradoService.planear(cobroId, trx)`, `.borrar(cobroId, usuarioId, trx)`, `CobroNoBorrable`
    (`razon`), `MOTIVO_COBRO_NO_EXISTE`, `MOTIVO_COBRO_BORRADO`, `VistaBorrado`;
    `CobrosBorradoRepository.cabecera(cobroId, conexion)`.
  - T-17/T-21: `exigirAlcanceSobre(usuario, codigo)` (`alcance-venta.ts`), `resolverAlcance` y
    `normalizarSucursalPedida` (`sucursales/alcance-sucursal.ts`), `VentasPortalRepository.buscarSucursalUsuario(usuarioId)`,
    `MOTIVO_INTERBLOQUEO_COBRO` (`cobranzas-portal.service.ts`), `esConflictoDeConcurrencia`,
    `esViolacionUnicidad`, `restriccionDelError` (`database/errores-postgres.ts`).
  - Tarea 1 (e2e): `borrarCobrosDe(db, clienteIds)` de `apoyo-cobros.ts`.
- Produce:
  ```ts
  // peticiones.repository.ts
  export type StatusPeticion = 'pendiente' | 'autorizada' | 'denegada';
  export interface CobroDePeticion {
    id: string; clienteId: string; cliente: string; montoCentavos: number;
    metodoPago: string; origen: 'cobro' | 'saldo_favor'; fechaPago: string;
    cobrador: string | null;
    folios: string[];   // las notas del pago, por fecha y folio (sus filas vivas o borradas)
  }
  export interface PeticionEnBandeja {
    id: string; tipo: 'eliminar_cobro'; status: StatusPeticion; sucursalCodigo: string;
    motivo: string; solicito: string; creadaEn: string;          // 'AAAA-MM-DD HH:MM' Tijuana
    resolvio: string | null; resueltaEn: string | null; comentario: string | null;
    cobro: CobroDePeticion;
  }
  // peticiones.service.ts
  export const MOTIVO_PETICION_NO_EXISTE = 'No existe esa petición.';
  export const MOTIVO_PETICION_RESUELTA = 'Esta petición ya fue resuelta.';
  export const MOTIVO_PETICION_PENDIENTE = 'Este cobro ya tiene una petición de borrado pendiente.';
  export const MOTIVO_SIN_MOTIVO = 'Escribe el motivo de la petición.';
  export const MOTIVO_MOTIVO_LARGO = 'El motivo no puede pasar de 500 caracteres.';
  export const MOTIVO_COMENTARIO_LARGO = 'El comentario no puede pasar de 500 caracteres.';
  export function normalizarMotivo(crudo: string | undefined): string;          // 400 si vacio o > 500
  export function normalizarComentario(crudo: string | undefined): string | null; // 400 si > 500
  // dto/peticiones.dto.ts
  export const MOTIVO_STATUS_BANDEJA = 'Elige pendientes o historial.';
  ```
  Endpoints: la tabla de "Restricciones globales".

- [ ] **Paso 1: Pruebas unitarias de las normalizaciones**

Crea `apps/backend/src/modules/ventas-cobranza/peticiones.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import {
  MOTIVO_COMENTARIO_LARGO,
  MOTIVO_MOTIVO_LARGO,
  MOTIVO_SIN_MOTIVO,
  normalizarComentario,
  normalizarMotivo,
} from './peticiones.service';

describe('normalizarMotivo', () => {
  it('recorta los espacios', () => {
    expect(normalizarMotivo('  Era de credito  ')).toBe('Era de credito');
  });

  it.each([[undefined], [''], ['   ']])('sin texto (%p) es 400', (crudo) => {
    expect(() => normalizarMotivo(crudo)).toThrow(
      new BadRequestException(MOTIVO_SIN_MOTIVO),
    );
  });

  it('500 caracteres entran; 501 no', () => {
    expect(normalizarMotivo('x'.repeat(500))).toHaveLength(500);
    expect(() => normalizarMotivo('x'.repeat(501))).toThrow(MOTIVO_MOTIVO_LARGO);
  });
});

describe('normalizarComentario', () => {
  it('vacio o ausente es null; con texto, recortado', () => {
    expect(normalizarComentario(undefined)).toBeNull();
    expect(normalizarComentario('   ')).toBeNull();
    expect(normalizarComentario(' No procede ')).toBe('No procede');
  });

  it('mas de 500 caracteres es 400', () => {
    expect(() => normalizarComentario('x'.repeat(501))).toThrow(
      MOTIVO_COMENTARIO_LARGO,
    );
  });
});
```

Run: `npm test --workspace=apps/backend -- peticiones.service`
Expected: FAIL — `Cannot find module './peticiones.service'`.

- [ ] **Paso 2: El DTO**

Crea `apps/backend/src/modules/ventas-cobranza/dto/peticiones.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { MOTIVO_SIN_MOTIVO } from '../peticiones.service';

export const MOTIVO_STATUS_BANDEJA = 'Elige pendientes o historial.';

/** `GET /peticiones` (T-34, §3.2). */
export class BandejaDto {
  @IsIn(['pendiente', 'historial'], { message: MOTIVO_STATUS_BANDEJA })
  status!: 'pendiente' | 'historial';

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/**
 * `POST /peticiones/eliminar-cobro`. El motivo se recorta y se mide en el
 * servicio (`normalizarMotivo`): aqui solo se exige que sea texto.
 */
export class SolicitarEliminarCobroDto {
  @IsUUID(undefined, { message: 'Elige el cobro.' })
  cobroId!: string;

  @IsString({ message: MOTIVO_SIN_MOTIVO })
  motivo!: string;
}

/** `POST /peticiones/:id/denegar`. El comentario es opcional. */
export class DenegarPeticionDto {
  @IsOptional()
  @IsString({ message: 'El comentario debe ser texto.' })
  comentario?: string;
}
```

- [ ] **Paso 3: El repositorio**

Crea `apps/backend/src/modules/ventas-cobranza/peticiones.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aCentavos } from '../sincronizacion/dinero';

export type StatusPeticion = 'pendiente' | 'autorizada' | 'denegada';

/** El pago de una peticion, para pintarlo en la bandeja. */
export interface CobroDePeticion {
  id: string;
  clienteId: string;
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: 'cobro' | 'saldo_favor';
  /** `AAAA-MM-DD`. */
  fechaPago: string;
  /** Nombre del vendedor; `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
  /** Folios de las notas del pago, por fecha y folio. Incluye filas ya borradas (historial). */
  folios: string[];
}

/** Un renglon de la bandeja (§3.2). Fechas en hora de Tijuana, `AAAA-MM-DD HH:MM`. */
export interface PeticionEnBandeja {
  id: string;
  tipo: 'eliminar_cobro';
  status: StatusPeticion;
  sucursalCodigo: string;
  motivo: string;
  /** Nombre de quien la pidio. */
  solicito: string;
  creadaEn: string;
  resolvio: string | null;
  resueltaEn: string | null;
  comentario: string | null;
  cobro: CobroDePeticion;
}

/** Ya resuelto por el servicio: el alcance aplicado. */
export interface FiltroBandeja {
  id?: string;
  status?: 'pendiente' | 'historial';
  /** `null` = todas las sucursales. */
  sucursalCodigo: string | null;
}

/** Lo minimo para decidir sobre una peticion. */
export interface PeticionParaResolver {
  id: string;
  status: StatusPeticion;
  cobroId: string;
  sucursalCodigo: string;
}

/** El historial muestra solo las mas recientes (§5: sin paginacion por ahora). */
export const LIMITE_HISTORIAL = 200;

/**
 * SQL de la bandeja de peticiones (T-34). Las escrituras reciben la `trx` de
 * `PeticionesService`, que abre UNA transaccion por accion.
 */
@Injectable()
export class PeticionesRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  enTransaccion<T>(tarea: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(tarea);
  }

  async buscar(filtro: FiltroBandeja): Promise<PeticionEnBandeja[]> {
    const condiciones = [sql`true`];
    if (filtro.id !== undefined) condiciones.push(sql`p.id = ${filtro.id}`);
    if (filtro.status === 'pendiente')
      condiciones.push(sql`p.status = 'pendiente'`);
    if (filtro.status === 'historial')
      condiciones.push(sql`p.status <> 'pendiente'`);
    if (filtro.sucursalCodigo !== null)
      condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);
    const orden =
      filtro.status === 'historial'
        ? sql`order by p.resuelta_en desc, p.created_at desc limit ${LIMITE_HISTORIAL}`
        : sql`order by p.created_at, p.id`;

    const filas = await sql<{
      id: string;
      status: string;
      sucursal_codigo: string;
      motivo: string;
      solicito: string;
      creada_en: string;
      resolvio: string | null;
      resuelta_en: string | null;
      comentario: string | null;
      cobro_id: string;
      cliente_id: string;
      cliente: string;
      monto: string;
      metodo_pago: string;
      origen: string;
      fecha_pago: string;
      cobrador: string | null;
      folios: string[];
    }>`
      select p.id, p.status, s.codigo as sucursal_codigo, p.motivo,
             us.nombre as solicito,
             to_char(p.created_at at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI') as creada_en,
             ur.nombre as resolvio,
             to_char(p.resuelta_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI') as resuelta_en,
             p.comentario_resolucion as comentario,
             co.id as cobro_id, co.cliente_id, c.nombre as cliente,
             co.monto::text as monto, co.metodo_pago, co.origen,
             to_char(co.fecha_pago, 'YYYY-MM-DD') as fecha_pago,
             v.nombre as cobrador,
             coalesce((select array_agg(vn.folio order by vn.fecha, vn.folio)
                         from venta_nota vn
                        where vn.id in (select ca.venta_nota_id
                                          from cobranza_abono ca
                                         where ca.cobro_id = co.id)),
                      '{}') as folios
        from peticion p
        join sucursal s on s.id = p.sucursal_id
        join usuario us on us.id = p.solicito_usuario_id
        left join usuario ur on ur.id = p.resuelta_por_usuario_id
        join cobro co on co.id = p.cobro_id
        join cliente c on c.id = co.cliente_id
        left join vendedor v on v.id = co.vendedor_id
       where ${sql.join(condiciones, sql` and `)}
       ${orden}
    `.execute(this.db);

    return filas.rows.map((f) => ({
      id: f.id,
      tipo: 'eliminar_cobro',
      status: f.status as StatusPeticion,
      sucursalCodigo: f.sucursal_codigo,
      motivo: f.motivo,
      solicito: f.solicito,
      creadaEn: f.creada_en,
      resolvio: f.resolvio,
      resueltaEn: f.resuelta_en,
      comentario: f.comentario,
      cobro: {
        id: f.cobro_id,
        clienteId: f.cliente_id,
        cliente: f.cliente,
        montoCentavos: aCentavos(f.monto),
        metodoPago: f.metodo_pago,
        origen: f.origen as 'cobro' | 'saldo_favor',
        fechaPago: f.fecha_pago,
        cobrador: f.cobrador,
        folios: f.folios,
      },
    }));
  }

  /** Pendiente por default. El `unique` parcial decide si ya hay otra (23505). */
  async insertar(
    nueva: { cobroId: string; sucursalId: string; motivo: string; usuarioId: string },
    trx: Transaction<DB>,
  ): Promise<string> {
    const fila = await trx
      .insertInto('peticion')
      .values({
        tipo: 'eliminar_cobro',
        cobro_id: nueva.cobroId,
        sucursal_id: nueva.sucursalId,
        motivo: nueva.motivo,
        solicito_usuario_id: nueva.usuarioId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return fila.id;
  }

  /** Sin candado: para la vista previa de una peticion. */
  cabecera(
    id: string,
    conexion: Database = this.db,
  ): Promise<PeticionParaResolver | undefined> {
    return this.leer(id, false, conexion);
  }

  /**
   * `for update of p`: el PRIMER candado de autorizar y denegar. Ningun cobro
   * bloquea peticiones, asi que tomarlo antes que las notas no arma ciclos.
   * Dos resoluciones a la vez: la segunda espera aqui y luego ve la resuelta.
   */
  bloquear(
    id: string,
    trx: Transaction<DB>,
  ): Promise<PeticionParaResolver | undefined> {
    return this.leer(id, true, trx);
  }

  async resolver(
    id: string,
    resolucion: {
      status: 'autorizada' | 'denegada';
      usuarioId: string;
      comentario: string | null;
    },
    trx: Transaction<DB>,
  ): Promise<void> {
    await trx
      .updateTable('peticion')
      .set({
        status: resolucion.status,
        resuelta_por_usuario_id: resolucion.usuarioId,
        resuelta_en: sql`now()`,
        comentario_resolucion: resolucion.comentario,
      })
      .where('id', '=', id)
      .execute();
  }

  private async leer(
    id: string,
    bloquear: boolean,
    conexion: Database,
  ): Promise<PeticionParaResolver | undefined> {
    const filas = await sql<{
      id: string;
      status: string;
      cobro_id: string;
      sucursal_codigo: string;
    }>`
      select p.id, p.status, p.cobro_id, s.codigo as sucursal_codigo
        from peticion p
        join sucursal s on s.id = p.sucursal_id
       where p.id = ${id}
       ${bloquear ? sql`for update of p` : sql``}
    `.execute(conexion);
    const f = filas.rows[0];
    return f
      ? {
          id: f.id,
          status: f.status as StatusPeticion,
          cobroId: f.cobro_id,
          sucursalCodigo: f.sucursal_codigo,
        }
      : undefined;
  }
}
```

- [ ] **Paso 4: El servicio**

Crea `apps/backend/src/modules/ventas-cobranza/peticiones.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import {
  esConflictoDeConcurrencia,
  esViolacionUnicidad,
  restriccionDelError,
} from '../../database/errores-postgres';
import type { DB } from '../../database/schema';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { exigirAlcanceSobre } from './alcance-venta';
import { CobrosBorradoRepository } from './cobros-borrado.repository';
import {
  CobroNoBorrable,
  CobrosBorradoService,
  MOTIVO_COBRO_BORRADO,
  MOTIVO_COBRO_NO_EXISTE,
  type VistaBorrado,
} from './cobros-borrado.service';
import { MOTIVO_INTERBLOQUEO_COBRO } from './cobranzas-portal.service';
import type {
  BandejaDto,
  DenegarPeticionDto,
  SolicitarEliminarCobroDto,
} from './dto/peticiones.dto';
import {
  PeticionesRepository,
  type PeticionEnBandeja,
  type PeticionParaResolver,
} from './peticiones.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

export const MOTIVO_PETICION_NO_EXISTE = 'No existe esa petición.';
export const MOTIVO_PETICION_RESUELTA = 'Esta petición ya fue resuelta.';
export const MOTIVO_PETICION_PENDIENTE =
  'Este cobro ya tiene una petición de borrado pendiente.';
export const MOTIVO_SIN_MOTIVO = 'Escribe el motivo de la petición.';
export const MOTIVO_MOTIVO_LARGO = 'El motivo no puede pasar de 500 caracteres.';
export const MOTIVO_COMENTARIO_LARGO =
  'El comentario no puede pasar de 500 caracteres.';

const LARGO_MAX = 500;

/** El motivo recortado; vacio o de mas de 500 es 400 (`ck_peticion_motivo` lo repite en la base). */
export function normalizarMotivo(crudo: string | undefined): string {
  const motivo = (crudo ?? '').trim();
  if (motivo === '') throw new BadRequestException(MOTIVO_SIN_MOTIVO);
  if (motivo.length > LARGO_MAX)
    throw new BadRequestException(MOTIVO_MOTIVO_LARGO);
  return motivo;
}

/** El comentario de una denegacion: opcional, recortado, `null` si viene vacio. */
export function normalizarComentario(crudo: string | undefined): string | null {
  const comentario = (crudo ?? '').trim();
  if (comentario === '') return null;
  if (comentario.length > LARGO_MAX)
    throw new BadRequestException(MOTIVO_COMENTARIO_LARGO);
  return comentario;
}

type UsuarioConSucursal = Parameters<typeof exigirAlcanceSobre>[0];

/**
 * Peticiones (T-34): pedir el borrado de un pago y autorizarlo o denegarlo.
 *
 * - **Alcance primero**: se compara contra la sucursal LEIDA (del cliente del
 *   pago, o la que guardo la peticion), y ANTES de decir si el pago esta
 *   borrado o la peticion resuelta, para no revelar nada de otra sucursal.
 * - **Una transaccion por accion**; al autorizar, la peticion se bloquea
 *   PRIMERO y despues `CobrosBorradoService.borrar` toma los candados del cobro.
 * - Quien pide puede ser quien autoriza (decision de Roberto, 2026-10-13).
 */
@Injectable()
export class PeticionesService {
  constructor(
    private readonly repo: PeticionesRepository,
    private readonly borrado: CobrosBorradoService,
    private readonly cobros: CobrosBorradoRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async bandeja(
    usuarioId: string,
    dto: BandejaDto,
  ): Promise<PeticionEnBandeja[]> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    // El query param es solo preferencia; pedir una sucursal ajena es 403.
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(dto.sucursal),
    );
    return this.repo.buscar({
      status: dto.status,
      sucursalCodigo: alcance.tipo === 'una' ? alcance.codigo : null,
    });
  }

  /** `GET /cobros/:id/vista-borrado`: para quien pide. */
  async vistaDeCobro(usuarioId: string, cobroId: string): Promise<VistaBorrado> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    return this.enTransaccion(async (trx) => {
      await this.cobroConAlcance(usuario, cobroId, trx);
      return this.borrado.planear(cobroId, trx);
    });
  }

  /** `GET /peticiones/:id/vista-previa`: para quien autoriza, recalculada al momento. */
  async vistaDePeticion(
    usuarioId: string,
    peticionId: string,
  ): Promise<VistaBorrado> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    return this.enTransaccion(async (trx) => {
      const peticion = await this.repo.cabecera(peticionId, trx);
      this.exigirPeticion(usuario, peticion);
      return this.borrado.planear(peticion.cobroId, trx);
    });
  }

  async solicitarEliminarCobro(
    usuarioId: string,
    dto: SolicitarEliminarCobroDto,
  ): Promise<PeticionEnBandeja> {
    const motivo = normalizarMotivo(dto.motivo);
    const cobroId = dto.cobroId.toLowerCase();
    // Fuera de la transaccion: dentro seria una segunda conexion abierta a la vez.
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    const id = await this.enTransaccion(async (trx) => {
      const cabecera = await this.cobroConAlcance(usuario, cobroId, trx);
      if (cabecera.borrado) throw new ConflictException(MOTIVO_COBRO_BORRADO);
      try {
        return await this.repo.insertar(
          { cobroId, sucursalId: cabecera.sucursalId, motivo, usuarioId },
          trx,
        );
      } catch (error) {
        if (
          esViolacionUnicidad(error) &&
          restriccionDelError(error) === 'uq_peticion_cobro_pendiente'
        )
          throw new ConflictException(MOTIVO_PETICION_PENDIENTE);
        throw error;
      }
    });
    return this.unaPeticion(id);
  }

  async autorizar(
    usuarioId: string,
    peticionId: string,
  ): Promise<PeticionEnBandeja> {
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    await this.enTransaccion(async (trx) => {
      const peticion = await this.pendienteBloqueada(usuario, peticionId, trx);
      // Si no se puede (saldo a favor ya aplicado), lanza y la transaccion
      // entera se revierte: la peticion sigue pendiente.
      await this.borrado.borrar(peticion.cobroId, usuarioId, trx);
      await this.repo.resolver(
        peticion.id,
        { status: 'autorizada', usuarioId, comentario: null },
        trx,
      );
    });
    return this.unaPeticion(peticionId);
  }

  async denegar(
    usuarioId: string,
    peticionId: string,
    dto: DenegarPeticionDto,
  ): Promise<PeticionEnBandeja> {
    const comentario = normalizarComentario(dto.comentario);
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    await this.enTransaccion(async (trx) => {
      const peticion = await this.pendienteBloqueada(usuario, peticionId, trx);
      await this.repo.resolver(
        peticion.id,
        { status: 'denegada', usuarioId, comentario },
        trx,
      );
    });
    return this.unaPeticion(peticionId);
  }

  /* ---------------------------------------------------------------- */

  private async cobroConAlcance(
    usuario: UsuarioConSucursal,
    cobroId: string,
    trx: Transaction<DB>,
  ) {
    const cabecera = await this.cobros.cabecera(cobroId, trx);
    if (!cabecera) throw new NotFoundException(MOTIVO_COBRO_NO_EXISTE);
    exigirAlcanceSobre(usuario, cabecera.sucursalCodigo);
    return cabecera;
  }

  private exigirPeticion(
    usuario: UsuarioConSucursal,
    peticion: PeticionParaResolver | undefined,
  ): asserts peticion is PeticionParaResolver {
    if (!peticion) throw new NotFoundException(MOTIVO_PETICION_NO_EXISTE);
    exigirAlcanceSobre(usuario, peticion.sucursalCodigo);
  }

  private async pendienteBloqueada(
    usuario: UsuarioConSucursal,
    peticionId: string,
    trx: Transaction<DB>,
  ): Promise<PeticionParaResolver> {
    const peticion = await this.repo.bloquear(peticionId, trx);
    this.exigirPeticion(usuario, peticion);
    if (peticion.status !== 'pendiente')
      throw new ConflictException(MOTIVO_PETICION_RESUELTA);
    return peticion;
  }

  private async unaPeticion(id: string): Promise<PeticionEnBandeja> {
    const [peticion] = await this.repo.buscar({ id, sucursalCodigo: null });
    if (!peticion) throw new NotFoundException(MOTIVO_PETICION_NO_EXISTE);
    return peticion;
  }

  /**
   * UNA transaccion. Kysely ya hizo rollback cuando llega el `catch`: aqui solo
   * se traduce a HTTP. Un interbloqueo con un cobro de la tablet (o de otro
   * usuario) sale como 409, nunca como 500 (mismo trato que T-21).
   */
  private async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.repo.enTransaccion(tarea);
    } catch (error) {
      if (error instanceof CobroNoBorrable)
        throw error.razon === 'no-existe'
          ? new NotFoundException(error.message)
          : new ConflictException(error.message);
      if (esConflictoDeConcurrencia(error))
        throw new ConflictException(MOTIVO_INTERBLOQUEO_COBRO);
      throw error;
    }
  }
}
```

Nota: `this.cobros.cabecera(cobroId, trx)` y `this.repo.cabecera(peticionId, trx)` reciben la `trx` como
`Database`: `Transaction<DB>` extiende `Kysely<DB>`.

- [ ] **Paso 5: Los controllers y el módulo**

Crea `apps/backend/src/modules/ventas-cobranza/peticiones.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import type { VistaBorrado } from './cobros-borrado.service';
import {
  BandejaDto,
  DenegarPeticionDto,
  SolicitarEliminarCobroDto,
} from './dto/peticiones.dto';
import type { PeticionEnBandeja } from './peticiones.repository';
import { PeticionesService } from './peticiones.service';

// T-34. La bandeja, la vista previa de una peticion y resolverla piden
// `peticiones.gestionar`; PEDIR el borrado pide `cobranza.editar_eliminar`.
// Si alguien tiene los dos, puede pedir y autorizar (decision de Roberto).
@Controller('peticiones')
export class PeticionesController {
  constructor(private readonly peticiones: PeticionesService) {}

  @Get()
  @RequierePermiso('peticiones.gestionar')
  bandeja(
    @UsuarioActual() usuarioId: string,
    @Query() q: BandejaDto,
  ): Promise<PeticionEnBandeja[]> {
    return this.peticiones.bandeja(usuarioId, q);
  }

  @Get(':id/vista-previa')
  @RequierePermiso('peticiones.gestionar')
  vistaPrevia(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VistaBorrado> {
    return this.peticiones.vistaDePeticion(usuarioId, id);
  }

  @Post('eliminar-cobro')
  @RequierePermiso('cobranza.editar_eliminar')
  solicitar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: SolicitarEliminarCobroDto,
  ): Promise<PeticionEnBandeja> {
    return this.peticiones.solicitarEliminarCobro(usuarioId, dto);
  }

  @Post(':id/autorizar')
  @HttpCode(200)
  @RequierePermiso('peticiones.gestionar')
  autorizar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PeticionEnBandeja> {
    return this.peticiones.autorizar(usuarioId, id);
  }

  @Post(':id/denegar')
  @HttpCode(200)
  @RequierePermiso('peticiones.gestionar')
  denegar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DenegarPeticionDto,
  ): Promise<PeticionEnBandeja> {
    return this.peticiones.denegar(usuarioId, id, dto);
  }
}
```

Crea `apps/backend/src/modules/ventas-cobranza/cobros.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import type { VistaBorrado } from './cobros-borrado.service';
import { PeticionesService } from './peticiones.service';

// T-34: la vista previa de borrar un pago, para quien lo PIDE. Quien autoriza
// usa `GET /peticiones/:id/vista-previa` (otro permiso, mismo calculo).
@Controller('cobros')
export class CobrosController {
  constructor(private readonly peticiones: PeticionesService) {}

  @Get(':id/vista-borrado')
  @RequierePermiso('cobranza.editar_eliminar')
  vistaBorrado(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VistaBorrado> {
    return this.peticiones.vistaDeCobro(usuarioId, id);
  }
}
```

En `ventas-cobranza.module.ts`: importa `PeticionesController`, `CobrosController`, `PeticionesService` y
`PeticionesRepository`; agrega los dos controllers al final de `controllers` y, bajo el comentario
`// T-34: borrar un pago (via peticion)` que dejó la Tarea 3, `PeticionesService` y `PeticionesRepository`.

Run: `npm test --workspace=apps/backend -- peticiones.service`
Expected: PASS (3 + 2 pruebas; el `it.each` cuenta 3).

Run: `npm run build --workspace=apps/backend`
Expected: compila.

- [ ] **Paso 6: Las e2e de punta a punta**

Crea `apps/backend/test/peticiones.e2e-spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { borrarCobrosDe } from './apoyo-cobros';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
} from './../src/modules/sincronizacion/contrato';
import type { VistaBorrado } from './../src/modules/ventas-cobranza/cobros-borrado.service';
import type { PeticionEnBandeja } from './../src/modules/ventas-cobranza/peticiones.repository';
import { MOTIVO_SALDO_FAVOR_APLICADO } from './../src/modules/ventas-cobranza/reglas-borrado-cobro';
import type { VentaDetalle } from './../src/modules/ventas-cobranza/ventas-consulta.service';

/**
 * Peticiones: borrar un pago con autorizacion (T-34), §6 del spec.
 *
 * Fechas de JUNIO DE 2023 exclusivas de este archivo. Los pagos se crean por
 * la puerta real (`POST /cobranzas`, T-21), asi que nacen con su `cobro`.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-pet-gen-${SUFIJO}`;
const LOGIN_OTRO = `e2e-pet-otro-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-pet-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-pet-sin-${SUFIJO}`;
const LOGIN_SOLO_PIDE = `e2e-pet-pide-${SUFIJO}`;
const LOGIN_APP = `e2e-pet-app-${SUFIJO}`;

const F1 = '2023-06-01';
const F2 = '2023-06-02';
const F3 = '2023-06-03';
const PAGO = '2023-06-10';

const mensaje = (res: request.Response) =>
  (res.body as { message: string }).message;

describe('Peticiones: borrar un cobro (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let vendedorApp: string;
  let usuarioGeneralId: string;
  let usuarioOtroId: string;
  let cookieGeneral: string;
  let cookieOtro: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  let cookieSoloPide: string;
  let bearerApp: string;
  let folios = 0;
  let clientes = 0;

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

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ) => {
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

  const sembrarCliente = async (sucursalId: string): Promise<string> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre: `Peticiones ${++clientes} ${SUFIJO}`,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Una venta a credito de oficina, `pendiente`. */
  const sembrarNota = async (clienteId: string, monto: string, fecha: string) => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    return db
      .insertInto('venta_nota')
      .values({
        folio: `ZZP${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha,
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: monto,
        num_nota: null,
        contado_credito: 'credito',
        semana: 22,
        mes: 6,
        status: 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
      })
      .returning(['id', 'folio'])
      .executeTakeFirstOrThrow();
  };

  /** Un pago real del portal (transferencia de Oficina); devuelve el id de su `cobro`. */
  const cobrar = async (
    clienteId: string,
    notaIds: string[],
    montoCentavos: number,
  ): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cobranzas')
      .set('Cookie', cookieGeneral)
      .send({
        clienteId,
        notaIds,
        montoCentavos,
        fechaPago: PAGO,
        metodoPago: 'transferencia',
        vendedorId: null,
      })
      .expect(201);
    return ultimoCobro(clienteId);
  };

  const aplicarSaldo = async (
    clienteId: string,
    notaIds: string[],
    montoCentavos: number,
  ): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cobranzas/saldo-favor')
      .set('Cookie', cookieGeneral)
      .send({ clienteId, notaIds, montoCentavos })
      .expect(201);
    return ultimoCobro(clienteId);
  };

  const ultimoCobro = async (clienteId: string): Promise<string> =>
    (
      await db
        .selectFrom('cobro')
        .select('id')
        .where('cliente_id', '=', clienteId)
        .orderBy('created_at', 'desc')
        .executeTakeFirstOrThrow()
    ).id;

  const pedir = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/peticiones/eliminar-cobro')
      .set('Cookie', cookie)
      .send(cuerpo);

  const autorizar = (cookie: string, id: string) =>
    request(app.getHttpServer())
      .post(`/peticiones/${id}/autorizar`)
      .set('Cookie', cookie);

  const denegar = (cookie: string, id: string, cuerpo: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/peticiones/${id}/denegar`)
      .set('Cookie', cookie)
      .send(cuerpo);

  const bandeja = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get(`/peticiones?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const vistaBorrado = (cookie: string, cobroId: string) =>
    request(app.getHttpServer())
      .get(`/cobros/${cobroId}/vista-borrado`)
      .set('Cookie', cookie);

  /** Pide el borrado y devuelve la peticion creada. */
  const pedirOk = async (cobroId: string, cookie = cookieGeneral) =>
    (await pedir(cookie, { cobroId, motivo: 'Era de credito' }).expect(201))
      .body as PeticionEnBandeja;

  const statusDe = async (id: string) =>
    (
      await db
        .selectFrom('venta_nota')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  /** La suma de los movimientos vivos, texto: `'0'` si no queda ninguno, `'20.00'` si hay. */
  const saldoFavorDe = async (clienteId: string) =>
    (
      await db
        .selectFrom('saldo_favor_movimiento')
        .select(sql<string>`coalesce(sum(monto), 0)::text`.as('total'))
        .where('cliente_id', '=', clienteId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).total;

  const abonosVivos = (notaId: string) =>
    db
      .selectFrom('cobranza_abono')
      .select(['monto', 'cobro_id'])
      .where('venta_nota_id', '=', notaId)
      .where('deleted_at', 'is', null)
      .execute();

  const pull = (query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(
        `/sync/pull?${new URLSearchParams({ contrato: String(CONTRATO_ACTUAL), ...query }).toString()}`,
      )
      .set('Authorization', `Bearer ${bearerApp}`);

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

    usuarioGeneralId = await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    usuarioOtroId = await crearUsuario(LOGIN_OTRO, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    // Solo puede PEDIR: perfil vacio + la excepcion cobranza.editar_eliminar (T-08a).
    const soloPide = await crearUsuario(LOGIN_SOLO_PIDE, 'Auxiliar Administrativo', null);
    const { id: permisoPedir } = await db
      .selectFrom('permiso')
      .select('id')
      .where('clave', '=', 'cobranza.editar_eliminar')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('usuario_permiso')
      .values({ usuario_id: soloPide, permiso_id: permisoPedir, habilitado: true })
      .execute();

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieOtro = await iniciarSesion(LOGIN_OTRO);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
    cookieSoloPide = await iniciarSesion(LOGIN_SOLO_PIDE);

    // El de la tablet de TJ: para comprobar lo que baja en el pull.
    const { id } = await db
      .insertInto('vendedor')
      .values({
        login: LOGIN_APP,
        nombre: `Vendedor peticiones ${SUFIJO}`,
        password_hash: await app.get(PasswordService).hashear(PASSWORD),
        sucursal_id: tjId,
        activo: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    vendedorApp = id;
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
    if (clienteIds.length > 0) {
      const notas = db
        .selectFrom('venta_nota')
        .select('id')
        .where('cliente_id', 'in', clienteIds);
      await db.deleteFrom('cobranza_abono').where('venta_nota_id', 'in', notas).execute();
      await db
        .deleteFrom('saldo_favor_movimiento')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await borrarCobrosDe(db, clienteIds);
      await db.deleteFrom('venta_nota').where('cliente_id', 'in', clienteIds).execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db.deleteFrom('sesion_vendedor').where('vendedor_id', '=', vendedorApp).execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorApp).execute();
    await db.deleteFrom('usuario_permiso').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  /* ================================================================ */

  describe('pedir el borrado', () => {
    it('crea la peticion pendiente con el pago, sus folios, quien pidio y el motivo recortado', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const cobroId = await cobrar(cli, [n1.id, n2.id], 20000);

      const p = (
        await pedir(cookieGeneral, { cobroId, motivo: '  Era de credito  ' }).expect(201)
      ).body as PeticionEnBandeja;

      expect(p).toMatchObject({
        tipo: 'eliminar_cobro',
        status: 'pendiente',
        sucursalCodigo: 'TJ',
        motivo: 'Era de credito',
        solicito: LOGIN_GENERAL,
        resolvio: null,
        resueltaEn: null,
        comentario: null,
        cobro: {
          id: cobroId,
          clienteId: cli,
          montoCentavos: 20000,
          metodoPago: 'transferencia',
          origen: 'cobro',
          fechaPago: PAGO,
          cobrador: null,
          folios: [n1.folio, n2.folio],
        },
      });
      expect(p.creadaEn).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      // Pedir no cambia nada: el pago sigue vivo.
      expect(await statusDe(n1.id)).toBe('pagada');
    });

    it('motivo vacio o de mas de 500 caracteres es 400', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);

      expect(mensaje(await pedir(cookieGeneral, { cobroId, motivo: '   ' }).expect(400))).toBe(
        'Escribe el motivo de la petición.',
      );
      expect(mensaje(await pedir(cookieGeneral, { cobroId }).expect(400))).toEqual(
        expect.arrayContaining(['Escribe el motivo de la petición.']),
      );
      expect(
        mensaje(await pedir(cookieGeneral, { cobroId, motivo: 'x'.repeat(501) }).expect(400)),
      ).toBe('El motivo no puede pasar de 500 caracteres.');
    });

    it('un pago que no existe es 404 y un id mal formado es 400', async () => {
      expect(
        mensaje(
          await pedir(cookieGeneral, {
            cobroId: '00000000-0000-4000-8000-000000000000',
            motivo: 'x',
          }).expect(404),
        ),
      ).toBe('No existe ese cobro.');
      await pedir(cookieGeneral, { cobroId: 'no-es-uuid', motivo: 'x' }).expect(400);
    });

    it('Review Focus 5: una segunda peticion pendiente sobre el mismo pago es 409', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      await pedirOk(cobroId);

      expect(
        mensaje(await pedir(cookieOtro, { cobroId, motivo: 'Otra vez' }).expect(409)),
      ).toBe('Este cobro ya tiene una petición de borrado pendiente.');
    });

    it('Review Focus 5: un pago ya borrado es 409', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);
      await autorizar(cookieGeneral, p.id).expect(200);

      expect(mensaje(await pedir(cookieGeneral, { cobroId, motivo: 'x' }).expect(409))).toBe(
        'Este cobro ya se borró.',
      );
    });
  });

  describe('permisos y alcance', () => {
    it('sin permisos todo es 403', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      await bandeja(cookieSinPermiso, { status: 'pendiente' }).expect(403);
      await pedir(cookieSinPermiso, { cobroId, motivo: 'x' }).expect(403);
      await vistaBorrado(cookieSinPermiso, cobroId).expect(403);
      await autorizar(cookieSinPermiso, p.id).expect(403);
      await denegar(cookieSinPermiso, p.id).expect(403);
    });

    it('con solo cobranza.editar_eliminar se pide y se ve la vista previa, pero no se ve la bandeja ni se autoriza', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);

      await vistaBorrado(cookieSoloPide, cobroId).expect(200);
      const p = await pedirOk(cobroId, cookieSoloPide);
      await bandeja(cookieSoloPide, { status: 'pendiente' }).expect(403);
      await autorizar(cookieSoloPide, p.id).expect(403);
      await request(app.getHttpServer())
        .get(`/peticiones/${p.id}/vista-previa`)
        .set('Cookie', cookieSoloPide)
        .expect(403);
    });

    it('Review Focus 4: un usuario de TJ no ve, no pide ni resuelve nada de MX, aunque este borrado o resuelto', async () => {
      const cli = await sembrarCliente(mxId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const pendiente = await pedirOk(cobroId);

      await vistaBorrado(cookieTijuana, cobroId).expect(403);
      await pedir(cookieTijuana, { cobroId, motivo: 'x' }).expect(403);
      await autorizar(cookieTijuana, pendiente.id).expect(403);
      await denegar(cookieTijuana, pendiente.id).expect(403);
      await bandeja(cookieTijuana, { status: 'pendiente', sucursal: 'MX' }).expect(403);
      const suya = (await bandeja(cookieTijuana, { status: 'pendiente' }).expect(200))
        .body as PeticionEnBandeja[];
      expect(suya.find((x) => x.id === pendiente.id)).toBeUndefined();

      // Ya resuelta y con el pago borrado: sigue siendo 403, no 409.
      await autorizar(cookieGeneral, pendiente.id).expect(200);
      await autorizar(cookieTijuana, pendiente.id).expect(403);
      await vistaBorrado(cookieTijuana, cobroId).expect(403);
    });
  });

  describe('autorizar', () => {
    it('borra el pago completo: filas, status recalculados, saldo a favor y quien lo borro', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      // 200 = 100 (n1) + 80 (n2) + 20 a saldo a favor.
      const cobroId = await cobrar(cli, [n1.id, n2.id], 20000);
      expect(await saldoFavorDe(cli)).toBe('20.00');
      const p = await pedirOk(cobroId);

      const resuelta = (await autorizar(cookieOtro, p.id).expect(200)).body as PeticionEnBandeja;

      expect(resuelta).toMatchObject({ status: 'autorizada', resolvio: LOGIN_OTRO, comentario: null });
      expect(resuelta.resueltaEn).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(await abonosVivos(n1.id)).toEqual([]);
      expect(await abonosVivos(n2.id)).toEqual([]);
      expect(await statusDe(n1.id)).toBe('pendiente');
      expect(await statusDe(n2.id)).toBe('pendiente');
      expect(await saldoFavorDe(cli)).toBe('0');
      const pago = await db
        .selectFrom('cobro')
        .select(['deleted_at', 'eliminado_por_usuario_id'])
        .where('id', '=', cobroId)
        .executeTakeFirstOrThrow();
      expect(pago.deleted_at).not.toBeNull();
      expect(pago.eliminado_por_usuario_id).toBe(usuarioOtroId);
    });

    it('la misma persona que pidio puede autorizar', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId, cookieGeneral);
      await autorizar(cookieGeneral, p.id).expect(200);
      expect(await statusDe(n1.id)).toBe('pendiente');
    });

    it('Review Focus 3: con otro pago vivo la nota queda abonada; una en cuenta perdida no cambia', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const primero = await cobrar(cli, [n1.id], 3000); // n1 abonada con $30
      await cobrar(cli, [n1.id], 2000); // y otro pago vivo de $20
      const deN2 = await cobrar(cli, [n2.id], 1000);
      await db
        .updateTable('venta_nota')
        .set({ status: 'cuenta_perdida' })
        .where('id', '=', n2.id)
        .execute();

      await autorizar(cookieGeneral, (await pedirOk(primero)).id).expect(200);
      expect(await statusDe(n1.id)).toBe('abonado');
      expect((await abonosVivos(n1.id)).map((a) => a.monto)).toEqual(['20.00']);

      await autorizar(cookieGeneral, (await pedirOk(deN2)).id).expect(200);
      expect(await statusDe(n2.id)).toBe('cuenta_perdida');
      expect(await abonosVivos(n2.id)).toEqual([]);
    });

    it('Review Focus 1: si el saldo a favor que dejo el pago ya se aplico, 409 y nada cambia; borrando antes la aplicacion, si se puede', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      // Sin otras notas abiertas, lo que sobra va a saldo a favor: 100 a n1 y 50 a favor.
      const conExcedente = await cobrar(cli, [n1.id], 15000);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const aplicacion = await aplicarSaldo(cli, [n2.id], 5000); // usa los 50
      expect(await saldoFavorDe(cli)).toBe('0.00');

      const p = await pedirOk(conExcedente);
      const vista = (await vistaBorrado(cookieGeneral, conExcedente).expect(200)).body as VistaBorrado;
      expect(vista.bloqueo).toEqual({ codigo: 'saldo-favor-aplicado', motivo: MOTIVO_SALDO_FAVOR_APLICADO });

      expect(mensaje(await autorizar(cookieGeneral, p.id).expect(409))).toBe(MOTIVO_SALDO_FAVOR_APLICADO);
      expect(await statusDe(n1.id)).toBe('pagada');
      expect((await bandeja(cookieGeneral, { status: 'pendiente' }).expect(200)).body).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: p.id, status: 'pendiente' })]),
      );

      // Primero la aplicacion (devuelve el saldo), luego el pago con excedente.
      await autorizar(cookieGeneral, (await pedirOk(aplicacion)).id).expect(200);
      expect(await saldoFavorDe(cli)).toBe('50.00');
      expect(await statusDe(n2.id)).toBe('pendiente');
      await autorizar(cookieGeneral, p.id).expect(200);
      expect(await saldoFavorDe(cli)).toBe('0'); // ya no queda ningun movimiento vivo
      expect(await statusDe(n1.id)).toBe('pendiente');
    });

    it('Review Focus 2: dos autorizaciones a la vez — una gana, la otra ve la peticion resuelta', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      const [a, b] = await Promise.all([autorizar(cookieGeneral, p.id), autorizar(cookieOtro, p.id)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(mensaje(a.status === 409 ? a : b)).toBe('Esta petición ya fue resuelta.');
      const pagos = await db
        .selectFrom('cobro')
        .select('deleted_at')
        .where('id', '=', cobroId)
        .execute();
      expect(pagos).toHaveLength(1);
    });

    it('Review Focus 2: autorizar y denegar a la vez — solo una resolucion queda', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      const [a, d] = await Promise.all([autorizar(cookieGeneral, p.id), denegar(cookieOtro, p.id)]);
      expect([a.status, d.status].sort()).toEqual([200, 409]);
      const final = await db
        .selectFrom('peticion')
        .select('status')
        .where('id', '=', p.id)
        .executeTakeFirstOrThrow();
      const borrado = await db
        .selectFrom('cobro')
        .select('deleted_at')
        .where('id', '=', cobroId)
        .executeTakeFirstOrThrow();
      expect(final.status === 'autorizada').toBe(borrado.deleted_at !== null);
    });

    it('tras borrar el pago la venta se vuelve a poder editar', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const antes = (
        await request(app.getHttpServer()).get(`/ventas/${n1.id}`).set('Cookie', cookieGeneral).expect(200)
      ).body as VentaDetalle;
      expect(antes.editable).toBe(false);

      await autorizar(cookieGeneral, (await pedirOk(cobroId)).id).expect(200);

      const despues = (
        await request(app.getHttpServer()).get(`/ventas/${n1.id}`).set('Cookie', cookieGeneral).expect(200)
      ).body as VentaDetalle;
      expect(despues.editable).toBe(true);
      expect(despues.cobros).toEqual([]);
    });

    it('la tablet: el pull incremental baja la nota otra vez pendiente, sin el abono borrado, y el saldo a favor nuevo', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const cobroId = await cobrar(cli, [n1.id, n2.id], 20000);
      const p = await pedirOk(cobroId);
      const corte = ((await pull().expect(200)).body as RespuestaPull).servidor_en;

      await autorizar(cookieGeneral, p.id).expect(200);

      const cuerpo = (await pull({ desde: corte }).expect(200)).body as RespuestaPull;
      expect(cuerpo.notas_pendientes.find((n) => n.id === n1.id)).toMatchObject({
        activo: 1,
        status: 'pendiente',
        saldo_centavos: 10000,
        abonos: [],
      });
      expect(cuerpo.notas_pendientes.find((n) => n.id === n2.id)).toMatchObject({
        activo: 1,
        saldo_centavos: 8000,
      });
      expect(cuerpo.catalogos.clientes.find((c) => c.id === cli)?.saldo_favor_centavos).toBe(0);
    });
  });

  describe('denegar', () => {
    it('con comentario: el pago no cambia y se puede volver a pedir', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 5000);
      const p = await pedirOk(cobroId);

      const r = (await denegar(cookieOtro, p.id, { comentario: '  No procede  ' }).expect(200))
        .body as PeticionEnBandeja;
      expect(r).toMatchObject({ status: 'denegada', resolvio: LOGIN_OTRO, comentario: 'No procede' });
      expect(await statusDe(n1.id)).toBe('abonado');
      await pedirOk(cobroId);
    });

    it('sin comentario queda null; con mas de 500 es 400; resuelta ya no se deniega', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const p = await pedirOk(await cobrar(cli, [n1.id], 5000));

      expect(
        mensaje(await denegar(cookieGeneral, p.id, { comentario: 'x'.repeat(501) }).expect(400)),
      ).toBe('El comentario no puede pasar de 500 caracteres.');
      const r = (await denegar(cookieGeneral, p.id).expect(200)).body as PeticionEnBandeja;
      expect(r.comentario).toBeNull();
      expect(mensaje(await denegar(cookieGeneral, p.id).expect(409))).toBe(
        'Esta petición ya fue resuelta.',
      );
    });

    it('una peticion que no existe es 404', async () => {
      expect(
        mensaje(await denegar(cookieGeneral, '00000000-0000-4000-8000-000000000000').expect(404)),
      ).toBe('No existe esa petición.');
    });
  });

  describe('bandeja y vista previa', () => {
    it('pendientes (de la mas vieja) e historial (de la mas reciente), con filtro por sucursal', async () => {
      const cliTj = await sembrarCliente(tjId);
      const cliMx = await sembrarCliente(mxId);
      const nTj = await sembrarNota(cliTj, '100.00', F1);
      const nMx = await sembrarNota(cliMx, '100.00', F1);
      const pTj = await pedirOk(await cobrar(cliTj, [nTj.id], 1000));
      const pMx = await pedirOk(await cobrar(cliMx, [nMx.id], 1000));

      const todas = (await bandeja(cookieGeneral, { status: 'pendiente' }).expect(200))
        .body as PeticionEnBandeja[];
      const ids = todas.map((x) => x.id);
      expect(ids.indexOf(pTj.id)).toBeLessThan(ids.indexOf(pMx.id));

      const soloMx = (await bandeja(cookieGeneral, { status: 'pendiente', sucursal: 'MX' }).expect(200))
        .body as PeticionEnBandeja[];
      expect(soloMx.every((x) => x.sucursalCodigo === 'MX')).toBe(true);
      expect(soloMx.map((x) => x.id)).toContain(pMx.id);

      await denegar(cookieGeneral, pTj.id, { comentario: 'No' }).expect(200);
      await autorizar(cookieGeneral, pMx.id).expect(200);
      const historial = (await bandeja(cookieGeneral, { status: 'historial' }).expect(200))
        .body as PeticionEnBandeja[];
      const hIds = historial.map((x) => x.id);
      expect(hIds.indexOf(pMx.id)).toBeLessThan(hIds.indexOf(pTj.id));
      expect(historial.find((x) => x.id === pTj.id)).toMatchObject({ status: 'denegada', comentario: 'No' });
      expect(historial.find((x) => x.id === pMx.id)?.cobro.folios).toEqual([nMx.folio]);
    });

    it('un status que no es pendiente ni historial es 400', async () => {
      expect(mensaje(await bandeja(cookieGeneral, { status: 'todas' }).expect(400))).toEqual(
        expect.arrayContaining(['Elige pendientes o historial.']),
      );
    });

    it('la vista previa de la peticion es la misma que la del cobro, recalculada', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const n2 = await sembrarNota(cli, '80.00', F2);
      const cobroId = await cobrar(cli, [n1.id, n2.id], 12000);
      const p = await pedirOk(cobroId);

      const porCobro = (await vistaBorrado(cookieGeneral, cobroId).expect(200)).body as VistaBorrado;
      const porPeticion = (
        await request(app.getHttpServer())
          .get(`/peticiones/${p.id}/vista-previa`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VistaBorrado;
      expect(porPeticion).toEqual(porCobro);
      expect(porCobro).toMatchObject({
        cobro: { id: cobroId, montoCentavos: 12000, metodoPago: 'transferencia', cobrador: null },
        notas: [
          { notaId: n1.id, delPagoCentavos: 10000, saldoAntesCentavos: 0, saldoDespuesCentavos: 10000, statusDespues: 'pendiente' },
          { notaId: n2.id, delPagoCentavos: 2000, saldoAntesCentavos: 6000, saldoDespuesCentavos: 8000, statusDespues: 'pendiente' },
        ],
        saldoFavorAntesCentavos: 0,
        saldoFavorDespuesCentavos: 0,
        movimientoSaldoFavorCentavos: 0,
        bloqueo: null,
      });
    });
  });
});
```

Run: `npm run test:e2e --workspace=apps/backend -- peticiones`
Expected: FAIL antes del Paso 5 (404 en las rutas); tras el Paso 5, PASS.

- [ ] **Paso 7: Todo el backend**

Run: `npm run lint --workspace=apps/backend && npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend`
Expected: todo PASS.

- [ ] **Paso 8: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/peticiones.repository.ts \
  apps/backend/src/modules/ventas-cobranza/peticiones.service.ts \
  apps/backend/src/modules/ventas-cobranza/peticiones.service.spec.ts \
  apps/backend/src/modules/ventas-cobranza/peticiones.controller.ts \
  apps/backend/src/modules/ventas-cobranza/cobros.controller.ts \
  apps/backend/src/modules/ventas-cobranza/dto/peticiones.dto.ts \
  apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts \
  apps/backend/test/peticiones.e2e-spec.ts
git commit -m "T-34: endpoints de peticiones — pedir, bandeja, vista previa, autorizar y denegar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Tarea 5: Los lectores dicen a qué pago pertenece cada cobro y si ya se pidió borrarlo

El detalle de venta (`GET /ventas/:id`, `CobroDeVenta`) y la Cobranza del portal (`GET /cobranzas/por-cobrar`,
`AbonoAnterior`) ganan `cobroId` (`null` en el cobro de contado) y `peticionPendiente`. Con eso la pantalla
pinta "Pedir borrado" o "Borrado pedido · pendiente" sin pedir nada más. Los dos ya filtran
`deleted_at is null`: un pago borrado desaparece solo. Las comparaciones existentes de esos objetos usan
`toMatchObject`/`objectContaining`, así que agregar campos no las rompe. **Modelo:** `haiku` para implementar,
`sonnet` para revisar.

**Archivos:**
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts` (`CobroDeVenta`, `cobros`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/cobranzas-portal.repository.ts` (`AbonoAnterior`, `notasPorCobrar`)
- Modificar: `apps/backend/test/peticiones.e2e-spec.ts`

**Interfaces:**
- Consume: tablas `cobro`, `peticion` (Tarea 1); endpoints de la Tarea 4 (en la e2e).
- Produce:
  ```ts
  // CobroDeVenta y AbonoAnterior ganan:
  /** El pago al que pertenece; `null` = cobro automatico de contado (no se pide su borrado). */
  cobroId: string | null;
  /** Ya hay una peticion pendiente de borrar ese pago. */
  peticionPendiente: boolean;
  ```

- [ ] **Paso 1: La e2e que falla**

En `apps/backend/test/peticiones.e2e-spec.ts`, agrega al final del `describe` principal (antes de su `});`):

```ts
  describe('los lectores del portal (T-34)', () => {
    it('detalle de venta y Cobranza dicen a que pago pertenece cada cobro y si ya se pidio borrarlo', async () => {
      const cli = await sembrarCliente(tjId);
      const n1 = await sembrarNota(cli, '100.00', F1);
      const cobroId = await cobrar(cli, [n1.id], 3000);

      const detalle = async () =>
        (
          await request(app.getHttpServer())
            .get(`/ventas/${n1.id}`)
            .set('Cookie', cookieGeneral)
            .expect(200)
        ).body as VentaDetalle;
      const porCobrar = async () =>
        (
          (
            await request(app.getHttpServer())
              .get(`/cobranzas/por-cobrar?clienteId=${cli}`)
              .set('Cookie', cookieGeneral)
              .expect(200)
          ).body as { notas: { id: string; abonos: { cobroId: string | null; peticionPendiente: boolean }[] }[] }
        ).notas.find((n) => n.id === n1.id);

      expect((await detalle()).cobros).toEqual([
        expect.objectContaining({ cobroId, peticionPendiente: false }),
      ]);
      expect((await porCobrar())?.abonos).toEqual([
        expect.objectContaining({ cobroId, peticionPendiente: false }),
      ]);

      const p = await pedirOk(cobroId);
      expect((await detalle()).cobros).toEqual([
        expect.objectContaining({ cobroId, peticionPendiente: true }),
      ]);
      expect((await porCobrar())?.abonos).toEqual([
        expect.objectContaining({ cobroId, peticionPendiente: true }),
      ]);

      // Denegada ya no esta pendiente; autorizada, el cobro desaparece.
      await denegar(cookieGeneral, p.id).expect(200);
      expect((await detalle()).cobros[0]).toMatchObject({ peticionPendiente: false });
      await autorizar(cookieGeneral, (await pedirOk(cobroId)).id).expect(200);
      expect((await detalle()).cobros).toEqual([]);
    });

    it('el cobro de una venta de contado no tiene pago: cobroId null', async () => {
      const cli = await sembrarCliente(tjId);
      const n = await sembrarNota(cli, '50.00', F3);
      await db
        .updateTable('venta_nota')
        .set({ contado_credito: 'contado', status: 'pagada' })
        .where('id', '=', n.id)
        .execute();
      await db
        .insertInto('cobranza_abono')
        .values({
          venta_nota_id: n.id,
          vendedor_id: null,
          fecha_pago: F3,
          fecha_operacion: F3,
          monto: '50.00',
          tipo: 'cobranza',
          saldo_pendiente: '0.00',
          metodo_pago: 'transferencia',
          origen: 'venta_contado',
        })
        .execute();

      const venta = (
        await request(app.getHttpServer())
          .get(`/ventas/${n.id}`)
          .set('Cookie', cookieGeneral)
          .expect(200)
      ).body as VentaDetalle;
      expect(venta.cobros).toEqual([
        expect.objectContaining({ origen: 'venta_contado', cobroId: null, peticionPendiente: false }),
      ]);
    });
  });
```

Run: `npm run test:e2e --workspace=apps/backend -- peticiones`
Expected: FAIL en las dos pruebas nuevas (`cobroId` y `peticionPendiente` no vienen).

- [ ] **Paso 2: El detalle de venta**

En `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts`, `CobroDeVenta` queda:

```ts
export interface CobroDeVenta {
  id: string;
  fechaPago: string;
  metodoPago: string;
  montoCentavos: number;
  origen: 'cobro' | 'venta_contado' | 'saldo_favor';
  /** El pago al que pertenece (T-34); `null` = cobro automatico de contado. */
  cobroId: string | null;
  /** Ya hay una peticion pendiente de borrar ese pago (T-34). */
  peticionPendiente: boolean;
}
```

y `cobros` queda:

```ts
  /** Abonos vivos (el cobro de contado y los de cobranza), por fecha de pago. */
  async cobros(id: string): Promise<CobroDeVenta[]> {
    const filas = await sql<{
      id: string;
      fecha_pago: string;
      metodo_pago: string;
      monto: string;
      origen: string;
      cobro_id: string | null;
      peticion_pendiente: boolean;
    }>`
      select ca.id, to_char(ca.fecha_pago, 'YYYY-MM-DD') as fecha_pago,
             ca.metodo_pago, ca.monto, ca.origen, ca.cobro_id,
             exists (select 1 from peticion p
                      where p.cobro_id = ca.cobro_id
                        and p.status = 'pendiente') as peticion_pendiente
        from cobranza_abono ca
       where ca.venta_nota_id = ${id}
         and ca.deleted_at is null
       order by ca.fecha_pago, ca.created_at
    `.execute(this.db);
    return filas.rows.map((f) => ({
      id: f.id,
      fechaPago: f.fecha_pago,
      metodoPago: f.metodo_pago,
      montoCentavos: aCentavos(f.monto),
      origen: f.origen as CobroDeVenta['origen'],
      cobroId: f.cobro_id,
      peticionPendiente: f.peticion_pendiente,
    }));
  }
```

- [ ] **Paso 3: La Cobranza del portal**

En `apps/backend/src/modules/ventas-cobranza/cobranzas-portal.repository.ts`:

- `AbonoAnterior` gana, después de `origen: OrigenAbono;`:

```ts
  /** El pago al que pertenece (T-34); `null` = cobro automatico de contado. */
  cobroId: string | null;
  /** Ya hay una peticion pendiente de borrar ese pago (T-34). */
  peticionPendiente: boolean;
```

- en el tipo de `abonos` de la consulta de `notasPorCobrar`, agrega `cobro_id: string | null;` y
  `peticion_pendiente: boolean;`;
- en el `json_build_object(...)`, después de `'origen', ca.origen`, agrega:

```sql
                     'origen', ca.origen,
                     'cobro_id', ca.cobro_id,
                     'peticion_pendiente', exists (select 1 from peticion p
                                                    where p.cobro_id = ca.cobro_id
                                                      and p.status = 'pendiente')
```

  (quita la coma que deja colgando la línea anterior si hace falta);
- en el `map` de `abonos`, después de `origen: a.origen as OrigenAbono,`, agrega
  `cobroId: a.cobro_id,` y `peticionPendiente: a.peticion_pendiente,`.

- [ ] **Paso 4: Correr**

Run: `npm run test:e2e --workspace=apps/backend -- peticiones cobranzas-portal ventas-editar`
Expected: PASS.

Run: `npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend`
Expected: sin errores.

- [ ] **Paso 5: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts \
  apps/backend/src/modules/ventas-cobranza/cobranzas-portal.repository.ts \
  apps/backend/test/peticiones.e2e-spec.ts
git commit -m "T-34: detalle de venta y Cobranza dicen el pago de cada cobro y si tiene peticion pendiente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Tarea 6: Portal — pedir el borrado desde el detalle de venta y desde Cobranza

El botón **"Pedir borrado"** en cada cobro que es un pago (`cobroId` no nulo), con un panel debajo de la
tabla (el portal no tiene componente de diálogo: desviación 5) que muestra la vista previa del servidor, pide
el **Motivo** y envía. Un pago con petición pendiente dice **"Borrado pedido · pendiente"**. Un 409 (ya se
pidió, ya se borró) recarga la pantalla con el mensaje del servidor (Review Focus 5). **Modelo:** `sonnet`
para implementar y revisar.

**Archivos:**
- Crear: `apps/portal/src/lib/peticiones.ts`, `apps/portal/src/lib/peticiones.test.ts`
- Modificar: `apps/portal/src/lib/ventas.ts` (`CobroDeVenta`), `apps/portal/src/lib/cobranzas.ts` (`AbonoAnterior`)
- Crear: `apps/portal/src/components/peticiones/vista-borrado.tsx`
- Crear: `apps/portal/src/components/peticiones/pedir-borrado-cobro.tsx`, `pedir-borrado-cobro.test.tsx`
- Modificar: `apps/portal/src/components/ventas/detalle-venta.tsx`, `detalle-venta.test.tsx`
- Modificar: `apps/portal/src/components/cobranza/cobranza-cliente.tsx`, `cobranza-cliente.test.tsx`
- Modificar (fixtures con los campos nuevos): `apps/portal/src/components/ventas/formulario-editar-venta.test.tsx`,
  `apps/portal/src/lib/ventas.test.ts`

**Interfaces:**
- Consume: los endpoints de la Tarea 4 y los campos `cobroId`/`peticionPendiente` de la Tarea 5;
  `apiFetch`, `ErrorApi`, `mensajeDe` (`lib/api.ts`); `formatearPesos`, `ETIQUETA_STATUS`, `obtenerVenta`
  (`lib/ventas.ts`); `ETIQUETA_METODO_PAGO` (`lib/cobranzas.ts`); `useEnvioFormulario`
  (`components/catalogo/use-envio-formulario.ts`); `useAuth().puede`.
- Produce (`lib/peticiones.ts`, usados también por la Tarea 7):
  ```ts
  export type StatusPeticion = "pendiente" | "autorizada" | "denegada";
  export interface NotaTrasBorrar { notaId; folio; numNota: string | null; fecha; delPagoCentavos; saldoAntesCentavos; saldoDespuesCentavos; statusDespues: "pendiente" | "abonado" | "pagada" | "cuenta_perdida" }
  export interface BloqueoBorrado { codigo: "saldo-favor-aplicado"; motivo: string }
  export interface CobroEnVista { id; clienteId; cliente; sucursalCodigo; origen: "cobro" | "saldo_favor"; metodoPago; montoCentavos; fechaPago; fechaOperacion; cobrador: string | null }
  export interface VistaBorrado { cobro: CobroEnVista; notas: NotaTrasBorrar[]; saldoFavorAntesCentavos; saldoFavorDespuesCentavos; movimientoSaldoFavorCentavos; bloqueo: BloqueoBorrado | null }
  export interface CobroDePeticion { id; clienteId; cliente; montoCentavos; metodoPago; origen: "cobro" | "saldo_favor"; fechaPago; cobrador: string | null; folios: string[] }
  export interface PeticionEnBandeja { id; tipo: "eliminar_cobro"; status: StatusPeticion; sucursalCodigo; motivo; solicito; creadaEn; resolvio: string | null; resueltaEn: string | null; comentario: string | null; cobro: CobroDePeticion }
  export const ETIQUETA_STATUS_PETICION: Record<StatusPeticion, string>;
  export const ETIQUETA_BORRADO_PEDIDO = "Borrado pedido · pendiente";
  export const LARGO_MAX_TEXTO = 500;
  export function vistaBorradoDeCobro(cobroId: string): Promise<VistaBorrado>;
  export function vistaPreviaDePeticion(id: string): Promise<VistaBorrado>;
  export function pedirBorrarCobro(cobroId: string, motivo: string): Promise<PeticionEnBandeja>;
  export function listarPeticiones(status: "pendiente" | "historial", sucursal: string | null): Promise<PeticionEnBandeja[]>;
  export function autorizarPeticion(id: string): Promise<PeticionEnBandeja>;
  export function denegarPeticion(id: string, comentario: string): Promise<PeticionEnBandeja>;
  export function describirPago(c: { cliente; montoCentavos; metodoPago; origen; fechaPago; cobrador }): string;
  export function textoPeticionEnviada(p: PeticionEnBandeja): string;
  export function textoAutorizada(p: PeticionEnBandeja): string;
  export function textoDenegada(p: PeticionEnBandeja): string;
  ```
  - `components/peticiones/vista-borrado.tsx`: `export function VistaBorradoPago({ vista }: { vista: VistaBorrado })`.
  - `components/peticiones/pedir-borrado-cobro.tsx`:
    `export function PedirBorradoCobro({ cobroId, onEnviada, onDesactualizado, onCancelar }: { cobroId: string; onEnviada: (mensaje: string) => void; onDesactualizado: (mensaje: string) => void; onCancelar: () => void })`.

- [ ] **Paso 1: Las formas compartidas ganan los campos de la Tarea 5**

`apps/portal/src/lib/ventas.ts`, `CobroDeVenta` gana después de `origen: …;`:

```ts
  /** El pago al que pertenece (T-34); `null` = cobro automático de contado. */
  cobroId: string | null;
  /** Ya hay una petición pendiente de borrar ese pago (T-34). */
  peticionPendiente: boolean;
```

`apps/portal/src/lib/cobranzas.ts`, `AbonoAnterior` gana los mismos dos campos (mismos comentarios) después de
`origen: OrigenAbono;`.

Agrega `cobroId` y `peticionPendiente` a los objetos de cobro/abono de las pruebas que los construyen, para que
el `tsc` de `next build` no se queje:
- `components/ventas/detalle-venta.test.tsx`: en `VENTA.cobros` → `cobroId: "co1", peticionPendiente: false`;
  en el cobro `a2` de la prueba de saldo a favor → `cobroId: "co2", peticionPendiente: false`;
- `components/ventas/formulario-editar-venta.test.tsx` y `lib/ventas.test.ts`: el cobro `venta_contado` →
  `cobroId: null, peticionPendiente: false`;
- `components/cobranza/cobranza-cliente.test.tsx`: el abono de `N2` → `cobroId: "co2", peticionPendiente: false`.

- [ ] **Paso 2: Prueba de `lib/peticiones` que falla**

Crea `apps/portal/src/lib/peticiones.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  autorizarPeticion,
  denegarPeticion,
  describirPago,
  listarPeticiones,
  pedirBorrarCobro,
  textoAutorizada,
  textoDenegada,
  textoPeticionEnviada,
  vistaBorradoDeCobro,
  vistaPreviaDePeticion,
  type PeticionEnBandeja,
} from "./peticiones";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const PETICION: PeticionEnBandeja = {
  id: "p1",
  tipo: "eliminar_cobro",
  status: "pendiente",
  sucursalCodigo: "TJ",
  motivo: "Era de crédito",
  solicito: "Ana",
  creadaEn: "2026-10-13 09:15",
  resolvio: null,
  resueltaEn: null,
  comentario: null,
  cobro: {
    id: "co1",
    clienteId: "c1",
    cliente: "Tacos Erick",
    montoCentavos: 100000,
    metodoPago: "efectivo",
    origen: "cobro",
    fechaPago: "2026-10-10",
    cobrador: "Juan Pérez",
    folios: ["TJ261001AP01"],
  },
};

describe("lib/peticiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("las vistas previas piden por cobro y por petición", async () => {
    await vistaBorradoDeCobro("co1");
    expect(apiFetch).toHaveBeenLastCalledWith("/cobros/co1/vista-borrado");
    await vistaPreviaDePeticion("p1");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/vista-previa");
  });

  it("pedir, autorizar y denegar hacen POST", async () => {
    await pedirBorrarCobro("co1", "Era de crédito");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/eliminar-cobro", {
      method: "POST",
      body: JSON.stringify({ cobroId: "co1", motivo: "Era de crédito" }),
    });
    await autorizarPeticion("p1");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/autorizar", { method: "POST" });
    await denegarPeticion("p1", "  No procede ");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/denegar", {
      method: "POST",
      body: JSON.stringify({ comentario: "No procede" }),
    });
    await denegarPeticion("p1", "   ");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/denegar", {
      method: "POST",
      body: JSON.stringify({}),
    });
  });

  it("la bandeja manda el status y la sucursal si hay", async () => {
    await listarPeticiones("pendiente", "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones?status=pendiente&sucursal=TJ");
    await listarPeticiones("historial", null);
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones?status=historial");
  });

  it("describe el pago: con cobrador, de Oficina o saldo a favor", () => {
    expect(describirPago(PETICION.cobro)).toBe(
      "Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez",
    );
    expect(describirPago({ ...PETICION.cobro, cobrador: null, metodoPago: "transferencia" })).toBe(
      "Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Transferencia · Oficina",
    );
    expect(
      describirPago({ ...PETICION.cobro, origen: "saldo_favor", metodoPago: "saldo_favor", cobrador: null }),
    ).toBe("Saldo a favor aplicado de $1,000.00 · Tacos Erick · 2026-10-10");
  });

  it("los avisos de enviada, autorizada y denegada", () => {
    expect(textoPeticionEnviada(PETICION)).toBe("Petición enviada: borrar el pago de $1,000.00 de Tacos Erick.");
    expect(textoAutorizada(PETICION)).toBe("Petición autorizada: se borró el pago de $1,000.00 de Tacos Erick.");
    expect(textoDenegada(PETICION)).toBe("Petición denegada: el pago de Tacos Erick no cambia.");
  });
});
```

Run: `npm test --workspace=apps/portal -- peticiones`
Expected: FAIL — `Failed to resolve import "./peticiones"`.

- [ ] **Paso 3: `lib/peticiones.ts`**

Crea `apps/portal/src/lib/peticiones.ts`:

```ts
import { apiFetch } from "./api";
import { ETIQUETA_METODO_PAGO } from "./cobranzas";
import { formatearPesos } from "./ventas";

// Copia normativa de las formas de apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.ts
// (`NotaTrasBorrar`, `BloqueoBorrado`), cobros-borrado.service.ts (`CobroEnVista`, `VistaBorrado`) y
// peticiones.repository.ts (`CobroDePeticion`, `PeticionEnBandeja`). Mismo trato que lib/cobranzas.ts:
// un cambio de forma en un lado exige el equivalente en el otro.

export type StatusPeticion = "pendiente" | "autorizada" | "denegada";

/** Cómo quedaría una nota del pago si se borra. */
export interface NotaTrasBorrar {
  notaId: string;
  folio: string;
  numNota: string | null;
  fecha: string;
  delPagoCentavos: number;
  saldoAntesCentavos: number;
  saldoDespuesCentavos: number;
  statusDespues: "pendiente" | "abonado" | "pagada" | "cuenta_perdida";
}

export interface BloqueoBorrado {
  codigo: "saldo-favor-aplicado";
  motivo: string;
}

export interface CobroEnVista {
  id: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  origen: "cobro" | "saldo_favor";
  metodoPago: string;
  montoCentavos: number;
  fechaPago: string;
  fechaOperacion: string;
  /** `null` = Oficina (o saldo a favor). */
  cobrador: string | null;
}

/** La calcula el servidor con las notas bloqueadas: aquí no se decide nada. */
export interface VistaBorrado {
  cobro: CobroEnVista;
  notas: NotaTrasBorrar[];
  saldoFavorAntesCentavos: number;
  saldoFavorDespuesCentavos: number;
  /** + excedente, - aplicación, 0 si el pago no movió saldo a favor. */
  movimientoSaldoFavorCentavos: number;
  bloqueo: BloqueoBorrado | null;
}

export interface CobroDePeticion {
  id: string;
  clienteId: string;
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: "cobro" | "saldo_favor";
  fechaPago: string;
  cobrador: string | null;
  folios: string[];
}

export interface PeticionEnBandeja {
  id: string;
  tipo: "eliminar_cobro";
  status: StatusPeticion;
  sucursalCodigo: string;
  motivo: string;
  solicito: string;
  /** `AAAA-MM-DD HH:MM`, hora de Tijuana. */
  creadaEn: string;
  resolvio: string | null;
  resueltaEn: string | null;
  comentario: string | null;
  cobro: CobroDePeticion;
}

export const ETIQUETA_STATUS_PETICION: Record<StatusPeticion, string> = {
  pendiente: "Pendiente",
  autorizada: "Autorizada",
  denegada: "Denegada",
};

export const ETIQUETA_BORRADO_PEDIDO = "Borrado pedido · pendiente";

/** Motivo y comentario: el servidor rechaza más (`ck_peticion_motivo`). */
export const LARGO_MAX_TEXTO = 500;

export function vistaBorradoDeCobro(cobroId: string): Promise<VistaBorrado> {
  return apiFetch<VistaBorrado>(`/cobros/${encodeURIComponent(cobroId)}/vista-borrado`);
}

export function vistaPreviaDePeticion(id: string): Promise<VistaBorrado> {
  return apiFetch<VistaBorrado>(`/peticiones/${encodeURIComponent(id)}/vista-previa`);
}

export function pedirBorrarCobro(cobroId: string, motivo: string): Promise<PeticionEnBandeja> {
  return apiFetch<PeticionEnBandeja>("/peticiones/eliminar-cobro", {
    method: "POST",
    body: JSON.stringify({ cobroId, motivo }),
  });
}

export function listarPeticiones(
  status: "pendiente" | "historial",
  sucursal: string | null,
): Promise<PeticionEnBandeja[]> {
  const params = new URLSearchParams({ status });
  if (sucursal) params.set("sucursal", sucursal);
  return apiFetch<PeticionEnBandeja[]>(`/peticiones?${params.toString()}`);
}

export function autorizarPeticion(id: string): Promise<PeticionEnBandeja> {
  return apiFetch<PeticionEnBandeja>(`/peticiones/${encodeURIComponent(id)}/autorizar`, { method: "POST" });
}

/** El comentario es opcional: vacío no viaja. */
export function denegarPeticion(id: string, comentario: string): Promise<PeticionEnBandeja> {
  const limpio = comentario.trim();
  return apiFetch<PeticionEnBandeja>(`/peticiones/${encodeURIComponent(id)}/denegar`, {
    method: "POST",
    body: JSON.stringify(limpio ? { comentario: limpio } : {}),
  });
}

/** "Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez" (§3.1). */
export function describirPago(c: {
  cliente: string;
  montoCentavos: number;
  metodoPago: string;
  origen: "cobro" | "saldo_favor";
  fechaPago: string;
  cobrador: string | null;
}): string {
  if (c.origen === "saldo_favor")
    return `Saldo a favor aplicado de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${c.fechaPago}`;
  const metodo = ETIQUETA_METODO_PAGO[c.metodoPago] ?? c.metodoPago;
  const quien = c.cobrador ? `cobró ${c.cobrador}` : "Oficina";
  return `Pago de ${formatearPesos(c.montoCentavos)} · ${c.cliente} · ${c.fechaPago} · ${metodo} · ${quien}`;
}

export function textoPeticionEnviada(p: PeticionEnBandeja): string {
  return `Petición enviada: borrar el pago de ${formatearPesos(p.cobro.montoCentavos)} de ${p.cobro.cliente}.`;
}

export function textoAutorizada(p: PeticionEnBandeja): string {
  return `Petición autorizada: se borró el pago de ${formatearPesos(p.cobro.montoCentavos)} de ${p.cobro.cliente}.`;
}

export function textoDenegada(p: PeticionEnBandeja): string {
  return `Petición denegada: el pago de ${p.cobro.cliente} no cambia.`;
}
```

Run: `npm test --workspace=apps/portal -- peticiones`
Expected: PASS.

- [ ] **Paso 4: Prueba del panel que falla**

Crea `apps/portal/src/components/peticiones/pedir-borrado-cobro.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as peticionesLib from "@/lib/peticiones";
import type { PeticionEnBandeja, VistaBorrado } from "@/lib/peticiones";
import { PedirBorradoCobro } from "./pedir-borrado-cobro";

vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, vistaBorradoDeCobro: vi.fn(), pedirBorrarCobro: vi.fn() };
});

const vistaBorradoDeCobro = vi.mocked(peticionesLib.vistaBorradoDeCobro);
const pedirBorrarCobro = vi.mocked(peticionesLib.pedirBorrarCobro);

export const VISTA: VistaBorrado = {
  cobro: {
    id: "co1",
    clienteId: "c1",
    cliente: "Tacos Erick",
    sucursalCodigo: "TJ",
    origen: "cobro",
    metodoPago: "efectivo",
    montoCentavos: 100000,
    fechaPago: "2026-10-10",
    fechaOperacion: "2026-10-10",
    cobrador: "Juan Pérez",
  },
  notas: [
    {
      notaId: "n1",
      folio: "TJ261001AP01",
      numNota: "77",
      fecha: "2026-10-01",
      delPagoCentavos: 40000,
      saldoAntesCentavos: 0,
      saldoDespuesCentavos: 40000,
      statusDespues: "abonado",
    },
  ],
  saldoFavorAntesCentavos: 30000,
  saldoFavorDespuesCentavos: 20000,
  movimientoSaldoFavorCentavos: 10000,
  bloqueo: null,
};

const PETICION: PeticionEnBandeja = {
  id: "p1",
  tipo: "eliminar_cobro",
  status: "pendiente",
  sucursalCodigo: "TJ",
  motivo: "Era de crédito",
  solicito: "Ana",
  creadaEn: "2026-10-13 09:15",
  resolvio: null,
  resueltaEn: null,
  comentario: null,
  cobro: {
    id: "co1",
    clienteId: "c1",
    cliente: "Tacos Erick",
    montoCentavos: 100000,
    metodoPago: "efectivo",
    origen: "cobro",
    fechaPago: "2026-10-10",
    cobrador: "Juan Pérez",
    folios: ["TJ261001AP01"],
  },
};

function renderizar() {
  const props = { onEnviada: vi.fn(), onDesactualizado: vi.fn(), onCancelar: vi.fn() };
  render(<PedirBorradoCobro cobroId="co1" {...props} />);
  return { usuario: userEvent.setup(), ...props };
}

describe("PedirBorradoCobro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vistaBorradoDeCobro.mockResolvedValue(VISTA);
    pedirBorrarCobro.mockResolvedValue(PETICION);
  });

  it("muestra el pago y cómo quedaría cada nota y el saldo a favor", async () => {
    renderizar();
    expect(
      await screen.findByText("Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez"),
    ).toBeInTheDocument();
    expect(vistaBorradoDeCobro).toHaveBeenCalledWith("co1");
    expect(screen.getByText("TJ261001AP01")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toBeInTheDocument();
    expect(screen.getByText("Saldo a favor: $300.00 → $200.00")).toBeInTheDocument();
  });

  it("sin motivo no se envía; con motivo manda la petición y avisa", async () => {
    const { usuario, onEnviada } = renderizar();
    await screen.findByText("TJ261001AP01");
    const enviar = screen.getByRole("button", { name: "Enviar petición" });
    expect(enviar).toBeDisabled();
    await usuario.type(screen.getByLabelText("Motivo"), "Era de crédito");
    await usuario.click(enviar);
    expect(pedirBorrarCobro).toHaveBeenCalledWith("co1", "Era de crédito");
    expect(onEnviada).toHaveBeenCalledWith("Petición enviada: borrar el pago de $1,000.00 de Tacos Erick.");
  });

  it("con el saldo a favor ya aplicado lo avisa, pero deja enviar la petición", async () => {
    vistaBorradoDeCobro.mockResolvedValue({
      ...VISTA,
      saldoFavorDespuesCentavos: -6000,
      bloqueo: {
        codigo: "saldo-favor-aplicado",
        motivo: "El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.",
      },
    });
    const { usuario } = renderizar();
    expect(await screen.findByText(/ya se aplicó a otras notas/)).toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Motivo"), "x");
    expect(screen.getByRole("button", { name: "Enviar petición" })).toBeEnabled();
  });

  it("Review Focus 5: un 409 al enviar avisa al padre con el mensaje del servidor", async () => {
    pedirBorrarCobro.mockRejectedValue(
      new ErrorApi("fallo", 409, "Este cobro ya tiene una petición de borrado pendiente."),
    );
    const { usuario, onDesactualizado, onEnviada } = renderizar();
    await screen.findByText("TJ261001AP01");
    await usuario.type(screen.getByLabelText("Motivo"), "x");
    await usuario.click(screen.getByRole("button", { name: "Enviar petición" }));
    expect(onDesactualizado).toHaveBeenCalledWith("Este cobro ya tiene una petición de borrado pendiente.");
    expect(onEnviada).not.toHaveBeenCalled();
  });

  it("Review Focus 5: un cobro que ya se borró (409 al cargar) avisa al padre", async () => {
    vistaBorradoDeCobro.mockRejectedValue(new ErrorApi("fallo", 409, "Este cobro ya se borró."));
    const { onDesactualizado } = renderizar();
    await vi.waitFor(() => expect(onDesactualizado).toHaveBeenCalledWith("Este cobro ya se borró."));
  });

  it("otro error al enviar se queda en el panel", async () => {
    pedirBorrarCobro.mockRejectedValue(new ErrorApi("fallo", 400, "Escribe el motivo de la petición."));
    const { usuario } = renderizar();
    await screen.findByText("TJ261001AP01");
    await usuario.type(screen.getByLabelText("Motivo"), "x");
    await usuario.click(screen.getByRole("button", { name: "Enviar petición" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el motivo de la petición.");
  });

  it("Cancelar avisa al padre", async () => {
    const { usuario, onCancelar } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npm test --workspace=apps/portal -- pedir-borrado-cobro`
Expected: FAIL — no existe `./pedir-borrado-cobro`.

- [ ] **Paso 5: La vista previa y el panel**

Crea `apps/portal/src/components/peticiones/vista-borrado.tsx`:

```tsx
import { describirPago, type VistaBorrado } from "@/lib/peticiones";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/**
 * Qué pasaría si se borra el pago (§3.1): lo calculó el servidor con las notas
 * bloqueadas. La usan quien pide y quien autoriza. El bloqueo (saldo a favor ya
 * aplicado) se lee aquí; el servidor lo rechazaría igual al autorizar.
 */
export function VistaBorradoPago({ vista }: { vista: VistaBorrado }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">{describirPago(vista.cobro)}</p>
      {vista.notas.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Folio</th>
              <th className="py-1 font-medium"># de nota</th>
              <th className="py-1 text-right font-medium">Le abonó</th>
              <th className="py-1 text-right font-medium">Saldo hoy</th>
              <th className="py-1 text-right font-medium">Saldo tras borrar</th>
              <th className="py-1 font-medium">Queda</th>
            </tr>
          </thead>
          <tbody>
            {vista.notas.map((n) => (
              <tr key={n.notaId} className="border-t">
                <td className="py-1.5 font-mono">{n.folio}</td>
                <td className="py-1.5">{n.numNota ?? "—"}</td>
                <td className="py-1.5 text-right">{formatearPesos(n.delPagoCentavos)}</td>
                <td className="py-1.5 text-right">{formatearPesos(n.saldoAntesCentavos)}</td>
                <td className="py-1.5 text-right font-semibold">{formatearPesos(n.saldoDespuesCentavos)}</td>
                <td className="py-1.5">{ETIQUETA_STATUS[n.statusDespues]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {vista.movimientoSaldoFavorCentavos !== 0 && (
        <p>{`Saldo a favor: ${formatearPesos(vista.saldoFavorAntesCentavos)} → ${formatearPesos(vista.saldoFavorDespuesCentavos)}`}</p>
      )}
      {vista.bloqueo && <p className="font-medium text-destructive">{vista.bloqueo.motivo}</p>}
    </div>
  );
}
```

Crea `apps/portal/src/components/peticiones/pedir-borrado-cobro.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { ErrorApi, mensajeDe } from "@/lib/api";
import {
  LARGO_MAX_TEXTO,
  pedirBorrarCobro,
  textoPeticionEnviada,
  vistaBorradoDeCobro,
  type VistaBorrado,
} from "@/lib/peticiones";
import { VistaBorradoPago } from "./vista-borrado";

/** El 409 de "ya se pidió" o "ya se borró": lo que se ve en pantalla quedó viejo. */
function esDesactualizado(err: unknown): err is ErrorApi {
  return err instanceof ErrorApi && err.status === 409;
}

/**
 * Pedir el borrado de un pago (T-34, §3.1): la vista previa del servidor, el
 * motivo y enviar. Pedir no cambia nada: el pago sigue vivo hasta que alguien
 * con "Peticiones" lo autorice. Un 409 (otra persona ya lo pidió, o ya se
 * borró) no se queda aquí: el padre recarga y muestra el mensaje.
 */
export function PedirBorradoCobro({
  cobroId,
  onEnviada,
  onDesactualizado,
  onCancelar,
}: {
  cobroId: string;
  onEnviada: (mensaje: string) => void;
  onDesactualizado: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [vista, setVista] = useState<VistaBorrado | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo enviar la petición.");
  // El efecto de carga depende solo del cobro: el aviso al padre se lee del ref.
  const avisarDesactualizado = useRef(onDesactualizado);
  useEffect(() => {
    avisarDesactualizado.current = onDesactualizado;
  });

  useEffect(() => {
    let vigente = true;
    vistaBorradoDeCobro(cobroId)
      .then((v) => {
        if (vigente) setVista(v);
      })
      .catch((err) => {
        if (!vigente) return;
        if (esDesactualizado(err)) {
          avisarDesactualizado.current(err.mensajeApi ?? "Este cobro ya cambió; vuelve a cargar.");
          return;
        }
        setErrorCarga(mensajeDe(err, "No se pudo cargar el cobro."));
      });
    return () => {
      vigente = false;
    };
  }, [cobroId]);

  async function enviarPeticion() {
    await enviar(
      async () => {
        try {
          onEnviada(textoPeticionEnviada(await pedirBorrarCobro(cobroId, motivo)));
        } catch (err) {
          if (esDesactualizado(err)) {
            onDesactualizado(err.mensajeApi ?? "Este cobro ya cambió; vuelve a cargar.");
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Pedir borrado del cobro" className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">Pedir borrado del cobro</h3>
      {errorCarga && (
        <p role="alert" className="text-sm text-destructive">
          {errorCarga}
        </p>
      )}
      {vista === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {vista && <VistaBorradoPago vista={vista} />}
      <label className="flex flex-col gap-1 text-sm">
        Motivo
        <textarea
          className="rounded-md border p-2"
          rows={3}
          maxLength={LARGO_MAX_TEXTO}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => void enviarPeticion()}
          disabled={enviando || vista === null || motivo.trim() === ""}
        >
          Enviar petición
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}
```

Run: `npm test --workspace=apps/portal -- pedir-borrado-cobro`
Expected: PASS.

- [ ] **Paso 6: El detalle de venta — prueba que falla**

En `apps/portal/src/components/ventas/detalle-venta.test.tsx`:
- el `vi.mock("@/lib/ventas", …)` agrega `obtenerVenta: vi.fn()` al objeto que devuelve, y agrega:

```tsx
vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, vistaBorradoDeCobro: vi.fn(), pedirBorrarCobro: vi.fn() };
});
```

- importa `import * as peticionesLib from "@/lib/peticiones";` y declara
  `const obtenerVenta = vi.mocked(ventasLib.obtenerVenta);`,
  `const vistaBorradoDeCobro = vi.mocked(peticionesLib.vistaBorradoDeCobro);`,
  `const pedirBorrarCobro = vi.mocked(peticionesLib.pedirBorrarCobro);`
- agrega al final del `describe("DetalleVenta", …)`:

```tsx
  describe("pedir borrado (T-34)", () => {
    const ETIQUETA = "Pedir borrado del cobro del 2024-03-05 por $100.00";

    it("con cobranza.editar_eliminar, un cobro que es un pago tiene Pedir borrado; el de contado no", () => {
      renderizar({
        ...VENTA,
        cobros: [
          ...VENTA.cobros,
          {
            id: "a9",
            fechaPago: "2024-03-04",
            metodoPago: "efectivo",
            montoCentavos: 5000,
            origen: "venta_contado",
            cobroId: null,
            peticionPendiente: false,
          },
        ],
      });
      expect(screen.getByRole("button", { name: ETIQUETA })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Pedir borrado/ })).toHaveLength(1);
    });

    it("un pago con petición pendiente dice Borrado pedido · pendiente", () => {
      renderizar({ ...VENTA, cobros: [{ ...VENTA.cobros[0], peticionPendiente: true }] });
      expect(screen.getByText("Borrado pedido · pendiente")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: ETIQUETA })).not.toBeInTheDocument();
    });

    it("sin el permiso no se ve Pedir borrado", () => {
      mockAuth((clave) => clave !== "cobranza.editar_eliminar");
      renderizar();
      expect(screen.queryByRole("button", { name: ETIQUETA })).not.toBeInTheDocument();
    });

    it("al enviar la petición recarga la venta y muestra el aviso", async () => {
      vistaBorradoDeCobro.mockResolvedValue({
        cobro: {
          id: "co1",
          clienteId: "c1",
          cliente: "Abarrotes Lupita",
          sucursalCodigo: "TJ",
          origen: "cobro",
          metodoPago: "efectivo",
          montoCentavos: 10000,
          fechaPago: "2024-03-05",
          fechaOperacion: "2024-03-05",
          cobrador: null,
        },
        notas: [],
        saldoFavorAntesCentavos: 0,
        saldoFavorDespuesCentavos: 0,
        movimientoSaldoFavorCentavos: 0,
        bloqueo: null,
      });
      pedirBorrarCobro.mockResolvedValue({
        id: "p1",
        tipo: "eliminar_cobro",
        status: "pendiente",
        sucursalCodigo: "TJ",
        motivo: "x",
        solicito: "Ana",
        creadaEn: "2024-03-06 10:00",
        resolvio: null,
        resueltaEn: null,
        comentario: null,
        cobro: {
          id: "co1",
          clienteId: "c1",
          cliente: "Abarrotes Lupita",
          montoCentavos: 10000,
          metodoPago: "efectivo",
          origen: "cobro",
          fechaPago: "2024-03-05",
          cobrador: null,
          folios: ["TJ240304OF01"],
        },
      });
      const actualizada = { ...VENTA, cobros: [{ ...VENTA.cobros[0], peticionPendiente: true }] };
      obtenerVenta.mockResolvedValue(actualizada);

      const { usuario, onCambiada } = renderizar();
      await usuario.click(screen.getByRole("button", { name: ETIQUETA }));
      expect(vistaBorradoDeCobro).toHaveBeenCalledWith("co1");
      await usuario.type(await screen.findByLabelText("Motivo"), "Era de crédito");
      await usuario.click(screen.getByRole("button", { name: "Enviar petición" }));

      await vi.waitFor(() => expect(onCambiada).toHaveBeenCalledWith(actualizada));
      expect(obtenerVenta).toHaveBeenCalledWith("v1");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Petición enviada: borrar el pago de $100.00 de Abarrotes Lupita.",
      );
    });
  });
```

Run: `npm test --workspace=apps/portal -- detalle-venta`
Expected: FAIL — no hay botón "Pedir borrado".

- [ ] **Paso 7: El detalle de venta**

En `apps/portal/src/components/ventas/detalle-venta.tsx`:

- imports: agrega `import { useState } from "react";`,
  `import { PedirBorradoCobro } from "@/components/peticiones/pedir-borrado-cobro";`,
  `import { ETIQUETA_BORRADO_PEDIDO } from "@/lib/peticiones";` y `obtenerVenta` a la lista de `@/lib/ventas`;
- dentro del componente, después de `const { enviando, error, enviar } = …`:

```tsx
  const puedePedirBorrado = puede("cobranza.editar_eliminar");
  // El pago cuyo borrado se está pidiendo (T-34); uno a la vez.
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function pedirBorrado(cobroId: string | null) {
    if (cobroId === null) return;
    setAviso(null);
    setPidiendo(cobroId);
  }

  /** Tras pedir (o tras un 409): la venta fresca, para que el cobro diga "Borrado pedido · pendiente". */
  async function refrescar(mensaje: string) {
    setPidiendo(null);
    setAviso(mensaje);
    try {
      onCambiada(await obtenerVenta(venta.id));
    } catch {
      setAviso(`${mensaje} Vuelve a abrir la venta para ver el cambio.`);
    }
  }
```

- en la tabla de cobros, agrega una última columna: en `thead` `<th className="py-1" />` y en cada fila:

```tsx
                    <td className="py-1.5 text-right">
                      {c.cobroId !== null && c.peticionPendiente && (
                        <span className="text-muted-foreground">{ETIQUETA_BORRADO_PEDIDO}</span>
                      )}
                      {c.cobroId !== null && !c.peticionPendiente && puedePedirBorrado && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Pedir borrado del cobro del ${c.fechaPago} por ${formatearPesos(c.montoCentavos)}`}
                          disabled={pidiendo !== null}
                          onClick={() => pedirBorrado(c.cobroId)}
                        >
                          Pedir borrado
                        </Button>
                      )}
                    </td>
```

- justo después de la `</section>` de Cobros:

```tsx
        {pidiendo && (
          <PedirBorradoCobro
            key={pidiendo}
            cobroId={pidiendo}
            onEnviada={(mensaje) => void refrescar(mensaje)}
            onDesactualizado={(mensaje) => void refrescar(mensaje)}
            onCancelar={() => setPidiendo(null)}
          />
        )}

        {aviso && (
          <p role="status" className="rounded-md border p-3 text-sm">
            {aviso}
          </p>
        )}
```

Run: `npm test --workspace=apps/portal -- detalle-venta`
Expected: PASS (las pruebas viejas y las 4 nuevas).

- [ ] **Paso 8: Cobranza — prueba que falla**

En `apps/portal/src/components/cobranza/cobranza-cliente.test.tsx`:
- agrega el mock:

```tsx
vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, vistaBorradoDeCobro: vi.fn(), pedirBorrarCobro: vi.fn() };
});
```

- importa `import * as peticionesLib from "@/lib/peticiones";` y declara
  `const vistaBorradoDeCobro = vi.mocked(peticionesLib.vistaBorradoDeCobro);` y
  `const pedirBorrarCobro = vi.mocked(peticionesLib.pedirBorrarCobro);`
- agrega al final del `describe("CobranzaCliente", …)`:

```tsx
  describe("pedir borrado de un abono (T-34)", () => {
    const ETIQUETA = "Pedir borrado del abono del 2024-04-03 por $30.00";

    it("cada abono que es un pago tiene Pedir borrado", async () => {
      renderizar();
      await screen.findByText("Cobranza · Cobach XXI");
      expect(screen.getByRole("button", { name: ETIQUETA })).toBeInTheDocument();
    });

    it("con petición pendiente dice Borrado pedido · pendiente", async () => {
      porCobrarDeCliente.mockResolvedValue({
        ...DATOS,
        notas: [N1, { ...N2, abonos: [{ ...N2.abonos[0], peticionPendiente: true }] }],
      });
      renderizar();
      expect(await screen.findByText("Borrado pedido · pendiente")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: ETIQUETA })).not.toBeInTheDocument();
    });

    it("sin cobranza.editar_eliminar no se ve el botón", async () => {
      mockAuth((clave) => clave !== "cobranza.editar_eliminar");
      renderizar();
      await screen.findByText("Cobranza · Cobach XXI");
      expect(screen.queryByRole("button", { name: ETIQUETA })).not.toBeInTheDocument();
    });

    it("al enviar la petición recarga el cliente y muestra el aviso", async () => {
      vistaBorradoDeCobro.mockResolvedValue({
        cobro: {
          id: "co2",
          clienteId: "c1",
          cliente: "Cobach XXI",
          sucursalCodigo: "TJ",
          origen: "saldo_favor",
          metodoPago: "saldo_favor",
          montoCentavos: 3000,
          fechaPago: "2024-04-03",
          fechaOperacion: "2024-04-03",
          cobrador: null,
        },
        notas: [],
        saldoFavorAntesCentavos: 0,
        saldoFavorDespuesCentavos: 3000,
        movimientoSaldoFavorCentavos: -3000,
        bloqueo: null,
      });
      pedirBorrarCobro.mockResolvedValue({
        id: "p1",
        tipo: "eliminar_cobro",
        status: "pendiente",
        sucursalCodigo: "TJ",
        motivo: "x",
        solicito: "Ana",
        creadaEn: "2024-04-04 10:00",
        resolvio: null,
        resueltaEn: null,
        comentario: null,
        cobro: {
          id: "co2",
          clienteId: "c1",
          cliente: "Cobach XXI",
          montoCentavos: 3000,
          metodoPago: "saldo_favor",
          origen: "saldo_favor",
          fechaPago: "2024-04-03",
          cobrador: null,
          folios: ["TJ240402OF01"],
        },
      });
      const { usuario } = renderizar();
      await screen.findByText("Cobranza · Cobach XXI");
      await usuario.click(screen.getByRole("button", { name: ETIQUETA }));
      expect(vistaBorradoDeCobro).toHaveBeenCalledWith("co2");
      await usuario.type(await screen.findByLabelText("Motivo"), "Se aplicó por error");
      await usuario.click(screen.getByRole("button", { name: "Enviar petición" }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Petición enviada: borrar el pago de $30.00 de Cobach XXI.",
      );
      expect(porCobrarDeCliente).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("region", { name: "Pedir borrado del cobro" })).not.toBeInTheDocument();
    });
  });
```

Run: `npm test --workspace=apps/portal -- cobranza-cliente`
Expected: FAIL — no hay botón "Pedir borrado".

- [ ] **Paso 9: Cobranza**

En `apps/portal/src/components/cobranza/cobranza-cliente.tsx`:

- imports: `import { PedirBorradoCobro } from "@/components/peticiones/pedir-borrado-cobro";` y
  `import { ETIQUETA_BORRADO_PEDIDO } from "@/lib/peticiones";`;
- después de `const [version, setVersion] = useState(0);`:

```tsx
  // El pago cuyo borrado se está pidiendo (T-34); uno a la vez. Toda recarga lo cierra.
  const [pidiendo, setPidiendo] = useState<string | null>(null);
```

- `recargar` queda:

```tsx
  const recargar = useCallback((mensaje: string | null) => {
    setAviso(mensaje);
    setPidiendo(null);
    setRecarga((n) => n + 1);
  }, []);
```

- después de `const puedePerdida = puede("venta.editar_eliminar");`:

```tsx
  const puedePedirBorrado = puede("cobranza.editar_eliminar");

  function pedirBorrado(cobroId: string | null) {
    if (cobroId === null) return;
    setAviso(null);
    setPidiendo(cobroId);
  }
```

- el `<li>` de cada abono queda:

```tsx
                              <li key={`${a.fechaPago}-${i}`}>
                                {`${a.fechaPago} · ${formatearPesos(a.montoCentavos)} · ${ETIQUETA_METODO_PAGO[a.metodoPago] ?? a.metodoPago}`}
                                {a.cobroId !== null && a.peticionPendiente && (
                                  <span className="ml-2 text-muted-foreground">{ETIQUETA_BORRADO_PEDIDO}</span>
                                )}
                                {a.cobroId !== null && !a.peticionPendiente && puedePedirBorrado && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="ml-2"
                                    aria-label={`Pedir borrado del abono del ${a.fechaPago} por ${formatearPesos(a.montoCentavos)}`}
                                    disabled={pidiendo !== null}
                                    onClick={() => pedirBorrado(a.cobroId)}
                                  >
                                    Pedir borrado
                                  </Button>
                                )}
                              </li>
```

- justo después del bloque de la tabla (antes de `{datos && palomeadas.length > 0 && (<RegistrarPago …`):

```tsx
        {pidiendo && (
          <PedirBorradoCobro
            key={pidiendo}
            cobroId={pidiendo}
            onEnviada={recargar}
            onDesactualizado={recargar}
            onCancelar={() => setPidiendo(null)}
          />
        )}
```

Run: `npm test --workspace=apps/portal`
Expected: PASS (todas las del portal).

Run: `npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal`
Expected: sin errores; `next build` también revisa los tipos de las pruebas.

- [ ] **Paso 10: Commit**

```bash
git add apps/portal/src/lib/peticiones.ts apps/portal/src/lib/peticiones.test.ts \
  apps/portal/src/lib/ventas.ts apps/portal/src/lib/cobranzas.ts apps/portal/src/lib/ventas.test.ts \
  apps/portal/src/components/peticiones/vista-borrado.tsx \
  apps/portal/src/components/peticiones/pedir-borrado-cobro.tsx \
  apps/portal/src/components/peticiones/pedir-borrado-cobro.test.tsx \
  apps/portal/src/components/ventas/detalle-venta.tsx apps/portal/src/components/ventas/detalle-venta.test.tsx \
  apps/portal/src/components/ventas/formulario-editar-venta.test.tsx \
  apps/portal/src/components/cobranza/cobranza-cliente.tsx \
  apps/portal/src/components/cobranza/cobranza-cliente.test.tsx
git commit -m "T-34: portal — pedir el borrado de un cobro desde la venta y desde Cobranza

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Tarea 7: Portal — la bandeja *Operación → Peticiones*

`/operacion/peticiones` deja de ser placeholder: pestañas **Pendientes** e **Historial**, filtro global
**"Por sucursal"** (llega como `?sucursal=` igual que en Cobranza), y en cada pendiente **Autorizar** (con la
vista previa recalculada en ese momento) y **Denegar** (comentario opcional). Si la vista previa trae
bloqueo, **"Confirmar y borrar"** queda deshabilitado con el motivo a la vista (desviación 6). Un 409 se
muestra como alerta y la lista se recarga (Review Focus 5). **Modelo:** `sonnet` para implementar y revisar.

**Archivos:**
- Crear: `apps/portal/src/components/peticiones/bandeja-peticiones.tsx`, `bandeja-peticiones.test.tsx`
- Crear: `apps/portal/src/components/peticiones/pantalla-peticiones.tsx`, `pantalla-peticiones.test.tsx`
- Modificar: `apps/portal/src/app/(portal)/operacion/peticiones/page.tsx`

**Interfaces:**
- Consume (Tarea 6): `listarPeticiones`, `vistaPreviaDePeticion`, `autorizarPeticion`, `denegarPeticion`,
  `describirPago`, `textoAutorizada`, `textoDenegada`, `ETIQUETA_STATUS_PETICION`, `LARGO_MAX_TEXTO`,
  `PeticionEnBandeja`, `VistaBorrado` (`lib/peticiones.ts`) y `VistaBorradoPago`
  (`components/peticiones/vista-borrado.tsx`).
- Produce:
  `export function PantallaPeticiones({ sucursal }: { sucursal: string | null })` y
  `export function BandejaPeticiones({ status, sucursal }: { status: "pendiente" | "historial"; sucursal: string | null })`.

- [ ] **Paso 1: Prueba de la bandeja que falla**

Crea `apps/portal/src/components/peticiones/bandeja-peticiones.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as peticionesLib from "@/lib/peticiones";
import type { PeticionEnBandeja, VistaBorrado } from "@/lib/peticiones";
import { BandejaPeticiones } from "./bandeja-peticiones";

vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return {
    ...real,
    listarPeticiones: vi.fn(),
    vistaPreviaDePeticion: vi.fn(),
    autorizarPeticion: vi.fn(),
    denegarPeticion: vi.fn(),
  };
});

const listarPeticiones = vi.mocked(peticionesLib.listarPeticiones);
const vistaPreviaDePeticion = vi.mocked(peticionesLib.vistaPreviaDePeticion);
const autorizarPeticion = vi.mocked(peticionesLib.autorizarPeticion);
const denegarPeticion = vi.mocked(peticionesLib.denegarPeticion);

const PENDIENTE: PeticionEnBandeja = {
  id: "p1",
  tipo: "eliminar_cobro",
  status: "pendiente",
  sucursalCodigo: "TJ",
  motivo: "Era de crédito",
  solicito: "Ana",
  creadaEn: "2026-10-13 09:15",
  resolvio: null,
  resueltaEn: null,
  comentario: null,
  cobro: {
    id: "co1",
    clienteId: "c1",
    cliente: "Tacos Erick",
    montoCentavos: 100000,
    metodoPago: "efectivo",
    origen: "cobro",
    fechaPago: "2026-10-10",
    cobrador: "Juan Pérez",
    folios: ["TJ261001AP01", "TJ261003AP02"],
  },
};

const VISTA: VistaBorrado = {
  cobro: {
    id: "co1",
    clienteId: "c1",
    cliente: "Tacos Erick",
    sucursalCodigo: "TJ",
    origen: "cobro",
    metodoPago: "efectivo",
    montoCentavos: 100000,
    fechaPago: "2026-10-10",
    fechaOperacion: "2026-10-10",
    cobrador: "Juan Pérez",
  },
  notas: [],
  saldoFavorAntesCentavos: 0,
  saldoFavorDespuesCentavos: 0,
  movimientoSaldoFavorCentavos: 0,
  bloqueo: null,
};

const BOTON_AUTORIZAR = "Autorizar petición de Tacos Erick";
const BOTON_DENEGAR = "Denegar petición de Tacos Erick";

describe("BandejaPeticiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarPeticiones.mockResolvedValue([PENDIENTE]);
    vistaPreviaDePeticion.mockResolvedValue(VISTA);
  });

  it("pendientes: quién pidió, cliente, el pago, sus notas y el motivo, con sus botones", async () => {
    render(<BandejaPeticiones status="pendiente" sucursal="TJ" />);
    expect(await screen.findByText("Era de crédito")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenCalledWith("pendiente", "TJ");
    expect(screen.getByText("2026-10-13 09:15")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Tacos Erick · TJ")).toBeInTheDocument();
    expect(
      screen.getByText("Pago de $1,000.00 · Tacos Erick · 2026-10-10 · Efectivo · cobró Juan Pérez"),
    ).toBeInTheDocument();
    expect(screen.getByText("TJ261001AP01, TJ261003AP02")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BOTON_AUTORIZAR })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BOTON_DENEGAR })).toBeInTheDocument();
  });

  it("vacías: lo dice según la pestaña", async () => {
    listarPeticiones.mockResolvedValue([]);
    const { unmount } = render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    expect(await screen.findByText("No hay peticiones pendientes.")).toBeInTheDocument();
    unmount();
    render(<BandejaPeticiones status="historial" sucursal={null} />);
    expect(await screen.findByText("No hay peticiones resueltas.")).toBeInTheDocument();
  });

  it("historial: resultado, quién y cuándo resolvió, y el comentario; sin botones", async () => {
    listarPeticiones.mockResolvedValue([
      { ...PENDIENTE, status: "denegada", resolvio: "Beto", resueltaEn: "2026-10-13 10:00", comentario: "No procede" },
    ]);
    render(<BandejaPeticiones status="historial" sucursal={null} />);
    expect(await screen.findByText("Denegada")).toBeInTheDocument();
    expect(screen.getByText("Beto · 2026-10-13 10:00")).toBeInTheDocument();
    expect(screen.getByText("No procede")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BOTON_AUTORIZAR })).not.toBeInTheDocument();
  });

  it("autorizar: vista previa recalculada, confirmar, aviso y la lista se recarga", async () => {
    autorizarPeticion.mockResolvedValue({ ...PENDIENTE, status: "autorizada" });
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    expect(vistaPreviaDePeticion).toHaveBeenCalledWith("p1");
    await usuario.click(await screen.findByRole("button", { name: "Confirmar y borrar" }));

    expect(autorizarPeticion).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Petición autorizada: se borró el pago de $1,000.00 de Tacos Erick.",
    );
    expect(listarPeticiones).toHaveBeenCalledTimes(2);
  });

  it("con el saldo a favor ya aplicado no deja confirmar y dice por qué", async () => {
    vistaPreviaDePeticion.mockResolvedValue({
      ...VISTA,
      bloqueo: {
        codigo: "saldo-favor-aplicado",
        motivo: "El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.",
      },
    });
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    expect(await screen.findByText(/ya se aplicó a otras notas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar y borrar" })).toBeDisabled();
  });

  it("Review Focus 5: un 409 al autorizar se ve como alerta y la lista se recarga", async () => {
    autorizarPeticion.mockRejectedValue(new ErrorApi("fallo", 409, "Esta petición ya fue resuelta."));
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    await usuario.click(await screen.findByRole("button", { name: "Confirmar y borrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta petición ya fue resuelta.");
    await vi.waitFor(() => expect(listarPeticiones).toHaveBeenCalledTimes(2));
  });

  it("Review Focus 5: si la vista previa ya no se puede calcular (409), alerta y recarga", async () => {
    vistaPreviaDePeticion.mockRejectedValue(new ErrorApi("fallo", 409, "Este cobro ya se borró."));
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este cobro ya se borró.");
    await vi.waitFor(() => expect(listarPeticiones).toHaveBeenCalledTimes(2));
  });

  it("denegar con comentario: aviso y recarga", async () => {
    denegarPeticion.mockResolvedValue({ ...PENDIENTE, status: "denegada", comentario: "No procede" });
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_DENEGAR }));
    await usuario.type(screen.getByLabelText("Comentario (opcional)"), "No procede");
    await usuario.click(screen.getByRole("button", { name: "Confirmar denegación" }));

    expect(denegarPeticion).toHaveBeenCalledWith("p1", "No procede");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Petición denegada: el pago de Tacos Erick no cambia.",
    );
    expect(listarPeticiones).toHaveBeenCalledTimes(2);
  });

  it("si no carga, lo dice", async () => {
    listarPeticiones.mockRejectedValue(new ErrorApi("fallo", 500));
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las peticiones.");
  });
});
```

Run: `npm test --workspace=apps/portal -- bandeja-peticiones`
Expected: FAIL — no existe `./bandeja-peticiones`.

- [ ] **Paso 2: La bandeja**

Crea `apps/portal/src/components/peticiones/bandeja-peticiones.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { ErrorApi, mensajeDe } from "@/lib/api";
import {
  ETIQUETA_STATUS_PETICION,
  LARGO_MAX_TEXTO,
  autorizarPeticion,
  denegarPeticion,
  describirPago,
  listarPeticiones,
  textoAutorizada,
  textoDenegada,
  vistaPreviaDePeticion,
  type PeticionEnBandeja,
  type VistaBorrado,
} from "@/lib/peticiones";
import { VistaBorradoPago } from "./vista-borrado";

type Accion = { tipo: "autorizar" | "denegar"; peticion: PeticionEnBandeja };

/** Cómo termina una acción: un aviso (salió bien) o una alerta (409: la pantalla quedó vieja). */
type Fin = { aviso: string } | { alerta: string };

function esDesactualizado(err: unknown): err is ErrorApi {
  return err instanceof ErrorApi && err.status === 409;
}

/**
 * La bandeja de peticiones (T-34, §3.2). La lista la arma el servidor con el
 * alcance del usuario; autorizar y denegar los vuelve a decidir el servidor con
 * la petición bloqueada. Toda acción, salga bien o con 409, cierra el panel y
 * recarga la lista: lo que se ve nunca se queda viejo.
 */
export function BandejaPeticiones({
  status,
  sucursal,
}: {
  status: "pendiente" | "historial";
  sucursal: string | null;
}) {
  const [peticiones, setPeticiones] = useState<PeticionEnBandeja[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [fin, setFin] = useState<Fin | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    listarPeticiones(status, sucursal)
      .then((lista) => {
        if (!vigente) return;
        setPeticiones(lista);
        setErrorCarga(null);
      })
      .catch((err) => {
        if (!vigente) return;
        setPeticiones(null);
        setErrorCarga(mensajeDe(err, "No se pudieron cargar las peticiones."));
      });
    return () => {
      vigente = false;
    };
  }, [status, sucursal, recarga]);

  const terminar = useCallback((resultado: Fin) => {
    setFin(resultado);
    setAccion(null);
    setRecarga((n) => n + 1);
  }, []);

  function abrir(tipo: Accion["tipo"], peticion: PeticionEnBandeja) {
    setFin(null);
    setAccion({ tipo, peticion });
  }

  const pendientes = status === "pendiente";

  return (
    <div className="flex flex-col gap-4">
      {fin && "aviso" in fin && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {fin.aviso}
        </p>
      )}
      {fin && "alerta" in fin && (
        <p role="alert" className="text-sm text-destructive">
          {fin.alerta}
        </p>
      )}
      {errorCarga && (
        <p role="alert" className="text-sm text-destructive">
          {errorCarga}
        </p>
      )}
      {peticiones === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {peticiones &&
        (peticiones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pendientes ? "No hay peticiones pendientes." : "No hay peticiones resueltas."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1.5">Pedida</th>
                <th className="py-1.5">Pidió</th>
                <th className="py-1.5">Cliente</th>
                <th className="py-1.5">Pago</th>
                <th className="py-1.5">Notas</th>
                <th className="py-1.5">Motivo</th>
                {pendientes ? (
                  <th className="py-1.5" />
                ) : (
                  <>
                    <th className="py-1.5">Resultado</th>
                    <th className="py-1.5">Resolvió</th>
                    <th className="py-1.5">Comentario</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {peticiones.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="py-1.5">{p.creadaEn}</td>
                  <td className="py-1.5">{p.solicito}</td>
                  <td className="py-1.5">{`${p.cobro.cliente} · ${p.sucursalCodigo}`}</td>
                  <td className="py-1.5">{describirPago(p.cobro)}</td>
                  <td className="py-1.5 font-mono">{p.cobro.folios.join(", ") || "—"}</td>
                  <td className="py-1.5">{p.motivo}</td>
                  {pendientes ? (
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          aria-label={`Autorizar petición de ${p.cobro.cliente}`}
                          disabled={accion !== null}
                          onClick={() => abrir("autorizar", p)}
                        >
                          Autorizar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Denegar petición de ${p.cobro.cliente}`}
                          disabled={accion !== null}
                          onClick={() => abrir("denegar", p)}
                        >
                          Denegar
                        </Button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5">{ETIQUETA_STATUS_PETICION[p.status]}</td>
                      <td className="py-1.5">{`${p.resolvio ?? "—"} · ${p.resueltaEn ?? "—"}`}</td>
                      <td className="py-1.5">{p.comentario ?? "—"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {accion?.tipo === "autorizar" && (
        <AutorizarPeticion
          key={accion.peticion.id}
          peticion={accion.peticion}
          onTerminar={terminar}
          onCancelar={() => setAccion(null)}
        />
      )}
      {accion?.tipo === "denegar" && (
        <DenegarPeticion
          key={accion.peticion.id}
          peticion={accion.peticion}
          onTerminar={terminar}
          onCancelar={() => setAccion(null)}
        />
      )}
    </div>
  );
}

/** Autorizar: la vista previa recalculada al abrir, y confirmar. */
function AutorizarPeticion({
  peticion,
  onTerminar,
  onCancelar,
}: {
  peticion: PeticionEnBandeja;
  onTerminar: (fin: Fin) => void;
  onCancelar: () => void;
}) {
  const [vista, setVista] = useState<VistaBorrado | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo autorizar la petición.");
  // El efecto de carga depende solo de la petición: el aviso al padre se lee del ref.
  const avisar = useRef(onTerminar);
  useEffect(() => {
    avisar.current = onTerminar;
  });

  useEffect(() => {
    let vigente = true;
    vistaPreviaDePeticion(peticion.id)
      .then((v) => {
        if (vigente) setVista(v);
      })
      .catch((err) => {
        if (!vigente) return;
        if (esDesactualizado(err)) {
          avisar.current({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
          return;
        }
        setErrorCarga(mensajeDe(err, "No se pudo calcular la vista previa."));
      });
    return () => {
      vigente = false;
    };
  }, [peticion.id]);

  async function confirmar() {
    await enviar(
      async () => {
        try {
          onTerminar({ aviso: textoAutorizada(await autorizarPeticion(peticion.id)) });
        } catch (err) {
          if (esDesactualizado(err)) {
            onTerminar({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Autorizar petición" className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">Autorizar: se borra el pago completo</h3>
      <p className="text-sm">{`Motivo: ${peticion.motivo}`}</p>
      {errorCarga && (
        <p role="alert" className="text-sm text-destructive">
          {errorCarga}
        </p>
      )}
      {vista === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {vista && <VistaBorradoPago vista={vista} />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={() => void confirmar()}
          disabled={enviando || vista === null || vista.bloqueo !== null}
        >
          Confirmar y borrar
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

/** Denegar: comentario opcional. El pago no cambia. */
function DenegarPeticion({
  peticion,
  onTerminar,
  onCancelar,
}: {
  peticion: PeticionEnBandeja;
  onTerminar: (fin: Fin) => void;
  onCancelar: () => void;
}) {
  const [comentario, setComentario] = useState("");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo denegar la petición.");

  async function confirmar() {
    await enviar(
      async () => {
        try {
          onTerminar({ aviso: textoDenegada(await denegarPeticion(peticion.id, comentario)) });
        } catch (err) {
          if (esDesactualizado(err)) {
            onTerminar({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Denegar petición" className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">{`Denegar: ${describirPago(peticion.cobro)}`}</h3>
      <label className="flex flex-col gap-1 text-sm">
        Comentario (opcional)
        <textarea
          className="rounded-md border p-2"
          rows={2}
          maxLength={LARGO_MAX_TEXTO}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" onClick={() => void confirmar()} disabled={enviando}>
          Confirmar denegación
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}
```

Run: `npm test --workspace=apps/portal -- bandeja-peticiones`
Expected: PASS.

- [ ] **Paso 3: La pantalla y la ruta — prueba que falla**

Crea `apps/portal/src/components/peticiones/pantalla-peticiones.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as peticionesLib from "@/lib/peticiones";
import { PantallaPeticiones } from "./pantalla-peticiones";

vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, listarPeticiones: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const listarPeticiones = vi.mocked(peticionesLib.listarPeticiones);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("PantallaPeticiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarPeticiones.mockResolvedValue([]);
  });

  it("sin peticiones.gestionar lo dice y no pide nada", () => {
    mockAuth((clave) => clave !== "peticiones.gestionar");
    render(<PantallaPeticiones sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver peticiones")).toBeInTheDocument();
    expect(listarPeticiones).not.toHaveBeenCalled();
  });

  it("abre en Pendientes con la sucursal del filtro; Historial pide las resueltas", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaPeticiones sucursal="TJ" />);
    expect(await screen.findByText("No hay peticiones pendientes.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenCalledWith("pendiente", "TJ");
    expect(screen.getByRole("button", { name: "Pendientes" })).toHaveAttribute("aria-pressed", "true");

    await usuario.click(screen.getByRole("button", { name: "Historial" }));
    expect(await screen.findByText("No hay peticiones resueltas.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenLastCalledWith("historial", "TJ");
  });
});
```

Run: `npm test --workspace=apps/portal -- pantalla-peticiones`
Expected: FAIL — no existe `./pantalla-peticiones`.

- [ ] **Paso 4: La pantalla y la ruta**

Crea `apps/portal/src/components/peticiones/pantalla-peticiones.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { BandejaPeticiones } from "./bandeja-peticiones";

type Pestana = "pendiente" | "historial";

/** Operación → Peticiones (T-34): autorizar o denegar el borrado de pagos. */
export function PantallaPeticiones({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [pestana, setPestana] = useState<Pestana>("pendiente");

  if (!puede("peticiones.gestionar")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Peticiones</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tienes permiso para ver peticiones</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Peticiones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={pestana === "pendiente" ? "default" : "outline"}
            aria-pressed={pestana === "pendiente"}
            onClick={() => setPestana("pendiente")}
          >
            Pendientes
          </Button>
          <Button
            type="button"
            variant={pestana === "historial" ? "default" : "outline"}
            aria-pressed={pestana === "historial"}
            onClick={() => setPestana("historial")}
          >
            Historial
          </Button>
        </div>
        {/* key: cambiar de pestaña empieza limpio (sin avisos ni paneles de la otra). */}
        <BandejaPeticiones key={pestana} status={pestana} sucursal={sucursal} />
      </CardContent>
    </Card>
  );
}
```

`apps/portal/src/app/(portal)/operacion/peticiones/page.tsx` queda:

```tsx
import { PantallaPeticiones } from "@/components/peticiones/pantalla-peticiones";

// Server component delgado (mismo patron que /operacion/cobranza).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaPeticiones sucursal={sucursal ?? null} />;
}
```

Run: `npm test --workspace=apps/portal`
Expected: PASS.

Run: `npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal`
Expected: sin errores.

- [ ] **Paso 5: Commit**

```bash
git add apps/portal/src/components/peticiones/bandeja-peticiones.tsx \
  apps/portal/src/components/peticiones/bandeja-peticiones.test.tsx \
  apps/portal/src/components/peticiones/pantalla-peticiones.tsx \
  apps/portal/src/components/peticiones/pantalla-peticiones.test.tsx \
  "apps/portal/src/app/(portal)/operacion/peticiones/page.tsx"
git commit -m "T-34: portal — bandeja de Peticiones con pendientes, historial, autorizar y denegar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Tarea 8: Verificación completa, prueba a mano contra la base LOCAL y documentación

**Modelo:** `sonnet` para la tarea; la revisión final de la rama, **`opus`**.

**Archivos:**
- Modificar: `CLAUDE.md`
- (Sin tocar el vault ni GitHub: esta tarea deja los textos para quien coordina.)

- [ ] **Paso 1: Suite completa**

Run:
```
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend
npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend
npm run supabase -- test db
npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npm run build --workspace=apps/portal
npm run typecheck --workspace=apps/tablet && npm test --workspace=apps/tablet
```
Expected: todo en verde. Anota los conteos por suite para el PR. Comprueba que `git diff main --stat -- apps/tablet`
**no muestra nada** (T-34 no toca la app) y que `npm run db:types --workspace=apps/backend` no cambia
`schema.d.ts` (`git diff --exit-code apps/backend/src/database/schema.d.ts`).

- [ ] **Paso 2: Prueba a mano contra el Postgres LOCAL**

`.env.development` apunta a la **nube**: no lo uses tal cual. Con el stack local arriba, toma `DATABASE_URL` de
`.env.test`. En la Mac de Roberto el 3000 está ocupado:

```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-)
PORT=3010 npm run backend                                   # en una terminal
NEXT_PUBLIC_API_URL=http://localhost:3010 npm run portal    # en otra
```

Antes de arrancar, comprueba que el backend de verdad lee ese `DATABASE_URL` (si `.env.development` lo pisa,
cambia temporalmente su `DATABASE_URL` a la local y **restáuralo al terminar**; nunca lo subas). Crea dos
usuarios `Administrador General` con `npm run crear-usuario --workspace=apps/backend` en esa misma terminal
(uno pide, otro autoriza) y uno `Auxiliar Administrativo` (sin permisos).

Recorrido (cliente de TJ con dos ventas a crédito registradas desde *Registrar venta*, fechas distintas):
1. *Operación → Cobranza*: pagar las dos notas de más (sobra a saldo a favor).
2. *Ventas → detalle* de la primera: el cobro tiene **"Pedir borrado"**. Abrirlo: la vista previa dice el pago
   completo, las dos notas (saldo hoy → tras borrar) y "Saldo a favor: $… → $0.00". Sin motivo, "Enviar
   petición" está deshabilitado. Con motivo → aviso "Petición enviada: …" y el cobro dice
   **"Borrado pedido · pendiente"**.
3. *Operación → Peticiones* con el otro usuario: la petición en **Pendientes** (cliente, pago, folios, motivo,
   quién pidió). **Autorizar** → vista previa → **Confirmar y borrar** → aviso "Petición autorizada: …"; la
   petición pasa a **Historial** con quién y cuándo.
4. *Ventas → detalle*: sin cobros, **Editar** disponible otra vez; en *Cobranza*, las dos notas vuelven a deber
   y el saldo a favor desapareció.
5. Bloqueo: pagar de más una nota (sobra saldo a favor), registrar otra venta, *Aplicar saldo a favor* a
   ella, pedir el borrado del **primer** pago → en Peticiones, **Confirmar y borrar** deshabilitado con "El
   saldo a favor que dejó este pago ya se aplicó…". Pedir y autorizar primero el de la aplicación; después el
   primero ya se autoriza.
6. **Denegar** una petición con comentario → aparece en Historial como "Denegada" con el comentario; el cobro
   vuelve a mostrar "Pedir borrado".
7. Con el filtro global en MX, Peticiones no muestra las de TJ.
8. Con el usuario sin permisos: Peticiones dice "No tienes permiso para ver peticiones" y en el detalle de venta
   no hay "Pedir borrado".

Toma una captura de la bandeja con una pendiente y de la vista previa de autorizar para el PR. Al terminar,
apaga el backend y el portal, y deja `.env.development` como estaba.

- [ ] **Paso 3: `CLAUDE.md`**

a) En la viñeta **Toda corrección de una venta va por el portal (T-17, parte 2)**, cambia

```markdown
  - Una venta con abonos vivos de `origen` `cobro` o `saldo_favor` (T-21), o en cuenta perdida, no se edita ni se elimina.
    Quitar cobros es T-34.
```

por

```markdown
  - Una venta con abonos vivos de `origen` `cobro` o `saldo_favor` (T-21), o en cuenta perdida, no se edita ni se elimina.
    Para quitarlos se pide el borrado del pago en Peticiones (T-34, abajo).
```

b) En el bloque **Cobranza desde el portal (T-21)**, cambia
`  - Un cobro del portal **no se deshace** todavía: eso es T-34. Por eso la vista previa.` por
`  - Un cobro (de la tablet o del portal) se deshace **solo** con una petición autorizada (T-34, abajo).`

c) Justo después del bloque **Cobranza desde el portal (T-21)** (antes de **Jornada y kilometraje (T-38)**),
agrega:

```markdown
- **Peticiones: borrar un pago con autorización (T-34).** Quien tiene `cobranza.editar_eliminar` **pide**
  (`POST /peticiones/eliminar-cobro`, con motivo); quien tiene `peticiones.gestionar` **autoriza o deniega** en
  *Operación → Peticiones*. Puede ser la misma persona (decisión de Roberto, 2026-10-13). Todo en
  `ventas-cobranza/peticiones.*`, `cobros-borrado.*`, `cobros.controller.ts` y `reglas-borrado-cobro.ts`.
  - **El pago es una entidad: tabla `cobro`.** Cada cobro (tablet, portal o aplicar saldo a favor) crea su fila
    en `cobro`, y sus filas de `cobranza_abono` y su `saldo_favor_movimiento` cuelgan de él con `cobro_id`. El
    cobro automático de una venta de **contado no es un pago**: `cobro_id` null (`ck_cobranza_abono_cobro`) y se
    corrige editando la venta. Quien escriba cobros por debajo del servicio (pruebas incluidas) crea su `cobro`
    (`apps/backend/test/apoyo-cobros.ts`). La entidad del push de cobranza en `sync_operacion` es el `cobro`.
  - **Se borra el pago completo**, nunca un pedazo: `deleted_at` en el `cobro` (+ `eliminado_por_usuario_id`),
    sus filas y su saldo a favor; cada nota recalcula su status (`cuenta_perdida` se queda). El status se
    escribe aunque no cambie y se toca `cliente.updated_at`: así la tablet recibe la nota otra vez pendiente en
    el pull **sin cambiar la app**.
  - **Candados al autorizar:** la `peticion` (`for update`) → notas del cliente → su saldo a favor → el `cobro`.
    Mismo orden que el cobro: sin abrazo mortal con T-20/T-21. La vista previa toma los mismos candados.
  - **Se rechaza (409)** si el saldo a favor que dejó el pago ya se aplicó (quedaría negativo): primero se borra
    el pago que lo aplicó. La petición sigue pendiente.
  - Una sola petición **pendiente** por pago (`uq_peticion_cobro_pendiente`). El alcance (sucursal del cliente)
    se comprueba **antes** de decir si el pago está borrado o la petición resuelta.
  - **Corte, Flujo de Efectivo y Tesorería** (aún no existen) deben contar pagos de `cobro` **vivos** y excluir
    los de origen `saldo_favor` (no es dinero nuevo).
```

d) En el párrafo "Si el pull trajo migraciones y prefieres partir limpio, `npm run supabase -- db reset`
reaplica las 23+ desde cero", no cambies nada (sigue siendo cierto).

- [ ] **Paso 4: Commit**

```bash
git add CLAUDE.md
git commit -m "T-34: CLAUDE.md anota el pago como entidad y las peticiones de borrado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**No hagas push ni abras el PR.** Entrega en tu reporte, tal cual, los textos de los pasos 5 y 6.

- [ ] **Paso 5: Textos para el vault (los aplica quien coordina en `../jawa-obsidian-memory`)**

- `30-Decisiones/ADR-0013 El pago como entidad y peticiones de borrado.md` (nuevo, frontmatter de
  `Plantilla ADR`: `tipo: adr`, `producto: ambos`, `estado: aceptado`, `relacionado` con [[Cobranza-Abono]],
  [[Ventas y Cobranza]], [[Portal Web]], [[ADR-0009 Proyección de operaciones sincronizadas a los módulos de dominio]],
  [[ADR-0012 La cobranza no lleva folio]]):
  - **Contexto:** el cliente pide borrar una cobranza mal capturada con autorización del administrador (fuentes
    v2.0 y julio); un pago a varias notas eran filas sueltas sin nada que las uniera; borrar un pedazo deja las
    cuentas chuecas.
  - **Decisión:** tabla `cobro` (un renglón por pago, `cobro_id` en abonos y saldo a favor; el cobro de contado
    no es un pago); se borra el pago completo vía `peticion` (pendiente → autorizada/denegada), con
    `cobranza.editar_eliminar` para pedir y `peticiones.gestionar` para resolver, la misma persona puede hacer
    las dos; cualquier fecha; candados en el orden del cobro; se rechaza si el saldo a favor que dejó ya se
    aplicó. La entidad del push de cobranza pasa a ser el `cobro` (enmienda a ADR-0009 §2.4).
  - **Consecuencias:** la tablet no cambia (las notas vuelven en el pull); Corte/Flujo/Tesorería deben contar
    pagos vivos; pedir desde la app queda para después (necesitaría `solicito_vendedor_id` y bajar `cobro_id`
    en el pull); la bandeja nace genérica (`tipo`) para peticiones de ventas o producción.
  - Agregar la línea en `30-Decisiones/_MOC Decisiones.md`.
- `10-Dominio/Entidades/Cobranza-Abono.md` (`actualizado:`): en el `[!tip] Consideraciones para el modelo de
  datos`, la viñeta de "eliminar una cobranza" gana "— **implementado en T-34** (petición en el portal; pedir
  desde la app queda pendiente)". Agregar un `[!success] Implementado en T-34 (2026-10-13)` con: el pago como
  entidad (`cobro`), se borra completo, status recalculado, bloqueo por saldo a favor aplicado, la tablet lo
  recibe en el pull. Enlace al spec y a ADR-0013.
- `10-Dominio/Modulos/Ventas y Cobranza.md`: sección "Peticiones" con el flujo (pedir con motivo desde Ventas o
  Cobranza → bandeja → autorizar/denegar) y los permisos.
- `20-Arquitectura/Portal Web.md`: la viñeta **Peticiones** de Operación gana "Implementado en T-34: hoy solo el
  borrado de pagos; pestañas Pendientes/Historial, filtro por sucursal".
- `00-Inicio/Estado del proyecto.md`: fila de T-34 con el PR (y `actualizado:`).
- `40-Equipo/Bitácora/2026-10-13.md`: las decisiones de Roberto (petición en portal; solo cobros; pago completo;
  la misma persona puede pedir y autorizar; cualquier fecha; tabla `cobro`) y las desviaciones del plan.

- [ ] **Paso 6: Texto para el PR (lo abre quien coordina)**

````markdown
## T-34 · Peticiones — borrar un cobro con autorización

Un pago mal capturado (de la tablet o del portal, o una aplicación de saldo a favor) ya se puede borrar:
quien tiene *Editar y eliminar cobranza* **pide** el borrado con un motivo desde el detalle de la venta o
desde Cobranza, y quien tiene *Peticiones* lo **autoriza o deniega** en *Operación → Peticiones*.

- **El pago es una entidad** (tabla `cobro`): sus filas en notas y su saldo a favor cuelgan de él. Se borra
  **completo**; cada nota recalcula su status y la venta se vuelve a poder editar.
- **La tablet no cambia**: la nota vuelve a ella como pendiente en el siguiente pull, con el saldo a favor nuevo.
- Se rechaza si el saldo a favor que dejó el pago ya se aplicó (primero se borra el que lo aplicó).
- Candados en el orden del cobro (petición → notas → saldo a favor → pago); una sola petición pendiente por pago.

### Desviaciones del spec (decididas al escribir el plan)

(copiar la lista "Desviaciones del spec" del plan, 1–7)

### Migración `20261013120000_peticiones_cobro` — pre-flight en `sinmex dev`

```sql
-- Lo que el relleno tendria que agrupar. Al 2026-10-13 ambas daban 0.
select count(*) from cobranza_abono where origen <> 'venta_contado';
select count(*) from saldo_favor_movimiento;
-- Si alguna no da 0: aplicaciones de saldo a favor sin abonos del mismo instante (quedarian sin pago y la
-- migracion abortaria sola). Debe dar 0.
select count(*) from saldo_favor_movimiento sf
 where sf.origen = 'aplicacion'
   and not exists (select 1 from cobranza_abono ca join venta_nota vn on vn.id = ca.venta_nota_id
                    where vn.cliente_id = sf.cliente_id and ca.created_at = sf.created_at
                      and ca.origen = 'saldo_favor');
-- Los nombres nuevos estan libres: deben dar 0.
select count(*) from pg_tables where schemaname = 'public' and tablename in ('cobro', 'peticion');
select count(*) from information_schema.columns
 where table_name in ('cobranza_abono', 'saldo_favor_movimiento') and column_name = 'cobro_id';
```

La migración valida sola que no quede nada sin agrupar (`raise exception`) y falla entera si pasa. Si `main` ya
tiene una migración con timestamp posterior a `20261013120000`, el `db push` necesitará `--include-all`:
anotarlo aquí con la razón.

### Para Mario

La app **no cambia**. Una nota cuyo cobro se borra en el portal vuelve a la tablet como pendiente en el siguiente
pull y se cobra como siempre. Si después quieres que el vendedor pida el borrado desde la tablet, el §8 del spec
dice qué haría falta (`solicito_vendedor_id` en `peticion` y bajar el `cobro_id` en el pull).

### Pruebas

(conteos del Paso 1) · capturas de la bandeja y de la vista previa · Closes #34

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

---

## Autorrevisión del plan (hecha al escribirlo)

- **Cobertura del spec:** §2 (flujo, alcance solo cobros, pago completo, misma persona, cualquier fecha, tabla
  `cobro`) → Tareas 1, 3 y 4. §3.1 (pedir desde Ventas y Cobranza, vista previa, motivo, "Borrado pedido ·
  pendiente") → Tareas 5 y 6. §3.2 (bandeja, pestañas, filtro por sucursal, autorizar/denegar, 409 visible) →
  Tareas 4 y 7. §4.1 (modelo y relleno) → Tarea 1. §4.2 (todo cobro nace con su pago, entidad del push) →
  Tarea 1. §4.3 (regla y borrado con candados) → Tareas 2 y 3. §4.4 (endpoints) → Tarea 4. §4.5 (pull de la
  tablet, edición de ventas, lectores) → Tareas 4 y 5. §4.6 (portal) → Tareas 6 y 7. §4.7 (pre-flight) →
  Tarea 8. §5 respetado: la app no se toca, sin peticiones de ventas/producción, sin cancelar, sin Corte/
  Tesorería. §6 → pruebas en cada tarea. §7 → Tarea 8. §8 → texto del PR.
- **Sin huecos:** cada paso de código trae el código; las ediciones a archivos existentes citan el texto exacto
  a cambiar o el lugar exacto donde insertar.
- **Tipos consistentes:** `CabeceraCobro`, `VistaBorrado`, `CobroEnVista`, `NotaTrasBorrar`, `BloqueoBorrado`
  (Tareas 2–3) son los que consumen la Tarea 4 (backend) y la copia del portal en `lib/peticiones.ts` (Tarea 6);
  `PeticionEnBandeja`/`CobroDePeticion` (Tarea 4) igual en la Tarea 6; `cobroId`/`peticionPendiente`
  (Tarea 5) en `CobroDeVenta` y `AbonoAnterior` de backend y portal. `NuevoCobro.monto` y `NuevoSaldoFavor.cobroId`
  (Tarea 1) los usa `escribir`. Los mensajes de las "Restricciones globales" son las constantes de las Tareas 2–4
  y los textos de `lib/peticiones.ts`.
- **Review Focus con su prueba:** 1 → Tarea 3 (orden de candados, unitaria) y Tarea 4 (saldo ya aplicado, e2e);
  2 → Tarea 4 (dos autorizaciones y autorizar+denegar con `Promise.all`); 3 → Tarea 2 (unitaria) y Tarea 4 (e2e);
  4 → Tarea 4 (usuario de TJ contra MX, también ya resuelta); 5 → Tarea 4 (409 de pendiente y de borrado) y
  Tareas 6–7 (409 visible y recarga).

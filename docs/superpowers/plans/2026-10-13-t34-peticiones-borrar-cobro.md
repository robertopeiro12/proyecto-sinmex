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
3. Cambia las cuatro expectativas `{ tabla: 'cobranza_abono', id: 'abono-1' }` por
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
    abonadoVivoCentavos: number; // TODO lo abonado vivo hoy, este pago incluido
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
  /** TODO lo abonado vivo hoy, este pago incluido. */
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
Expected: sin errores (prettier puede reacomodar líneas largas: corre `npm run lint --workspace=apps/backend -- --fix` si lo pide).

- [ ] **Paso 5: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.ts \
  apps/backend/src/modules/ventas-cobranza/reglas-borrado-cobro.spec.ts
git commit -m "T-34: regla pura de borrar un pago — status tras borrar y saldo a favor ya aplicado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

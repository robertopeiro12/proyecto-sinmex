# T-19 · Asignar factura a notas de ventas — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: usa superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que la oficina anote, desde el Portal, el número de la factura del SAT en varias ventas de un
jalón, lo pueda corregir o quitar, y que una venta facturada no se edite ni se elimine.

**Arquitectura:** tabla nueva `factura` (número único sin mayúsculas/espacios, un cliente) a la que apunta
`venta_nota.factura_id` con llave compuesta `(factura_id, cliente_id)`. `venta_nota.factura` queda en
`N/A`/`pendiente`/`facturada`. Un módulo nuevo dentro de `ventas-cobranza/` (controller + servicio +
repositorio + reglas puras) y una pantalla nueva del Portal, *Operación → Facturas*.

**Stack:** NestJS + Kysely (backend), Postgres/Supabase + pgTAP (base), Next.js + Vitest + Testing Library
(portal).

**Spec:** `docs/superpowers/specs/2026-10-07-t19-asignar-factura-design.md` — léelo antes de empezar.

## Restricciones globales

- Rama `feature/t-19-factura`. Comandos **desde la raíz del repo**, con los scripts del workspace
  (`CLAUDE.md`). Pruebas con el stack local de Supabase arriba (`docker context ls`; en la Mac de Roberto,
  `colima start` y luego `npm run supabase start`).
- Migración: `supabase/migrations/20261007140000_factura.sql`. Aplicar con
  `npm run supabase -- migration up --local` (con el `--`) y regenerar tipos con
  `npm run db:types --workspace=apps/backend`.
- Permiso nuevo: **`venta.asignar_factura`**, grupo `Operacion Comercial`, descripción
  `Asignar factura a notas de ventas`. Todos los endpoints de `/facturas` lo exigen, lectura incluida.
- Número de factura: `trim`, **1 a 30** caracteres. Se compara con `lower(btrim(numero))`.
- Una venta se puede facturar si está **viva** (`deleted_at is null`), es **del cliente**, su status **no es
  `promocion`** y su `factura` es `N/A` o `pendiente`. "Mostrar también las N/A" solo filtra la **lista**:
  el servidor acepta asignar una `N/A` siempre.
- Asignar: 1 a 200 ventas por llamada; ids repetidos se cuentan una vez.
- Todo en **una transacción**: si una venta falla, no se asigna ninguna.
- Mensajes exactos (los usan las pruebas y la pantalla):
  - `La factura ${numero} ya está asignada a ${cliente}.`
  - `La venta ${folio} ya está en la factura ${numero}.`
  - `La venta ${folio} no es de este cliente.`
  - `La venta ${folio} es de promoción ($0): no se factura.`
  - `Una de las ventas marcadas ya no existe o fue eliminada. Vuelve a cargar la lista.`
  - `El cliente ya tiene la factura ${numero}: quita estas ventas y asígnalas a esa.`
  - `La venta ${folio} no está en la factura ${numero}.`
  - `Otro usuario acaba de registrar esa factura; vuelve a intentar.`
  - `El número de factura debe tener de 1 a 30 caracteres.`
  - Edición bloqueada (409 de PATCH): `Está en la factura ${numero}: quítala primero de la factura para editarla.`
  - Borrado bloqueado (409 de DELETE): `Está en la factura ${numero}: quítala primero de la factura.`
  - En el detalle (`motivoNoEditable`): `Esta venta está en la factura ${numero}: quítala primero de la factura para editarla o eliminarla.`
- La **tablet no cambia**. No toques `apps/tablet` ni los contratos de sincronización.
- Comentarios y nombres en español, sin acentos en identificadores, con la densidad de comentarios del
  código vecino. Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Puntos de revisión (Review Focus)

1. **Número con otra capitalización o espacios** (`" a780 "` cuando ya existe `A780` del mismo cliente):
   debe sumarse a la misma factura, no crear otra ni rechazar. → prueba en la Tarea 3.
2. **Renombrar a sí misma con otra capitalización** (`A780` → `a780`): no es "otra factura"; se guarda.
   → prueba en la Tarea 3.
3. **ids repetidos en `ventaIds`**: no deben duplicar nada ni dar error. → prueba en la Tarea 3.
4. **Usuario atado a TJ sobre un cliente o factura de MX**: 403 al asignar, renombrar y quitar; la
   búsqueda solo le muestra facturas de TJ. → prueba en la Tarea 3.
5. **Asignar una venta `N/A`** sin haber marcado "Mostrar también las N/A": el servidor la acepta.
   → prueba en la Tarea 3.

---

### Tarea 1: Migración `factura`, permiso y pruebas de la base

**Archivos:**
- Crear: `supabase/migrations/20261007140000_factura.sql`
- Crear: `supabase/tests/99_factura_test.sql`
- Modificar: `supabase/tests/93_permiso_sucursal_test.sql` (26 → 27 claves)
- Modificar (generado): `apps/backend/src/database/schema.d.ts`

**Interfaces:**
- Produce: tabla `factura(id, numero, cliente_id, creado_por_usuario_id, creado_en,
  actualizado_por_usuario_id, actualizado_en)`; columnas `venta_nota.factura_id`,
  `venta_nota.factura_asignada_por_usuario_id`, `venta_nota.factura_asignada_en`; índice
  `uq_factura_numero`; checks `ck_venta_nota_factura` y `ck_venta_nota_factura_id`; FK
  `fk_venta_nota_factura`; permiso `venta.asignar_factura`. En `schema.d.ts`: `DB['factura']` y
  `venta_nota.factura: Generated<string>` (ya no `string | null`).

- [ ] **Paso 1: Escribir la prueba pgTAP (falla)**

`supabase/tests/99_factura_test.sql`:

```sql
begin;
select plan(12);

-- T-19: facturas del SAT asignadas a notas de venta. Lo que la BASE garantiza
-- aunque alguien escriba por debajo del servicio. Prefijo `zz-pgtap-t19`.

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t19', 'Usuario pgTAP T-19', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values
    ('ZZ-pgtap-T19 Cliente A', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'TJ')),
    ('ZZ-pgtap-T19 Cliente B', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'TJ'));

create temporary table _t19 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from usuario where login = 'zz-pgtap-t19') as usuario,
  (select id from cliente where nombre = 'ZZ-pgtap-T19 Cliente A') as cliente_a,
  (select id from cliente where nombre = 'ZZ-pgtap-T19 Cliente B') as cliente_b;

insert into factura (numero, cliente_id, creado_por_usuario_id)
  select 'ZZ-A780', cliente_a, usuario from _t19;

-- Una venta de oficina del cliente A, base de las pruebas de abajo.
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota, contado_credito,
     semana, mes, status, sucursal_id, origen, capturo_usuario_id)
  select 'ZZPGTAPT1901', '2026-10-07', cliente_a, null, 100.00, null, 'credito',
         41, 10, 'pendiente', tj, 'portal', usuario
    from _t19;

select has_table('factura', 'existe la tabla factura');

select throws_ok(
  $$insert into factura (numero, cliente_id, creado_por_usuario_id)
      select '  zz-a780 ', cliente_b, usuario from _t19$$,
  '23505', null,
  'el numero no se repite, sin importar mayusculas ni espacios'
);

select throws_ok(
  $$insert into factura (numero, cliente_id, creado_por_usuario_id)
      select '   ', cliente_a, usuario from _t19$$,
  '23514', null,
  'un numero en blanco no entra'
);

select throws_ok(
  $$insert into factura (numero, cliente_id, creado_por_usuario_id)
      select repeat('9', 31), cliente_a, usuario from _t19$$,
  '23514', null,
  'un numero de mas de 30 caracteres no entra'
);

select is(
  (select factura from venta_nota where folio = 'ZZPGTAPT1901'),
  'N/A',
  'factura nace en N/A por default'
);

select throws_ok(
  $$update venta_nota set factura = null where folio = 'ZZPGTAPT1901'$$,
  '23502', null,
  'factura ya no admite null'
);

select throws_ok(
  $$update venta_nota set factura = 'A780' where folio = 'ZZPGTAPT1901'$$,
  '23514', null,
  'factura solo es N/A, pendiente o facturada'
);

select throws_ok(
  $$update venta_nota set factura = 'facturada' where folio = 'ZZPGTAPT1901'$$,
  '23514', null,
  'facturada sin factura_id no entra'
);

select throws_ok(
  $$update venta_nota
       set factura = 'pendiente',
           factura_id = (select id from factura where numero = 'ZZ-A780')
     where folio = 'ZZPGTAPT1901'$$,
  '23514', null,
  'factura_id sin facturada no entra'
);

select lives_ok(
  $$update venta_nota
       set factura = 'facturada',
           factura_id = (select id from factura where numero = 'ZZ-A780')
     where folio = 'ZZPGTAPT1901'$$,
  'una venta del cliente A puede apuntar a una factura del cliente A'
);

select throws_ok(
  $$update venta_nota set cliente_id = (select cliente_b from _t19)
     where folio = 'ZZPGTAPT1901'$$,
  '23503', null,
  'la venta y su factura son del mismo cliente (llave compuesta)'
);

select is(
  (select grupo from permiso where clave = 'venta.asignar_factura' and deleted_at is null),
  'Operacion Comercial',
  'existe el permiso venta.asignar_factura'
);

select * from finish();
rollback;
```

- [ ] **Paso 2: Correrla y ver que falla**

Run: `npm run supabase -- test db`
Expected: FAIL en `99_factura_test.sql` (`relation "factura" does not exist`).

- [ ] **Paso 3: Escribir la migración**

`supabase/migrations/20261007140000_factura.sql`:

```sql
-- T-19: asignar factura a notas de ventas.
--
-- La factura se emite FUERA de JAWA, en el programa avalado por el SAT; aqui
-- solo se registra su numero en las ventas que ampara. Fuente: "una factura
-- puede agrupar varias notas" y "algunos clientes piden factura mensual".
--
-- Decisiones de Roberto (2026-10-07): se asigna a varias ventas de un jalon,
-- se puede corregir el numero o quitar ventas, y un numero es de UN cliente.
-- Ver docs/superpowers/specs/2026-10-07-t19-asignar-factura-design.md.

create table factura (
  id                          uuid primary key default gen_random_uuid(),
  numero                      text not null
                                check (char_length(btrim(numero)) between 1 and 30),
  cliente_id                  uuid not null references cliente(id),
  creado_por_usuario_id       uuid not null references usuario(id),
  creado_en                   timestamptz not null default now(),
  actualizado_por_usuario_id  uuid references usuario(id),
  actualizado_en              timestamptz,
  -- Destino de la llave compuesta de venta_nota (abajo).
  unique (id, cliente_id)
);

-- Un numero es de un solo cliente: A780, a780 y " A780 " son la misma
-- factura. El servicio reconoce su `23505` por este nombre.
create unique index uq_factura_numero on factura (lower(btrim(numero)));

alter table venta_nota
  add column factura_id                      uuid,
  add column factura_asignada_por_usuario_id uuid references usuario(id),
  add column factura_asignada_en             timestamptz,
  -- La BASE impide que una venta apunte a la factura de otro cliente. Con
  -- factura_id null no se comprueba (MATCH SIMPLE).
  add constraint fk_venta_nota_factura
    foreign key (factura_id, cliente_id) references factura (id, cliente_id);

-- `factura` era texto libre y nullable desde T-05. Hasta hoy solo hay N/A y
-- pendiente, y null en filas viejas (el lector ya lo trataba como N/A).
update venta_nota set factura = 'N/A' where factura is null;

alter table venta_nota
  alter column factura set default 'N/A',
  alter column factura set not null,
  add constraint ck_venta_nota_factura
    check (factura in ('N/A', 'pendiente', 'facturada')),
  -- "facturada" si y solo si apunta a una factura.
  add constraint ck_venta_nota_factura_id
    check ((factura = 'facturada') = (factura_id is not null));

create index idx_venta_nota_factura on venta_nota (factura_id)
  where factura_id is not null;
create index idx_venta_nota_por_facturar on venta_nota (cliente_id)
  where factura = 'pendiente' and deleted_at is null;

insert into permiso (clave, grupo, descripcion) values
  ('venta.asignar_factura', 'Operacion Comercial', 'Asignar factura a notas de ventas')
on conflict (clave) do nothing;
```

- [ ] **Paso 4: Actualizar el conteo de permisos**

En `supabase/tests/93_permiso_sucursal_test.sql`, cambiar el comentario y el número:

```sql
-- T-05 sembro 22 permisos desde el documento del cliente; T-08a agrego 23o
-- (sucursal.gestionar); T-18 agrego 24o (precio.gestionar); T-08b agrega 25o
-- (perfil.gestionar); T-13 agrega 26o (usuario.gestionar); T-19 agrega 27o
-- (venta.asignar_factura).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  27,
  'el catalogo de permisos tiene 27 claves'
);
```

- [ ] **Paso 5: Aplicar, regenerar tipos y correr pgTAP**

Run:
```
npm run supabase -- migration up --local
npm run db:types --workspace=apps/backend
npm run supabase -- test db
```
Expected: `All tests successful`. En `schema.d.ts` aparece `factura` y `venta_nota.factura` pasa a
`Generated<string>`.

- [ ] **Paso 6: Comprobar que el backend sigue compilando**

Run: `npm run build --workspace=apps/backend`
Expected: compila. (Si algún lector usaba `factura ?? 'N/A'`, sigue compilando; no lo toques aquí.)

- [ ] **Paso 7: Commit**

```bash
git add supabase/migrations/20261007140000_factura.sql supabase/tests/99_factura_test.sql \
  supabase/tests/93_permiso_sucursal_test.sql apps/backend/src/database/schema.d.ts
git commit -m "T-19: tabla factura y permiso venta.asignar_factura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: Una venta facturada no se edita ni se elimina, y el detalle trae su número

**Archivos:**
- Modificar: `apps/backend/src/modules/ventas-cobranza/acciones-venta.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/acciones-venta.spec.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.repository.ts` (`VentaBloqueada`, `bloquearVenta`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-edicion.service.ts` (`editar`, `eliminar`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.repository.ts` (`CabeceraVenta`, `cabecera`)
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-consulta.service.ts` (`completar`)
- Modificar: `apps/backend/test/ventas-editar.e2e-spec.ts`

**Interfaces:**
- Consume: columnas de la Tarea 1.
- Produce:
  - `accionesDeVenta(status: string, abonosDeCobroVivos: number, facturaNumero: string | null): AccionesVenta`
  - `bloqueoDeEdicion(status: string, abonosDeCobroVivos: number, accion: 'editar' | 'eliminar', facturaNumero: string | null): string | null`
  - `VentaBloqueada.facturaNumero: string | null`
  - `CabeceraVenta.facturaNumero: string | null` (y por tanto `VentaDetalle.facturaNumero`)

- [ ] **Paso 1: Pruebas unitarias que fallan**

En `acciones-venta.spec.ts` agrega (y actualiza las llamadas existentes pasando `null` como último
argumento):

```ts
describe('venta facturada (T-19)', () => {
  it('no se edita ni se elimina, y el motivo nombra la factura', () => {
    expect(accionesDeVenta('pendiente', 0, 'A780')).toEqual({
      editable: false,
      motivoNoEditable:
        'Esta venta está en la factura A780: quítala primero de la factura para editarla o eliminarla.',
      puedeMarcarPerdida: true,
    });
    expect(bloqueoDeEdicion('pendiente', 0, 'editar', 'A780')).toBe(
      'Está en la factura A780: quítala primero de la factura para editarla.',
    );
    expect(bloqueoDeEdicion('pagada', 0, 'eliminar', 'A780')).toBe(
      'Está en la factura A780: quítala primero de la factura.',
    );
  });

  it('los cobros mandan sobre la factura en el mensaje', () => {
    expect(bloqueoDeEdicion('abonado', 1, 'editar', 'A780')).toBe(
      'Tiene cobros registrados: no se puede editar.',
    );
  });

  it('sin factura, todo sigue igual', () => {
    expect(bloqueoDeEdicion('pendiente', 0, 'editar', null)).toBeNull();
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm test --workspace=apps/backend -- acciones-venta`
Expected: FAIL (los motivos de factura no existen).

- [ ] **Paso 3: Implementar en `acciones-venta.ts`**

Agrega el parámetro al final de las dos funciones y los mensajes:

```ts
/** T-19: una venta facturada no cambia sin que alguien la quite de su factura a proposito. */
export const motivoFacturada = (numero: string): string =>
  `Esta venta está en la factura ${numero}: quítala primero de la factura para editarla o eliminarla.`;

export function accionesDeVenta(
  status: string,
  abonosDeCobroVivos: number,
  facturaNumero: string | null,
): AccionesVenta {
  const motivo =
    abonosDeCobroVivos > 0
      ? MOTIVO_CON_COBROS
      : status === 'cuenta_perdida'
        ? MOTIVO_CUENTA_PERDIDA
        : facturaNumero !== null
          ? motivoFacturada(facturaNumero)
          : null;
  return {
    editable: motivo === null,
    motivoNoEditable: motivo,
    // La cuenta perdida no toca montos ni productos: se permite aunque este facturada.
    puedeMarcarPerdida: sePuedeMarcarPerdida(status),
  };
}

export function bloqueoDeEdicion(
  status: string,
  abonosDeCobroVivos: number,
  accion: 'editar' | 'eliminar',
  facturaNumero: string | null,
): string | null {
  if (abonosDeCobroVivos > 0)
    return `Tiene cobros registrados: no se puede ${accion}.`;
  if (status === 'cuenta_perdida')
    return `Está marcada como cuenta perdida: no se puede ${accion}.`;
  if (facturaNumero !== null)
    return accion === 'editar'
      ? `Está en la factura ${facturaNumero}: quítala primero de la factura para editarla.`
      : `Está en la factura ${facturaNumero}: quítala primero de la factura.`;
  return null;
}
```

- [ ] **Paso 4: Leer el número de factura en los dos repositorios**

`ventas-edicion.repository.ts`, en `VentaBloqueada` agrega `facturaNumero: string | null;`, y en
`bloquearVenta` agrega la columna y el join (el `for update of vn` no cambia: solo bloquea la venta):

```ts
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.cliente_id, vn.vendedor_id, vn.sucursal_id, s.codigo,
             vn.status, vn.origen, vn.pct_comision, f.numero as factura_numero
        from venta_nota vn
        join sucursal s on s.id = vn.sucursal_id
        left join factura f on f.id = vn.factura_id
       where vn.id = ${id}
         and vn.deleted_at is null
         for update of vn
```

con `factura_numero: string | null;` en el tipo de la fila y `facturaNumero: f.factura_numero,` en el
objeto que devuelve.

`ventas-consulta.repository.ts`: en `CabeceraVenta` agrega
`/** El numero cuando `factura = 'facturada'` (T-19). */ facturaNumero: string | null;`; en `cabecera`,
`left join factura f on f.id = vn.factura_id`, `f.numero as factura_numero` en el select,
`factura_numero: string | null;` en la fila y `facturaNumero: f.factura_numero,` en el resultado. Cambia
también `factura: string | null;` → `factura: string;` y `factura: f.factura ?? 'N/A'` → `factura: f.factura`
(la columna ya es `not null`).

- [ ] **Paso 5: Pasar el número en los servicios**

`ventas-consulta.service.ts`, en `completar`:

```ts
      ...accionesDeVenta(cabecera.status, deCobranza, cabecera.facturaNumero),
```

`ventas-edicion.service.ts`, en `editar` y en `eliminar`:

```ts
        const bloqueo = bloqueoDeEdicion(
          venta.status,
          await this.repo.abonosDeCobroVivos(id, trx),
          'editar', // 'eliminar' en `eliminar`
          venta.facturaNumero,
        );
```

- [ ] **Paso 6: Correr unitarias y build**

Run: `npm test --workspace=apps/backend -- acciones-venta && npm run build --workspace=apps/backend`
Expected: PASS y compila.

- [ ] **Paso 7: Pruebas e2e en `ventas-editar.e2e-spec.ts` (fallan primero si se corren antes del paso 5)**

Agrega una ayuda junto a `abonar` y un `describe` nuevo. La factura se crea **directo en la base**: el
endpoint de asignar es de la Tarea 3.

```ts
  /** Factura la venta directo en la base (T-19); el endpoint es de facturas.e2e-spec.ts. */
  const facturar = async (ventaId: string, numero: string) => {
    const venta = await ventaPorId(ventaId);
    const { id } = await db
      .insertInto('factura')
      .values({
        numero,
        cliente_id: venta.cliente_id,
        creado_por_usuario_id: usuarioGeneralId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('venta_nota')
      .set({ factura: 'facturada', factura_id: id })
      .where('id', '=', ventaId)
      .execute();
    return id;
  };
```

En el `afterAll`, **antes** de borrar las ventas, suelta las facturas y bórralas:

```ts
    await db
      .updateTable('venta_nota')
      .set({ factura: 'N/A', factura_id: null })
      .where('cliente_id', 'in', clientes)
      .execute();
    await db.deleteFrom('factura').where('cliente_id', 'in', clientes).execute();
```

Y haz lo mismo al principio de `limpiarVentas` para las ventas del portal de `FECHAS` (antes de borrar
`cobranza_abono`):

```ts
    await db
      .updateTable('venta_nota')
      .set({ factura: 'N/A', factura_id: null })
      .where('id', 'in', ventas)
      .execute();
```

Las pruebas:

```ts
  describe('venta facturada (T-19)', () => {
    it('el detalle trae el numero y la marca no editable', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await facturar(v.id, `F1-${SUFIJO}`.slice(0, 30));
      const res = await detalle(cookieGeneral, v.id).expect(200);
      expect(res.body).toMatchObject({
        factura: 'facturada',
        facturaNumero: `F1-${SUFIJO}`.slice(0, 30),
        editable: false,
        puedeMarcarPerdida: true,
      });
    });

    it('editarla es 409 y no cambia nada', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const numero = `F2-${SUFIJO}`.slice(0, 30);
      await facturar(v.id, numero);
      const res = await request(app.getHttpServer())
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
      expect((res.body as { message: string }).message).toBe(
        `Está en la factura ${numero}: quítala primero de la factura para editarla.`,
      );
      const fila = await ventaPorId(v.id);
      expect(fila.monto_total).toBe('270.00');
      expect(fila.factura).toBe('facturada');
    });

    it('eliminarla es 409', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      const numero = `F3-${SUFIJO}`.slice(0, 30);
      await facturar(v.id, numero);
      const res = await request(app.getHttpServer())
        .delete(`/ventas/${v.id}`)
        .set('Cookie', cookieGeneral)
        .expect(409);
      expect((res.body as { message: string }).message).toBe(
        `Está en la factura ${numero}: quítala primero de la factura.`,
      );
      expect((await ventaPorId(v.id)).deleted_at).toBeNull();
    });

    it('marcar cuenta perdida si entra', async () => {
      const v = await registrar({ fecha: FECHA_EDICION });
      await facturar(v.id, `F4-${SUFIJO}`.slice(0, 30));
      await request(app.getHttpServer())
        .post(`/ventas/${v.id}/cuenta-perdida`)
        .set('Cookie', cookieGeneral)
        .expect(201);
      expect((await ventaPorId(v.id)).status).toBe('cuenta_perdida');
    });
  });
```

> Nota: comprueba en la prueba existente de cuenta perdida qué código devuelve el `POST` (Nest responde
> 201 sin `@HttpCode`). Usa el mismo.

- [ ] **Paso 8: Correr las e2e**

Run: `npm run test:e2e --workspace=apps/backend -- ventas-editar`
Expected: PASS, incluidas las 4 nuevas.

- [ ] **Paso 9: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza apps/backend/test/ventas-editar.e2e-spec.ts
git commit -m "T-19: una venta facturada no se edita ni se elimina; el detalle trae su numero

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: Endpoints de facturas (asignar, buscar, renombrar, quitar)

**Archivos:**
- Crear: `apps/backend/src/modules/ventas-cobranza/facturas.ts` (reglas puras)
- Crear: `apps/backend/src/modules/ventas-cobranza/facturas.spec.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/facturas.repository.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/facturas.service.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/facturas.controller.ts`
- Crear: `apps/backend/src/modules/ventas-cobranza/dto/facturas.dto.ts`
- Modificar: `apps/backend/src/modules/ventas-cobranza/ventas-cobranza.module.ts`
- Crear: `apps/backend/test/facturas.e2e-spec.ts`

**Interfaces:**
- Consume: Tarea 1 (tablas), `VentasPortalRepository.clienteDeVenta(clienteId, conexion?)`,
  `.buscarSucursalUsuario(usuarioId)`, `.enTransaccion(tarea)`; `exigirAlcanceSobre` (`alcance-venta.ts`);
  `resolverAlcance` (`../sucursales/alcance-sucursal`); `esViolacionUnicidad`
  (`../../database/errores-postgres`); `aCentavos` (`../sincronizacion/dinero`).
- Produce (los usa el Portal en las Tareas 4–6, copiados a mano):

```ts
export interface VentaDeFactura {
  id: string;
  folio: string;
  fecha: string;            // AAAA-MM-DD
  numNota: string | null;
  montoCentavos: number;
  status: string;
}
export interface VentaPorFacturar extends VentaDeFactura {
  factura: 'N/A' | 'pendiente';
}
export interface FacturaConVentas {
  id: string;
  numero: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  creadoPor: string;        // nombre del usuario
  creadoEn: string;         // 'AAAA-MM-DD HH24:MI' en Tijuana
  totalCentavos: number;
  ventas: VentaDeFactura[]; // por fecha y folio
}
```

Endpoints (todos con `@RequierePermiso('venta.asignar_factura')`):

| Método y ruta | Cuerpo / query | Respuesta |
|---|---|---|
| `GET /facturas/por-facturar` | `clienteId` (uuid), `incluirNA` (`'true'` opcional) | `VentaPorFacturar[]` |
| `POST /facturas/asignar` | `{ clienteId, numero, ventaIds: uuid[] (1..200) }` | `201` `FacturaConVentas` |
| `GET /facturas` | `numero?`, `clienteId?` (al menos uno), `sucursal?` | `FacturaConVentas[]` (tope 100) |
| `PATCH /facturas/:id` | `{ numero }` | `FacturaConVentas` |
| `POST /facturas/:id/quitar` | `{ ventaIds: uuid[] (1..200) }` | `200` `{ factura: FacturaConVentas \| null }` (`null` = se borró) |

- [ ] **Paso 1: Pruebas unitarias de las reglas (fallan)**

`facturas.spec.ts`:

```ts
import {
  MOTIVO_VENTA_INEXISTENTE,
  motivoAlAsignar,
  motivoAlQuitar,
  normalizarNumeroFactura,
  type VentaParaFacturar,
} from './facturas';

const CLIENTE = 'c1';
const venta = (extra: Partial<VentaParaFacturar> = {}): VentaParaFacturar => ({
  id: 'v1',
  folio: 'TJ261007AP01',
  clienteId: CLIENTE,
  status: 'pendiente',
  facturaId: null,
  facturaNumero: null,
  ...extra,
});

describe('normalizarNumeroFactura', () => {
  it('recorta y acepta de 1 a 30 caracteres', () => {
    expect(normalizarNumeroFactura('  A780 ')).toBe('A780');
    expect(normalizarNumeroFactura('9'.repeat(30))).toBe('9'.repeat(30));
  });
  it('en blanco o de mas de 30 es null', () => {
    expect(normalizarNumeroFactura('   ')).toBeNull();
    expect(normalizarNumeroFactura('9'.repeat(31))).toBeNull();
  });
});

describe('motivoAlAsignar', () => {
  it('todo en orden es null', () => {
    expect(motivoAlAsignar(['v1'], [venta()], CLIENTE)).toBeNull();
  });
  it('una venta que no llego (no existe o esta eliminada)', () => {
    expect(motivoAlAsignar(['v1', 'v2'], [venta()], CLIENTE)).toBe(MOTIVO_VENTA_INEXISTENTE);
  });
  it('de otro cliente', () => {
    expect(motivoAlAsignar(['v1'], [venta({ clienteId: 'c2' })], CLIENTE)).toBe(
      'La venta TJ261007AP01 no es de este cliente.',
    );
  });
  it('de promocion', () => {
    expect(motivoAlAsignar(['v1'], [venta({ status: 'promocion' })], CLIENTE)).toBe(
      'La venta TJ261007AP01 es de promoción ($0): no se factura.',
    );
  });
  it('ya facturada', () => {
    expect(
      motivoAlAsignar(['v1'], [venta({ facturaId: 'f1', facturaNumero: 'A780' })], CLIENTE),
    ).toBe('La venta TJ261007AP01 ya está en la factura A780.');
  });
});

describe('motivoAlQuitar', () => {
  it('todas en la factura es null', () => {
    expect(motivoAlQuitar(['v1'], [venta({ facturaId: 'f1' })], 'f1', 'A780')).toBeNull();
  });
  it('una que no esta en esa factura', () => {
    expect(motivoAlQuitar(['v1'], [venta({ facturaId: 'f2' })], 'f1', 'A780')).toBe(
      'La venta TJ261007AP01 no está en la factura A780.',
    );
  });
  it('una que no llego', () => {
    expect(motivoAlQuitar(['v1'], [], 'f1', 'A780')).toBe(MOTIVO_VENTA_INEXISTENTE);
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm test --workspace=apps/backend -- facturas.spec`
Expected: FAIL (`Cannot find module './facturas'`).

- [ ] **Paso 3: Implementar `facturas.ts`**

```ts
/**
 * Reglas puras de la asignacion de facturas (T-19). Deciden, y se prueban sin
 * Postgres; las usa `FacturasService` con las ventas ya bloqueadas.
 *
 * La factura la emite el programa del SAT, fuera de JAWA: aqui solo se valida
 * que su numero se pueda anotar en esas ventas.
 */

export const LARGO_MAX_NUMERO_FACTURA = 30;

export const MOTIVO_NUMERO_INVALIDO = `El número de factura debe tener de 1 a ${LARGO_MAX_NUMERO_FACTURA} caracteres.`;

export const MOTIVO_VENTA_INEXISTENTE =
  'Una de las ventas marcadas ya no existe o fue eliminada. Vuelve a cargar la lista.';

export const MOTIVO_CARRERA =
  'Otro usuario acaba de registrar esa factura; vuelve a intentar.';

/** Una venta viva, bloqueada, con lo que hace falta para decidir. */
export interface VentaParaFacturar {
  id: string;
  folio: string;
  clienteId: string;
  status: string;
  facturaId: string | null;
  facturaNumero: string | null;
}

/** `trim`; `null` si queda en blanco o pasa de 30 (el check de la base dice lo mismo). */
export function normalizarNumeroFactura(crudo: string): string | null {
  const numero = crudo.trim();
  return numero.length >= 1 && numero.length <= LARGO_MAX_NUMERO_FACTURA ? numero : null;
}

export const motivoDeOtroCliente = (numero: string, cliente: string): string =>
  `La factura ${numero} ya está asignada a ${cliente}.`;

export const motivoYaTieneEseNumero = (numero: string): string =>
  `El cliente ya tiene la factura ${numero}: quita estas ventas y asígnalas a esa.`;

/**
 * @param ids los pedidos, ya sin repetir
 * @param ventas las que devolvio el bloqueo (solo vivas)
 */
export function motivoAlAsignar(
  ids: readonly string[],
  ventas: readonly VentaParaFacturar[],
  clienteId: string,
): string | null {
  const porId = new Map(ventas.map((v) => [v.id, v]));
  for (const id of ids) {
    const v = porId.get(id);
    if (!v) return MOTIVO_VENTA_INEXISTENTE;
    if (v.clienteId !== clienteId) return `La venta ${v.folio} no es de este cliente.`;
    if (v.status === 'promocion')
      return `La venta ${v.folio} es de promoción ($0): no se factura.`;
    if (v.facturaNumero !== null)
      return `La venta ${v.folio} ya está en la factura ${v.facturaNumero}.`;
  }
  return null;
}

export function motivoAlQuitar(
  ids: readonly string[],
  ventas: readonly VentaParaFacturar[],
  facturaId: string,
  numero: string,
): string | null {
  const porId = new Map(ventas.map((v) => [v.id, v]));
  for (const id of ids) {
    const v = porId.get(id);
    if (!v) return MOTIVO_VENTA_INEXISTENTE;
    if (v.facturaId !== facturaId) return `La venta ${v.folio} no está en la factura ${numero}.`;
  }
  return null;
}
```

- [ ] **Paso 4: Correr las unitarias**

Run: `npm test --workspace=apps/backend -- facturas.spec`
Expected: PASS.

- [ ] **Paso 5: DTOs** — `dto/facturas.dto.ts`

```ts
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { LARGO_MAX_NUMERO_FACTURA } from '../facturas';
import { recortar } from './registrar-venta.dto';

const MAX_VENTAS = 200;

export class PorFacturarDto {
  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  incluirNA?: string;
}

export class AsignarFacturaDto {
  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;

  // El largo exacto (1..30 tras recortar) lo decide `normalizarNumeroFactura`.
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUMERO_FACTURA, {
    message: `El número de factura debe tener de 1 a ${LARGO_MAX_NUMERO_FACTURA} caracteres.`,
  })
  numero!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos una venta.' })
  @ArrayMaxSize(MAX_VENTAS, { message: `No más de ${MAX_VENTAS} ventas por factura a la vez.` })
  @IsUUID(undefined, { each: true, message: 'Una de las ventas no es válida.' })
  ventaIds!: string[];
}

export class RenombrarFacturaDto {
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUMERO_FACTURA, {
    message: `El número de factura debe tener de 1 a ${LARGO_MAX_NUMERO_FACTURA} caracteres.`,
  })
  numero!: string;
}

export class QuitarVentasDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos una venta.' })
  @ArrayMaxSize(MAX_VENTAS)
  @IsUUID(undefined, { each: true, message: 'Una de las ventas no es válida.' })
  ventaIds!: string[];
}

export class BuscarFacturasDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUMERO_FACTURA)
  numero?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  clienteId?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}
```

- [ ] **Paso 6: Repositorio** — `facturas.repository.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { DB } from '../../database/schema';
import { aCentavos } from '../sincronizacion/dinero';
import type { VentaParaFacturar } from './facturas';

export interface VentaDeFactura {
  id: string;
  folio: string;
  fecha: string;
  numNota: string | null;
  montoCentavos: number;
  status: string;
}

export interface VentaPorFacturar extends VentaDeFactura {
  factura: 'N/A' | 'pendiente';
}

export interface FacturaConVentas {
  id: string;
  numero: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  creadoPor: string;
  creadoEn: string;
  totalCentavos: number;
  ventas: VentaDeFactura[];
}

/** La factura bloqueada `for update`, con la sucursal de su cliente para el alcance. */
export interface FacturaBloqueada {
  id: string;
  numero: string;
  clienteId: string;
  sucursalCodigo: string;
}

export interface FiltroFacturas {
  numero: string | null;
  clienteId: string | null;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  sucursalCodigo: string | null;
}

export const TOPE_BUSQUEDA_FACTURAS = 100;

/**
 * SQL de facturas (T-19). Como `VentasEdicionRepository`: los metodos de
 * escritura reciben la `trx` y ninguno abre la suya; la abre `FacturasService`.
 * Las fechas salen con `to_char` (un `date` leido como `Date` se corre un dia).
 */
@Injectable()
export class FacturasRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** Ventas vivas del cliente sin factura; `N/A` solo si se pide. Sin promociones. */
  async porFacturar(clienteId: string, incluirNA: boolean): Promise<VentaPorFacturar[]> {
    const estados = incluirNA ? ['pendiente', 'N/A'] : ['pendiente'];
    const filas = await sql<{
      id: string;
      folio: string;
      fecha: string;
      num_nota: string | null;
      monto_total: string;
      status: string;
      factura: 'N/A' | 'pendiente';
    }>`
      select vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha, vn.num_nota,
             vn.monto_total, vn.status, vn.factura
        from venta_nota vn
       where vn.cliente_id = ${clienteId}
         and vn.deleted_at is null
         and vn.status <> 'promocion'
         and vn.factura = any(${estados}::text[])
       order by vn.fecha, vn.folio
    `.execute(this.db);
    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      fecha: f.fecha,
      numNota: f.num_nota,
      montoCentavos: aCentavos(f.monto_total),
      status: f.status,
      factura: f.factura,
    }));
  }

  /** Bloquea las ventas VIVAS de esa lista. Las eliminadas o inexistentes no vuelven. */
  async bloquearVentas(ids: string[], trx: Transaction<DB>): Promise<VentaParaFacturar[]> {
    const filas = await sql<{
      id: string;
      folio: string;
      cliente_id: string;
      status: string;
      factura_id: string | null;
      factura_numero: string | null;
    }>`
      select vn.id, vn.folio, vn.cliente_id, vn.status, vn.factura_id,
             f.numero as factura_numero
        from venta_nota vn
        left join factura f on f.id = vn.factura_id
       where vn.id = any(${ids}::uuid[])
         and vn.deleted_at is null
       order by vn.id
         for update of vn
    `.execute(trx);
    return filas.rows.map((f) => ({
      id: f.id,
      folio: f.folio,
      clienteId: f.cliente_id,
      status: f.status,
      facturaId: f.factura_id,
      facturaNumero: f.factura_numero,
    }));
  }

  /** Por numero como lo compara `uq_factura_numero`. */
  async facturaPorNumero(
    numero: string,
    conexion: Database | Transaction<DB> = this.db,
  ): Promise<{ id: string; numero: string; clienteId: string; cliente: string } | undefined> {
    const filas = await sql<{ id: string; numero: string; cliente_id: string; cliente: string }>`
      select f.id, f.numero, f.cliente_id, c.nombre as cliente
        from factura f
        join cliente c on c.id = f.cliente_id
       where lower(btrim(f.numero)) = lower(btrim(${numero}))
    `.execute(conexion);
    const f = filas.rows[0];
    return f ? { id: f.id, numero: f.numero, clienteId: f.cliente_id, cliente: f.cliente } : undefined;
  }

  async bloquearFactura(id: string, trx: Transaction<DB>): Promise<FacturaBloqueada | undefined> {
    const filas = await sql<{ id: string; numero: string; cliente_id: string; codigo: string }>`
      select f.id, f.numero, f.cliente_id, s.codigo
        from factura f
        join cliente c on c.id = f.cliente_id
        join sucursal s on s.id = c.sucursal_id
       where f.id = ${id}
         for update of f
    `.execute(trx);
    const f = filas.rows[0];
    return f
      ? { id: f.id, numero: f.numero, clienteId: f.cliente_id, sucursalCodigo: f.codigo }
      : undefined;
  }

  async crearFactura(
    numero: string,
    clienteId: string,
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const { id } = await trx
      .insertInto('factura')
      .values({ numero, cliente_id: clienteId, creado_por_usuario_id: usuarioId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async asignarVentas(
    facturaId: string,
    ventaIds: string[],
    usuarioId: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    await sql`
      update venta_nota
         set factura = 'facturada',
             factura_id = ${facturaId},
             factura_asignada_por_usuario_id = ${usuarioId},
             factura_asignada_en = now()
       where id = any(${ventaIds}::uuid[])
    `.execute(trx);
  }

  async renombrar(id: string, numero: string, usuarioId: string, trx: Transaction<DB>): Promise<void> {
    await sql`
      update factura
         set numero = ${numero},
             actualizado_por_usuario_id = ${usuarioId},
             actualizado_en = now()
       where id = ${id}
    `.execute(trx);
  }

  /** Regresan a `pendiente`: alguien las marco para facturar y siguen sin factura. */
  async quitarVentas(facturaId: string, ventaIds: string[], trx: Transaction<DB>): Promise<void> {
    await sql`
      update venta_nota
         set factura = 'pendiente',
             factura_id = null,
             factura_asignada_por_usuario_id = null,
             factura_asignada_en = null
       where factura_id = ${facturaId}
         and id = any(${ventaIds}::uuid[])
    `.execute(trx);
  }

  /** Borra la factura si ya no le queda ninguna venta. Devuelve si la borro. */
  async borrarSiVacia(facturaId: string, trx: Transaction<DB>): Promise<boolean> {
    const res = await sql`
      delete from factura
       where id = ${facturaId}
         and not exists (select 1 from venta_nota vn where vn.factura_id = ${facturaId})
    `.execute(trx);
    return Number(res.numAffectedRows ?? 0) > 0;
  }

  async buscar(filtro: FiltroFacturas): Promise<FacturaConVentas[]> {
    const condiciones = [sql`true`];
    if (filtro.numero !== null)
      condiciones.push(sql`lower(btrim(f.numero)) = lower(btrim(${filtro.numero}))`);
    if (filtro.clienteId !== null) condiciones.push(sql`f.cliente_id = ${filtro.clienteId}`);
    if (filtro.sucursalCodigo !== null) condiciones.push(sql`s.codigo = ${filtro.sucursalCodigo}`);
    return this.leer(sql.join(condiciones, sql` and `));
  }

  async leerFactura(id: string): Promise<FacturaConVentas | undefined> {
    return (await this.leer(sql`f.id = ${id}`))[0];
  }

  private async leer(donde: ReturnType<typeof sql>): Promise<FacturaConVentas[]> {
    const facturas = await sql<{
      id: string;
      numero: string;
      cliente_id: string;
      cliente: string;
      codigo: string;
      creado_por: string;
      creado_en: string;
    }>`
      select f.id, f.numero, f.cliente_id, c.nombre as cliente, s.codigo,
             u.nombre as creado_por,
             to_char(f.creado_en at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI') as creado_en
        from factura f
        join cliente c on c.id = f.cliente_id
        join sucursal s on s.id = c.sucursal_id
        join usuario u on u.id = f.creado_por_usuario_id
       where ${donde}
       order by f.creado_en desc
       limit ${TOPE_BUSQUEDA_FACTURAS}
    `.execute(this.db);
    if (facturas.rows.length === 0) return [];

    const ids = facturas.rows.map((f) => f.id);
    const ventas = await sql<{
      factura_id: string;
      id: string;
      folio: string;
      fecha: string;
      num_nota: string | null;
      monto_total: string;
      status: string;
    }>`
      select vn.factura_id, vn.id, vn.folio, to_char(vn.fecha, 'YYYY-MM-DD') as fecha,
             vn.num_nota, vn.monto_total, vn.status
        from venta_nota vn
       where vn.factura_id = any(${ids}::uuid[])
       order by vn.fecha, vn.folio
    `.execute(this.db);

    return facturas.rows.map((f) => {
      const suyas = ventas.rows
        .filter((v) => v.factura_id === f.id)
        .map((v) => ({
          id: v.id,
          folio: v.folio,
          fecha: v.fecha,
          numNota: v.num_nota,
          montoCentavos: aCentavos(v.monto_total),
          status: v.status,
        }));
      return {
        id: f.id,
        numero: f.numero,
        clienteId: f.cliente_id,
        cliente: f.cliente,
        sucursalCodigo: f.codigo,
        creadoPor: f.creado_por,
        creadoEn: f.creado_en,
        totalCentavos: suyas.reduce((t, v) => t + v.montoCentavos, 0),
        ventas: suyas,
      };
    });
  }
}
```

> Si `ReturnType<typeof sql>` no tipa bien en este Kysely, usa `RawBuilder<unknown>` importado de
> `kysely`. Si `Database | Transaction<DB>` sobra porque `Transaction<DB>` ya es asignable a `Database`,
> deja solo `Database` (así lo hace `VentasPortalRepository.clienteDeVenta`).

- [ ] **Paso 7: Servicio** — `facturas.service.ts`

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import type { DB } from '../../database/schema';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import { exigirAlcanceSobre } from './alcance-venta';
import type {
  AsignarFacturaDto,
  BuscarFacturasDto,
} from './dto/facturas.dto';
import {
  MOTIVO_CARRERA,
  MOTIVO_NUMERO_INVALIDO,
  motivoAlAsignar,
  motivoAlQuitar,
  motivoDeOtroCliente,
  motivoYaTieneEseNumero,
  normalizarNumeroFactura,
} from './facturas';
import {
  FacturasRepository,
  type FacturaBloqueada,
  type FacturaConVentas,
  type VentaPorFacturar,
} from './facturas.repository';
import { VentasPortalRepository } from './ventas-portal.repository';

/**
 * Asignar factura a notas de ventas (T-19). Cada escritura es UNA transaccion
 * que bloquea primero lo que toca; si una venta no se puede, no se asigna
 * ninguna. El `23505` de `uq_factura_numero` (dos usuarios creando el mismo
 * numero a la vez) se traduce DESPUES del rollback, releyendo con la conexion
 * normal: la transaccion abortada ya no admite consultas (mismo patron que la
 * colision de folio de T-14).
 */
@Injectable()
export class FacturasService {
  constructor(
    private readonly repo: FacturasRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async porFacturar(
    usuarioId: string,
    clienteId: string,
    incluirNA: boolean,
  ): Promise<VentaPorFacturar[]> {
    const cliente = await this.portal.clienteDeVenta(clienteId);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');
    exigirAlcanceSobre(await this.portal.buscarSucursalUsuario(usuarioId), cliente.sucursalCodigo);
    return this.repo.porFacturar(clienteId, incluirNA);
  }

  async asignar(usuarioId: string, dto: AsignarFacturaDto): Promise<FacturaConVentas> {
    const numero = normalizarNumeroFactura(dto.numero);
    if (numero === null) throw new BadRequestException(MOTIVO_NUMERO_INVALIDO);
    const ventaIds = [...new Set(dto.ventaIds.map((id) => id.toLowerCase()))];
    const clienteId = dto.clienteId.toLowerCase();

    let facturaId: string;
    try {
      facturaId = await this.portal.enTransaccion(async (trx) => {
        const cliente = await this.portal.clienteDeVenta(clienteId, trx);
        if (!cliente) throw new NotFoundException('No existe ese cliente.');
        exigirAlcanceSobre(
          await this.portal.buscarSucursalUsuario(usuarioId),
          cliente.sucursalCodigo,
        );

        const ventas = await this.repo.bloquearVentas(ventaIds, trx);
        const motivo = motivoAlAsignar(ventaIds, ventas, cliente.id);
        if (motivo) throw new ConflictException(motivo);

        const existente = await this.repo.facturaPorNumero(numero, trx);
        if (existente && existente.clienteId !== cliente.id)
          throw new ConflictException(motivoDeOtroCliente(existente.numero, existente.cliente));
        const id =
          existente?.id ?? (await this.repo.crearFactura(numero, cliente.id, usuarioId, trx));
        await this.repo.asignarVentas(id, ventaIds, usuarioId, trx);
        return id;
      });
    } catch (error) {
      if (esViolacionUnicidad(error)) throw await this.conflictoDeNumero(numero, clienteId);
      throw error;
    }
    return this.leer(facturaId);
  }

  async renombrar(usuarioId: string, id: string, crudo: string): Promise<FacturaConVentas> {
    const numero = normalizarNumeroFactura(crudo);
    if (numero === null) throw new BadRequestException(MOTIVO_NUMERO_INVALIDO);
    let clienteId: string | null = null;
    try {
      await this.portal.enTransaccion(async (trx) => {
        const factura = await this.bloquearConAlcance(usuarioId, id, trx);
        clienteId = factura.clienteId;
        const otra = await this.repo.facturaPorNumero(numero, trx);
        // La misma factura con otra capitalizacion NO es "otra".
        if (otra && otra.id !== factura.id)
          throw new ConflictException(
            otra.clienteId === factura.clienteId
              ? motivoYaTieneEseNumero(otra.numero)
              : motivoDeOtroCliente(otra.numero, otra.cliente),
          );
        await this.repo.renombrar(id, numero, usuarioId, trx);
      });
    } catch (error) {
      if (esViolacionUnicidad(error)) throw await this.conflictoDeNumero(numero, clienteId);
      throw error;
    }
    return this.leer(id);
  }

  async quitar(
    usuarioId: string,
    id: string,
    ventaIdsCrudos: string[],
  ): Promise<{ factura: FacturaConVentas | null }> {
    const ventaIds = [...new Set(ventaIdsCrudos.map((v) => v.toLowerCase()))];
    const borrada = await this.portal.enTransaccion(async (trx) => {
      const factura = await this.bloquearConAlcance(usuarioId, id, trx);
      const ventas = await this.repo.bloquearVentas(ventaIds, trx);
      const motivo = motivoAlQuitar(ventaIds, ventas, factura.id, factura.numero);
      if (motivo) throw new ConflictException(motivo);
      await this.repo.quitarVentas(factura.id, ventaIds, trx);
      return this.repo.borrarSiVacia(factura.id, trx);
    });
    return { factura: borrada ? null : await this.leer(id) };
  }

  async buscar(usuarioId: string, dto: BuscarFacturasDto): Promise<FacturaConVentas[]> {
    const numero = dto.numero ? dto.numero : null;
    const clienteId = dto.clienteId ?? null;
    if (numero === null && clienteId === null)
      throw new BadRequestException('Busca por número de factura o por cliente.');
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    exigirAlcanceSobre(usuario, usuario?.codigo ?? '');
    const alcance = resolverAlcance(usuario?.codigo ?? null, dto.sucursal?.trim() || null);
    return this.repo.buscar({
      numero,
      clienteId,
      sucursalCodigo: alcance.tipo === 'una' ? alcance.codigo : null,
    });
  }

  private async bloquearConAlcance(
    usuarioId: string,
    id: string,
    trx: Transaction<DB>,
  ): Promise<FacturaBloqueada> {
    const factura = await this.repo.bloquearFactura(id, trx);
    if (!factura) throw new NotFoundException('No existe esa factura.');
    exigirAlcanceSobre(await this.portal.buscarSucursalUsuario(usuarioId), factura.sucursalCodigo);
    return factura;
  }

  private async leer(id: string): Promise<FacturaConVentas> {
    const factura = await this.repo.leerFactura(id);
    if (!factura) throw new NotFoundException('No existe esa factura.');
    return factura;
  }

  /** Tras el rollback de un `23505`: ¿quien gano la carrera? */
  private async conflictoDeNumero(
    numero: string,
    clienteId: string | null,
  ): Promise<ConflictException> {
    const ganadora = await this.repo.facturaPorNumero(numero);
    if (ganadora && ganadora.clienteId !== clienteId)
      return new ConflictException(motivoDeOtroCliente(ganadora.numero, ganadora.cliente));
    return new ConflictException(MOTIVO_CARRERA);
  }
}
```

> `exigirAlcanceSobre(usuario, usuario?.codigo ?? '')` en `buscar` solo sirve para lanzar el 401 si el
> usuario no existe (con su propia sucursal nunca da 403). Si el revisor lo encuentra confuso, cámbialo
> por `if (!usuario) throw new UnauthorizedException('Sesion invalida.')`, que es lo mismo.

- [ ] **Paso 8: Controller** — `facturas.controller.ts`

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import {
  AsignarFacturaDto,
  BuscarFacturasDto,
  PorFacturarDto,
  QuitarVentasDto,
  RenombrarFacturaDto,
} from './dto/facturas.dto';
import type { FacturaConVentas, VentaPorFacturar } from './facturas.repository';
import { FacturasService } from './facturas.service';

// T-19. Todo con `venta.asignar_factura`, lectura incluida: es una pantalla de
// una sola tarea (mismo criterio que `usuario.gestionar`).
@Controller('facturas')
export class FacturasController {
  constructor(private readonly facturas: FacturasService) {}

  @Get('por-facturar')
  @RequierePermiso('venta.asignar_factura')
  porFacturar(
    @UsuarioActual() usuarioId: string,
    @Query() q: PorFacturarDto,
  ): Promise<VentaPorFacturar[]> {
    return this.facturas.porFacturar(usuarioId, q.clienteId, q.incluirNA === 'true');
  }

  @Post('asignar')
  @RequierePermiso('venta.asignar_factura')
  asignar(
    @UsuarioActual() usuarioId: string,
    @Body() dto: AsignarFacturaDto,
  ): Promise<FacturaConVentas> {
    return this.facturas.asignar(usuarioId, dto);
  }

  @Get()
  @RequierePermiso('venta.asignar_factura')
  buscar(
    @UsuarioActual() usuarioId: string,
    @Query() q: BuscarFacturasDto,
  ): Promise<FacturaConVentas[]> {
    return this.facturas.buscar(usuarioId, q);
  }

  @Patch(':id')
  @RequierePermiso('venta.asignar_factura')
  renombrar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenombrarFacturaDto,
  ): Promise<FacturaConVentas> {
    return this.facturas.renombrar(usuarioId, id, dto.numero);
  }

  @Post(':id/quitar')
  @HttpCode(200)
  @RequierePermiso('venta.asignar_factura')
  quitar(
    @UsuarioActual() usuarioId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuitarVentasDto,
  ): Promise<{ factura: FacturaConVentas | null }> {
    return this.facturas.quitar(usuarioId, id, dto.ventaIds);
  }
}
```

Registra en `ventas-cobranza.module.ts`: `FacturasController` en `controllers`, y `FacturasService`,
`FacturasRepository` en `providers` (con su import y una línea de comentario "T-19: asignar factura").

- [ ] **Paso 9: Build y lint**

Run: `npm run build --workspace=apps/backend && npm run lint --workspace=apps/backend`
Expected: sin errores.

- [ ] **Paso 10: Pruebas e2e** — `apps/backend/test/facturas.e2e-spec.ts`

Las ventas se siembran **directo en la base** (venta de oficina con monto fijo), no por el endpoint: aquí
interesa la factura, no el alta de la venta. Folios con prefijo `ZZF` y un contador: `venta_nota.folio`
solo exige ser único.

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import { DB_CONNECTION, type Database } from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import type { FacturaConVentas } from './../src/modules/ventas-cobranza/facturas.repository';

/** Asignar factura a notas de ventas (T-19): §7 del spec, de punta a punta. */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-fac-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-fac-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-fac-sin-${SUFIJO}`;

describe('Facturas (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  let usuarioGeneralId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;
  const clienteIds: string[] = [];
  let clienteA: string; // TJ
  let clienteB: string; // TJ
  let clienteMx: string;

  let folios = 0;
  let numeros = 0;
  /** Un numero de factura unico por llamada (≤ 30). */
  const numero = () => `F${++numeros}-${SUFIJO}`.slice(0, 30);

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

  const crearUsuario = async (login: string, perfil: string, sucursalId: string | null) => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({ login, nombre: login, password_hash: hash, perfil_id: perfilId, sucursal_id: sucursalId })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
    return id;
  };

  const sembrarCliente = async (nombre: string, sucursalId: string) => {
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
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Venta de oficina viva, a credito, con factura `pendiente` salvo que se diga otra cosa. */
  const sembrarVenta = async (
    clienteId: string,
    extra: { monto?: string; status?: string; factura?: string; fecha?: string } = {},
  ) => {
    const cliente = await db
      .selectFrom('cliente')
      .select('sucursal_id')
      .where('id', '=', clienteId)
      .executeTakeFirstOrThrow();
    const { id, folio } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZF${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: extra.fecha ?? '2024-04-01',
        cliente_id: clienteId,
        vendedor_id: null,
        monto_total: extra.monto ?? '100.00',
        num_nota: null,
        contado_credito: 'credito',
        semana: 14,
        mes: 4,
        status: extra.status ?? 'pendiente',
        sucursal_id: cliente.sucursal_id,
        origen: 'portal',
        capturo_usuario_id: usuarioGeneralId,
        factura: extra.factura ?? 'pendiente',
      })
      .returning(['id', 'folio'])
      .executeTakeFirstOrThrow();
    return { id, folio };
  };

  const asignar = (cookie: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/facturas/asignar').set('Cookie', cookie).send(cuerpo);

  const ventaPorId = (id: string) =>
    db.selectFrom('venta_nota').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (await db.selectFrom('sucursal').select('id').where('codigo', '=', 'TJ').executeTakeFirstOrThrow()).id;
    mxId = (await db.selectFrom('sucursal').select('id').where('codigo', '=', 'MX').executeTakeFirstOrThrow()).id;

    usuarioGeneralId = await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);

    clienteA = await sembrarCliente('Cobach A', tjId);
    clienteB = await sembrarCliente('Tienda B', tjId);
    clienteMx = await sembrarCliente('Abarrotes MX', mxId);
  });

  afterAll(async () => {
    await db
      .updateTable('venta_nota')
      .set({ factura: 'N/A', factura_id: null, factura_asignada_por_usuario_id: null })
      .where('cliente_id', 'in', clienteIds)
      .execute();
    await db.deleteFrom('factura').where('cliente_id', 'in', clienteIds).execute();
    await db.deleteFrom('venta_nota').where('cliente_id', 'in', clienteIds).execute();
    await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    await db.deleteFrom('sesion_refresh').where('usuario_id', 'in', usuarioIds).execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  describe('por facturar', () => {
    it('lista las pendientes del cliente; con incluirNA tambien las N/A; nunca promociones ni eliminadas', async () => {
      const cliente = await sembrarCliente('Lista', tjId);
      const pendiente = await sembrarVenta(cliente);
      const na = await sembrarVenta(cliente, { factura: 'N/A' });
      await sembrarVenta(cliente, { status: 'promocion', monto: '0.00' });
      const eliminada = await sembrarVenta(cliente);
      await db.updateTable('venta_nota').set({ deleted_at: new Date() }).where('id', '=', eliminada.id).execute();

      const solo = await request(app.getHttpServer())
        .get(`/facturas/por-facturar?clienteId=${cliente}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((solo.body as { id: string }[]).map((v) => v.id)).toEqual([pendiente.id]);

      const conNA = await request(app.getHttpServer())
        .get(`/facturas/por-facturar?clienteId=${cliente}&incluirNA=true`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((conNA.body as { id: string }[]).map((v) => v.id).sort()).toEqual(
        [pendiente.id, na.id].sort(),
      );
    });
  });

  describe('asignar', () => {
    it('asigna varias de un jalon y devuelve la factura con su total', async () => {
      const v1 = await sembrarVenta(clienteA, { monto: '100.00' });
      const v2 = await sembrarVenta(clienteA, { monto: '50.50' });
      const n = numero();
      const res = await asignar(cookieGeneral, { clienteId: clienteA, numero: n, ventaIds: [v1.id, v2.id] }).expect(201);
      const factura = res.body as FacturaConVentas;
      expect(factura).toMatchObject({ numero: n, clienteId: clienteA, totalCentavos: 15050 });
      expect(factura.ventas.map((v) => v.id).sort()).toEqual([v1.id, v2.id].sort());
      const fila = await ventaPorId(v1.id);
      expect(fila.factura).toBe('facturada');
      expect(fila.factura_id).toBe(factura.id);
      expect(fila.factura_asignada_por_usuario_id).toBe(usuarioGeneralId);
    });

    it('Review Focus 1: el mismo numero con otra capitalizacion y espacios se suma a la misma factura', async () => {
      const v1 = await sembrarVenta(clienteA);
      const v2 = await sembrarVenta(clienteA);
      const n = numero();
      const primera = (await asignar(cookieGeneral, { clienteId: clienteA, numero: n, ventaIds: [v1.id] }).expect(201)).body as FacturaConVentas;
      const segunda = (await asignar(cookieGeneral, { clienteId: clienteA, numero: `  ${n.toLowerCase()} `, ventaIds: [v2.id] }).expect(201)).body as FacturaConVentas;
      expect(segunda.id).toBe(primera.id);
      expect(segunda.ventas).toHaveLength(2);
    });

    it('Review Focus 3: ids repetidos cuentan una vez', async () => {
      const v = await sembrarVenta(clienteA);
      const res = await asignar(cookieGeneral, { clienteId: clienteA, numero: numero(), ventaIds: [v.id, v.id] }).expect(201);
      expect((res.body as FacturaConVentas).ventas).toHaveLength(1);
    });

    it('Review Focus 5: una venta N/A se puede asignar', async () => {
      const v = await sembrarVenta(clienteA, { factura: 'N/A' });
      await asignar(cookieGeneral, { clienteId: clienteA, numero: numero(), ventaIds: [v.id] }).expect(201);
      expect((await ventaPorId(v.id)).factura).toBe('facturada');
    });

    it('un numero que ya es de otro cliente es 409 y no asigna nada', async () => {
      const deA = await sembrarVenta(clienteA);
      const deB = await sembrarVenta(clienteB);
      const n = numero();
      await asignar(cookieGeneral, { clienteId: clienteA, numero: n, ventaIds: [deA.id] }).expect(201);
      const res = await asignar(cookieGeneral, { clienteId: clienteB, numero: n, ventaIds: [deB.id] }).expect(409);
      expect((res.body as { message: string }).message).toBe(`La factura ${n} ya está asignada a Cobach A ${SUFIJO}.`);
      expect((await ventaPorId(deB.id)).factura).toBe('pendiente');
    });

    it.each([
      ['ya facturada', 'ya está en la factura'],
      ['de promocion', 'es de promoción ($0): no se factura.'],
      ['de otro cliente', 'no es de este cliente.'],
      ['eliminada', 'ya no existe o fue eliminada'],
    ])('si una de las ventas esta %s es 409 y NINGUNA queda asignada', async (caso, mensaje) => {
      const buena = await sembrarVenta(clienteA);
      let mala: { id: string };
      if (caso === 'ya facturada') {
        mala = await sembrarVenta(clienteA);
        await asignar(cookieGeneral, { clienteId: clienteA, numero: numero(), ventaIds: [mala.id] }).expect(201);
      } else if (caso === 'de promocion') {
        mala = await sembrarVenta(clienteA, { status: 'promocion', monto: '0.00' });
      } else if (caso === 'de otro cliente') {
        mala = await sembrarVenta(clienteB);
      } else {
        mala = await sembrarVenta(clienteA);
        await db.updateTable('venta_nota').set({ deleted_at: new Date() }).where('id', '=', mala.id).execute();
      }
      const res = await asignar(cookieGeneral, { clienteId: clienteA, numero: numero(), ventaIds: [buena.id, mala.id] }).expect(409);
      expect((res.body as { message: string }).message).toContain(mensaje);
      expect((await ventaPorId(buena.id)).factura).toBe('pendiente');
    });

    it('un numero en blanco es 400', async () => {
      const v = await sembrarVenta(clienteA);
      await asignar(cookieGeneral, { clienteId: clienteA, numero: '   ', ventaIds: [v.id] }).expect(400);
    });

    it('sin el permiso es 403', async () => {
      const v = await sembrarVenta(clienteA);
      await asignar(cookieSinPermiso, { clienteId: clienteA, numero: numero(), ventaIds: [v.id] }).expect(403);
    });

    it('Review Focus 4: un usuario de TJ no factura a un cliente de MX', async () => {
      const v = await sembrarVenta(clienteMx);
      await asignar(cookieTijuana, { clienteId: clienteMx, numero: numero(), ventaIds: [v.id] }).expect(403);
    });
  });

  describe('renombrar', () => {
    const crear = async (clienteId: string) => {
      const v = await sembrarVenta(clienteId);
      return (await asignar(cookieGeneral, { clienteId, numero: numero(), ventaIds: [v.id] }).expect(201)).body as FacturaConVentas;
    };
    const renombrar = (cookie: string, id: string, n: string) =>
      request(app.getHttpServer()).patch(`/facturas/${id}`).set('Cookie', cookie).send({ numero: n });

    it('cambia el numero y se ve en todas sus ventas', async () => {
      const f = await crear(clienteA);
      const n = numero();
      const res = await renombrar(cookieGeneral, f.id, n).expect(200);
      expect((res.body as FacturaConVentas).numero).toBe(n);
      const fila = await db.selectFrom('factura').selectAll().where('id', '=', f.id).executeTakeFirstOrThrow();
      expect(fila.actualizado_por_usuario_id).toBe(usuarioGeneralId);
    });

    it('Review Focus 2: a si misma con otra capitalizacion se guarda', async () => {
      const f = await crear(clienteA);
      await renombrar(cookieGeneral, f.id, f.numero.toLowerCase()).expect(200);
    });

    it('a un numero de otro cliente es 409', async () => {
      const deA = await crear(clienteA);
      const deB = await crear(clienteB);
      const res = await renombrar(cookieGeneral, deB.id, deA.numero).expect(409);
      expect((res.body as { message: string }).message).toBe(`La factura ${deA.numero} ya está asignada a Cobach A ${SUFIJO}.`);
    });

    it('a otro numero del mismo cliente es 409', async () => {
      const f1 = await crear(clienteA);
      const f2 = await crear(clienteA);
      const res = await renombrar(cookieGeneral, f2.id, f1.numero).expect(409);
      expect((res.body as { message: string }).message).toBe(
        `El cliente ya tiene la factura ${f1.numero}: quita estas ventas y asígnalas a esa.`,
      );
    });

    it('Review Focus 4: un usuario de TJ no renombra una factura de MX', async () => {
      const f = await crear(clienteMx);
      await renombrar(cookieTijuana, f.id, numero()).expect(403);
    });
  });

  describe('quitar', () => {
    const quitar = (cookie: string, id: string, ventaIds: string[]) =>
      request(app.getHttpServer()).post(`/facturas/${id}/quitar`).set('Cookie', cookie).send({ ventaIds });

    it('quitar algunas las regresa a pendiente y la factura sigue', async () => {
      const v1 = await sembrarVenta(clienteA);
      const v2 = await sembrarVenta(clienteA);
      const f = (await asignar(cookieGeneral, { clienteId: clienteA, numero: numero(), ventaIds: [v1.id, v2.id] }).expect(201)).body as FacturaConVentas;
      const res = await quitar(cookieGeneral, f.id, [v1.id]).expect(200);
      expect((res.body as { factura: FacturaConVentas }).factura.ventas.map((v) => v.id)).toEqual([v2.id]);
      const fila = await ventaPorId(v1.id);
      expect(fila).toMatchObject({ factura: 'pendiente', factura_id: null, factura_asignada_por_usuario_id: null });
    });

    it('quitar todas borra la factura', async () => {
      const v = await sembrarVenta(clienteA);
      const f = (await asignar(cookieGeneral, { clienteId: clienteA, numero: numero(), ventaIds: [v.id] }).expect(201)).body as FacturaConVentas;
      const res = await quitar(cookieGeneral, f.id, [v.id]).expect(200);
      expect(res.body).toEqual({ factura: null });
      expect(await db.selectFrom('factura').select('id').where('id', '=', f.id).executeTakeFirst()).toBeUndefined();
    });

    it('una venta que no es de esa factura es 409 y nada cambia', async () => {
      const v1 = await sembrarVenta(clienteA);
      const v2 = await sembrarVenta(clienteA);
      const f = (await asignar(cookieGeneral, { clienteId: clienteA, numero: numero(), ventaIds: [v1.id] }).expect(201)).body as FacturaConVentas;
      const res = await quitar(cookieGeneral, f.id, [v1.id, v2.id]).expect(409);
      expect((res.body as { message: string }).message).toContain('no está en la factura');
      expect((await ventaPorId(v1.id)).factura).toBe('facturada');
    });

    it('Review Focus 4: un usuario de TJ no quita ventas de una factura de MX', async () => {
      const v = await sembrarVenta(clienteMx);
      const f = (await asignar(cookieGeneral, { clienteId: clienteMx, numero: numero(), ventaIds: [v.id] }).expect(201)).body as FacturaConVentas;
      await quitar(cookieTijuana, f.id, [v.id]).expect(403);
    });
  });

  describe('buscar', () => {
    it('por numero (sin mayusculas ni espacios) y por cliente', async () => {
      const v = await sembrarVenta(clienteB);
      const n = numero();
      const f = (await asignar(cookieGeneral, { clienteId: clienteB, numero: n, ventaIds: [v.id] }).expect(201)).body as FacturaConVentas;
      const porNumero = await request(app.getHttpServer())
        .get(`/facturas?numero=${encodeURIComponent(` ${n.toLowerCase()} `)}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((porNumero.body as FacturaConVentas[]).map((x) => x.id)).toEqual([f.id]);
      const porCliente = await request(app.getHttpServer())
        .get(`/facturas?clienteId=${clienteB}`)
        .set('Cookie', cookieGeneral)
        .expect(200);
      expect((porCliente.body as FacturaConVentas[]).map((x) => x.id)).toContain(f.id);
    });

    it('sin numero ni cliente es 400', async () => {
      await request(app.getHttpServer()).get('/facturas').set('Cookie', cookieGeneral).expect(400);
    });

    it('Review Focus 4: un usuario de TJ no ve facturas de MX', async () => {
      const v = await sembrarVenta(clienteMx);
      const n = numero();
      await asignar(cookieGeneral, { clienteId: clienteMx, numero: n, ventaIds: [v.id] }).expect(201);
      const res = await request(app.getHttpServer())
        .get(`/facturas?numero=${encodeURIComponent(n)}`)
        .set('Cookie', cookieTijuana)
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });
});
```

- [ ] **Paso 11: Correr las e2e**

Run: `npm run test:e2e --workspace=apps/backend -- facturas`
Expected: PASS todas. Luego la suite completa: `npm run test:e2e --workspace=apps/backend` → PASS.

- [ ] **Paso 12: Commit**

```bash
git add apps/backend/src/modules/ventas-cobranza apps/backend/test/facturas.e2e-spec.ts
git commit -m "T-19: endpoints para asignar, buscar, renombrar y quitar facturas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: Portal — tipos, cliente de API y la factura en el detalle de la venta

**Archivos:**
- Crear: `apps/portal/src/lib/facturas.ts`
- Crear: `apps/portal/src/lib/facturas.test.ts`
- Modificar: `apps/portal/src/lib/ventas.ts` (`VentaDetalle`, `condicionesDeVenta`)
- Modificar: `apps/portal/src/lib/ventas.test.ts`
- Modificar: `apps/portal/src/components/ventas/detalle-venta.tsx`
- Modificar: `apps/portal/src/components/ventas/detalle-venta.test.tsx`
- Modificar: `apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx` (descripción del permiso)

**Interfaces:**
- Consume: endpoints de la Tarea 3; `VentaDetalle.facturaNumero` de la Tarea 2.
- Produce (`lib/facturas.ts`):

```ts
export interface VentaDeFactura { id: string; folio: string; fecha: string; numNota: string | null; montoCentavos: number; status: StatusVenta; }
export interface VentaPorFacturar extends VentaDeFactura { factura: "N/A" | "pendiente"; }
export interface FacturaConVentas { id: string; numero: string; clienteId: string; cliente: string; sucursalCodigo: string; creadoPor: string; creadoEn: string; totalCentavos: number; ventas: VentaDeFactura[]; }
export function listarPorFacturar(clienteId: string, incluirNA: boolean): Promise<VentaPorFacturar[]>;
export function asignarFactura(clienteId: string, numero: string, ventaIds: string[]): Promise<FacturaConVentas>;
export function buscarFacturas(filtro: { numero?: string; clienteId?: string; sucursal: string | null }): Promise<FacturaConVentas[]>;
export function renombrarFactura(id: string, numero: string): Promise<FacturaConVentas>;
export function quitarDeFactura(id: string, ventaIds: string[]): Promise<{ factura: FacturaConVentas | null }>;
export function totalSeleccionado(ventas: VentaDeFactura[], seleccion: ReadonlySet<string>): number;
```

- [ ] **Paso 1: Prueba que falla** — `lib/facturas.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  asignarFactura,
  buscarFacturas,
  listarPorFacturar,
  quitarDeFactura,
  renombrarFactura,
  totalSeleccionado,
} from "./facturas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

describe("lib/facturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue([]);
  });

  it("arma las rutas y los cuerpos", async () => {
    await listarPorFacturar("c1", true);
    expect(apiFetch).toHaveBeenCalledWith("/facturas/por-facturar?clienteId=c1&incluirNA=true");
    await asignarFactura("c1", "A780", ["v1", "v2"]);
    expect(apiFetch).toHaveBeenCalledWith("/facturas/asignar", {
      method: "POST",
      body: JSON.stringify({ clienteId: "c1", numero: "A780", ventaIds: ["v1", "v2"] }),
    });
    await buscarFacturas({ numero: " A780 ", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith("/facturas?numero=A780&sucursal=TJ");
    await renombrarFactura("f1", "A781");
    expect(apiFetch).toHaveBeenCalledWith("/facturas/f1", {
      method: "PATCH",
      body: JSON.stringify({ numero: "A781" }),
    });
    await quitarDeFactura("f1", ["v1"]);
    expect(apiFetch).toHaveBeenCalledWith("/facturas/f1/quitar", {
      method: "POST",
      body: JSON.stringify({ ventaIds: ["v1"] }),
    });
  });

  it("suma solo lo seleccionado", () => {
    const ventas = [
      { id: "v1", folio: "A", fecha: "2024-04-01", numNota: null, montoCentavos: 1000, status: "pendiente" as const },
      { id: "v2", folio: "B", fecha: "2024-04-02", numNota: null, montoCentavos: 550, status: "pendiente" as const },
    ];
    expect(totalSeleccionado(ventas, new Set(["v2"]))).toBe(550);
  });
});
```

> Si el resto de `lib/*.test.ts` mockea `apiFetch` de otra forma, copia esa forma.

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- facturas`
Expected: FAIL (no existe `./facturas`).

- [ ] **Paso 3: Implementar `lib/facturas.ts`**

```ts
import { apiFetch } from "./api";
import type { StatusVenta } from "./ventas";

// Copia normativa de las formas de
// apps/backend/src/modules/ventas-cobranza/facturas.repository.ts
// (`VentaDeFactura`, `VentaPorFacturar`, `FacturaConVentas`) y de
// dto/facturas.dto.ts. Mismo trato que lib/ventas.ts: un cambio de forma en un
// lado exige el equivalente en el otro.

export interface VentaDeFactura {
  id: string;
  folio: string;
  fecha: string;
  numNota: string | null;
  montoCentavos: number;
  status: StatusVenta;
}

export interface VentaPorFacturar extends VentaDeFactura {
  factura: "N/A" | "pendiente";
}

export interface FacturaConVentas {
  id: string;
  numero: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  creadoPor: string;
  creadoEn: string;
  totalCentavos: number;
  ventas: VentaDeFactura[];
}

export const LARGO_MAX_NUMERO_FACTURA = 30;

export function listarPorFacturar(clienteId: string, incluirNA: boolean): Promise<VentaPorFacturar[]> {
  const params = new URLSearchParams({ clienteId });
  if (incluirNA) params.set("incluirNA", "true");
  return apiFetch<VentaPorFacturar[]>(`/facturas/por-facturar?${params.toString()}`);
}

export function asignarFactura(
  clienteId: string,
  numero: string,
  ventaIds: string[],
): Promise<FacturaConVentas> {
  return apiFetch<FacturaConVentas>("/facturas/asignar", {
    method: "POST",
    body: JSON.stringify({ clienteId, numero, ventaIds }),
  });
}

export function buscarFacturas(filtro: {
  numero?: string;
  clienteId?: string;
  sucursal: string | null;
}): Promise<FacturaConVentas[]> {
  const params = new URLSearchParams();
  const numero = filtro.numero?.trim();
  if (numero) params.set("numero", numero);
  if (filtro.clienteId) params.set("clienteId", filtro.clienteId);
  if (filtro.sucursal) params.set("sucursal", filtro.sucursal);
  return apiFetch<FacturaConVentas[]>(`/facturas?${params.toString()}`);
}

export function renombrarFactura(id: string, numero: string): Promise<FacturaConVentas> {
  return apiFetch<FacturaConVentas>(`/facturas/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ numero }),
  });
}

export function quitarDeFactura(
  id: string,
  ventaIds: string[],
): Promise<{ factura: FacturaConVentas | null }> {
  return apiFetch<{ factura: FacturaConVentas | null }>(`/facturas/${encodeURIComponent(id)}/quitar`, {
    method: "POST",
    body: JSON.stringify({ ventaIds }),
  });
}

export function totalSeleccionado(ventas: VentaDeFactura[], seleccion: ReadonlySet<string>): number {
  return ventas.reduce((t, v) => (seleccion.has(v.id) ? t + v.montoCentavos : t), 0);
}
```

- [ ] **Paso 4: `VentaDetalle` y `condicionesDeVenta` en `lib/ventas.ts`**

En `VentaDetalle` agrega, después de `factura: string;`:

```ts
  /** El número cuando `factura === "facturada"` (T-19). */
  facturaNumero: string | null;
```

`condicionesDeVenta` ya no convierte valores desconocidos a `N/A` por accidente: una venta facturada no
llega a la edición (el servidor la marca `editable: false`), así que basta con dejar explícito el caso:

```ts
    // "facturada" nunca llega aquí: el servidor no deja editarla (T-19).
    factura: venta.factura === "pendiente" ? "pendiente" : "N/A",
```

(Solo cambia el comentario; la expresión ya es esa. Agrega a `ventas.test.ts` una prueba de que
`condicionesDeVenta` con `factura: "pendiente"` da `"pendiente"`, si no existe.)

Agrega `facturaNumero: null` a todos los objetos `VentaDetalle` de prueba (`detalle-venta.test.tsx`,
`formulario-editar-venta.test.tsx`, `pantalla-ventas.test.tsx`, `ventas.test.ts`) para que compilen.

- [ ] **Paso 5: Detalle de venta**

En `detalle-venta.test.tsx`:

```tsx
  it("una venta facturada muestra su número", () => {
    renderizar({ ...VENTA, factura: "facturada", facturaNumero: "A780", editable: false,
      motivoNoEditable: "Esta venta está en la factura A780: quítala primero de la factura para editarla o eliminarla." });
    expect(screen.getByText("Facturada · A780")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByText(/quítala primero de la factura/)).toBeInTheDocument();
  });
```

En `detalle-venta.tsx`, cambia la línea de la factura:

```tsx
          <Dato
            etiqueta="Factura"
            valor={venta.facturaNumero ? `Facturada · ${venta.facturaNumero}` : venta.factura}
          />
```

- [ ] **Paso 6: Descripción del permiso**

En `matriz-permisos-usuario.tsx`, junto a `"venta.editar_eliminar"`:

```ts
  "venta.asignar_factura":
    "Puede anotar el número de factura del SAT en las ventas, corregirlo o quitarlo.",
```

- [ ] **Paso 7: Correr pruebas, lint y tipos del portal**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npx tsc --noEmit -p apps/portal`
Expected: todo en verde.

- [ ] **Paso 8: Commit**

```bash
git add apps/portal/src/lib apps/portal/src/components/ventas apps/portal/src/components/usuarios/matriz-permisos-usuario.tsx
git commit -m "T-19: portal — cliente de API de facturas y la factura en el detalle de la venta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: Portal — pantalla "Facturas": asignar

**Archivos:**
- Crear: `apps/portal/src/app/(portal)/operacion/facturas/page.tsx`
- Crear: `apps/portal/src/components/facturas/pantalla-facturas.tsx` (pestañas Asignar / Buscar)
- Crear: `apps/portal/src/components/facturas/asignar-factura.tsx`
- Crear: `apps/portal/src/components/facturas/asignar-factura.test.tsx`
- Modificar: `apps/portal/src/components/layout/nav-config.ts`

**Interfaces:**
- Consume: `lib/facturas.ts` (Tarea 4); `listarClientes(sucursal, "todos")` de `lib/clientes`;
  `BuscadorCliente` de `components/ventas/buscador-cliente`; `formatearPesos`, `ETIQUETA_STATUS` de
  `lib/ventas`; `useAuth().puede`; `ErrorApi` de `lib/api`.
- Produce: `PantallaFacturas({ sucursal }: { sucursal: string | null })` con pestañas
  `"Asignar"` y `"Buscar y corregir"`; `AsignarFactura({ sucursal })`. La pestaña de buscar la implementa
  la Tarea 6 (`BuscarFacturas({ sucursal })`); en esta tarea, deja la pestaña con un `<p>` "Próximamente"
  **solo hasta la Tarea 6**.

- [ ] **Paso 1: Pruebas que fallan** — `asignar-factura.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as facturasLib from "@/lib/facturas";
import type { VentaPorFacturar } from "@/lib/facturas";
import { AsignarFactura } from "./asignar-factura";

vi.mock("@/lib/clientes");
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, listarPorFacturar: vi.fn(), asignarFactura: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const listarPorFacturar = vi.mocked(facturasLib.listarPorFacturar);
const asignarFactura = vi.mocked(facturasLib.asignarFactura);

const CLIENTE: ClienteResumen = {
  id: "c1", nombre: "Cobach XXI", telefono: "664", tipo: "cliente", tipoNegocio: null, sucursalCodigo: "TJ",
};
const VENTAS: VentaPorFacturar[] = [
  { id: "v1", folio: "TJ240401OF01", fecha: "2024-04-01", numNota: null, montoCentavos: 10000, status: "pendiente", factura: "pendiente" },
  { id: "v2", folio: "TJ240402OF01", fecha: "2024-04-02", numNota: "77", montoCentavos: 5050, status: "abonado", factura: "pendiente" },
];

async function elegirCliente() {
  const usuario = userEvent.setup();
  render(<AsignarFactura sucursal={null} />);
  await usuario.type(screen.getByLabelText("Cliente"), "coba");
  await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
  await screen.findByText("TJ240401OF01");
  return usuario;
}

describe("AsignarFactura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    listarClientes.mockResolvedValue([CLIENTE]);
    listarPorFacturar.mockResolvedValue(VENTAS);
    asignarFactura.mockResolvedValue({
      id: "f1", numero: "A780", clienteId: "c1", cliente: "Cobach XXI", sucursalCodigo: "TJ",
      creadoPor: "Ana", creadoEn: "2026-10-07 10:00", totalCentavos: 15050, ventas: VENTAS,
    });
  });

  it("lista las pendientes del cliente; la casilla N/A vuelve a pedir con incluirNA", async () => {
    const usuario = await elegirCliente();
    expect(listarPorFacturar).toHaveBeenCalledWith("c1", false);
    await usuario.click(screen.getByLabelText("Mostrar también las N/A"));
    await waitFor(() => expect(listarPorFacturar).toHaveBeenCalledWith("c1", true));
  });

  it("marca, muestra el total y asigna con el número tecleado", async () => {
    const usuario = await elegirCliente();
    const grabar = screen.getByRole("button", { name: "Asignar" });
    expect(grabar).toBeDisabled();
    await usuario.click(screen.getByLabelText("Seleccionar todas"));
    expect(screen.getByText("Total marcado: $150.50")).toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Número de factura"), " A780 ");
    await usuario.click(grabar);
    expect(asignarFactura).toHaveBeenCalledWith("c1", "A780", ["v1", "v2"]);
    expect(await screen.findByRole("status")).toHaveTextContent("Factura A780 asignada a 2 ventas ($150.50)");
  });

  it("muestra el mensaje del servidor", async () => {
    asignarFactura.mockRejectedValue(new ErrorApi("x", 409, "La factura A780 ya está asignada a Otra."));
    const usuario = await elegirCliente();
    await usuario.click(screen.getByLabelText("Marcar TJ240401OF01"));
    await usuario.type(screen.getByLabelText("Número de factura"), "A780");
    await usuario.click(screen.getByRole("button", { name: "Asignar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La factura A780 ya está asignada a Otra.");
  });

  it("sin ventas por facturar lo dice", async () => {
    listarPorFacturar.mockResolvedValue([]);
    const usuario = userEvent.setup();
    render(<AsignarFactura sucursal={null} />);
    await usuario.type(screen.getByLabelText("Cliente"), "coba");
    await usuario.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(await screen.findByText("Este cliente no tiene ventas por facturar.")).toBeInTheDocument();
  });

  it("sin el permiso no se puede asignar", async () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => false });
    render(<AsignarFactura sucursal={null} />);
    expect(screen.getByText("No tienes permiso para asignar facturas.")).toBeInTheDocument();
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- asignar-factura`
Expected: FAIL (no existe el componente).

- [ ] **Paso 3: Implementar `asignar-factura.tsx`**

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  LARGO_MAX_NUMERO_FACTURA,
  asignarFactura,
  listarPorFacturar,
  totalSeleccionado,
  type VentaPorFacturar,
} from "@/lib/facturas";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/**
 * Asignar factura a notas de ventas (T-19, §5.1 del spec): cliente → marcar
 * ventas → teclear el número del SAT. El servidor decide si se puede; aquí solo
 * se arma la selección.
 */
export function AsignarFactura({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [incluirNA, setIncluirNA] = useState(false);
  const [ventas, setVentas] = useState<VentaPorFacturar[]>([]);
  const [cargada, setCargada] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [numero, setNumero] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo asignar la factura.");

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => vigente && setClientes(lista))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  useEffect(() => {
    if (!cliente) return;
    let vigente = true;
    setCargada(false);
    listarPorFacturar(cliente.id, incluirNA)
      .then((lista) => {
        if (!vigente) return;
        setVentas(lista);
        setSeleccion(new Set());
        setCargada(true);
      })
      .catch(() => vigente && setCargada(true));
    return () => {
      vigente = false;
    };
  }, [cliente, incluirNA, recarga]);

  if (!puede("venta.asignar_factura")) {
    return <p className="text-sm text-muted-foreground">No tienes permiso para asignar facturas.</p>;
  }

  const total = totalSeleccionado(ventas, seleccion);
  const todas = ventas.length > 0 && seleccion.size === ventas.length;

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!cliente) return;
    const ids = ventas.filter((v) => seleccion.has(v.id)).map((v) => v.id);
    await enviar(
      async () => {
        const factura = await asignarFactura(cliente.id, numero.trim(), ids);
        setAviso(
          `Factura ${factura.numero} asignada a ${ids.length} ${ids.length === 1 ? "venta" : "ventas"} (${formatearPesos(total)})`,
        );
        setNumero("");
        setRecarga((n) => n + 1);
      },
      () => {},
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <BuscadorCliente
        clientes={clientes}
        cliente={cliente}
        onElegir={(c) => {
          setCliente(c);
          setAviso(null);
        }}
        onQuitar={() => {
          setCliente(null);
          setVentas([]);
          setSeleccion(new Set());
        }}
        disabled={enviando}
      />

      {aviso && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {aviso}
        </p>
      )}

      {cliente && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={incluirNA}
              onChange={(e) => setIncluirNA(e.target.checked)}
              disabled={enviando}
            />
            Mostrar también las N/A
          </label>

          {cargada && ventas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente no tiene ventas por facturar.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1.5">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todas"
                      checked={todas}
                      onChange={() => setSeleccion(todas ? new Set() : new Set(ventas.map((v) => v.id)))}
                      disabled={enviando}
                    />
                  </th>
                  <th className="py-1.5">Fecha</th>
                  <th className="py-1.5">Folio</th>
                  <th className="py-1.5"># de nota</th>
                  <th className="py-1.5 text-right">Monto</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5">Factura</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Marcar ${v.folio}`}
                        checked={seleccion.has(v.id)}
                        onChange={() => alternar(v.id)}
                        disabled={enviando}
                      />
                    </td>
                    <td className="py-1.5">{v.fecha}</td>
                    <td className="py-1.5 font-mono">{v.folio}</td>
                    <td className="py-1.5">{v.numNota ?? "—"}</td>
                    <td className="py-1.5 text-right">{formatearPesos(v.montoCentavos)}</td>
                    <td className="py-1.5">{ETIQUETA_STATUS[v.status]}</td>
                    <td className="py-1.5">{v.factura}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="text-right text-base font-semibold">Total marcado: {formatearPesos(total)}</p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="numero-factura" className="text-sm font-medium">
                Número de factura
              </label>
              <input
                id="numero-factura"
                maxLength={LARGO_MAX_NUMERO_FACTURA}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                disabled={enviando}
                className="w-48 rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" disabled={enviando || seleccion.size === 0 || numero.trim() === ""}>
              {enviando ? "Asignando…" : "Asignar"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
```

> `useEnvioFormulario(mensaje)` devuelve `{ enviando, error, enviar }` y ya convierte un `ErrorApi` con
> `mensajeApi` en `error` (así lo usa `pantalla-registrar-venta.tsx`). Si su firma difiere, sigue la de
> ese archivo.

- [ ] **Paso 4: Pantalla con pestañas, página y menú**

`components/facturas/pantalla-facturas.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AsignarFactura } from "./asignar-factura";

/** Operación → Facturas (T-19): asignar, y buscar y corregir. */
export function PantallaFacturas({ sucursal }: { sucursal: string | null }) {
  const [pestana, setPestana] = useState<"asignar" | "buscar">("asignar");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Facturas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="tablist" className="flex gap-2">
          <button
            role="tab"
            aria-selected={pestana === "asignar"}
            onClick={() => setPestana("asignar")}
            className={`rounded-md border px-3 py-1.5 text-sm ${pestana === "asignar" ? "bg-muted font-medium" : ""}`}
          >
            Asignar
          </button>
          <button
            role="tab"
            aria-selected={pestana === "buscar"}
            onClick={() => setPestana("buscar")}
            className={`rounded-md border px-3 py-1.5 text-sm ${pestana === "buscar" ? "bg-muted font-medium" : ""}`}
          >
            Buscar y corregir
          </button>
        </div>
        {pestana === "asignar" ? (
          <AsignarFactura sucursal={sucursal} />
        ) : (
          <p className="text-sm text-muted-foreground">Próximamente.</p>
        )}
      </CardContent>
    </Card>
  );
}
```

`app/(portal)/operacion/facturas/page.tsx`:

```tsx
import { PantallaFacturas } from "@/components/facturas/pantalla-facturas";

// Server component delgado (mismo patron que /operacion/ventas).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal } = await searchParams;
  return <PantallaFacturas sucursal={sucursal ?? null} />;
}
```

`nav-config.ts`, después de `{ label: "Ventas", href: "/operacion/ventas" },`:

```ts
      { label: "Facturas", href: "/operacion/facturas" },
```

- [ ] **Paso 5: Correr pruebas, lint y tipos**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npx tsc --noEmit -p apps/portal`
Expected: todo en verde.

- [ ] **Paso 6: Commit**

```bash
git add apps/portal/src/app/'(portal)'/operacion/facturas apps/portal/src/components/facturas apps/portal/src/components/layout/nav-config.ts
git commit -m "T-19: portal — pantalla Facturas: asignar el número a varias ventas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: Portal — "Buscar y corregir": cambiar número y quitar ventas

**Archivos:**
- Crear: `apps/portal/src/components/facturas/buscar-facturas.tsx`
- Crear: `apps/portal/src/components/facturas/buscar-facturas.test.tsx`
- Modificar: `apps/portal/src/components/facturas/pantalla-facturas.tsx` (quita el "Próximamente")

**Interfaces:**
- Consume: `buscarFacturas`, `renombrarFactura`, `quitarDeFactura`, `FacturaConVentas` (Tarea 4);
  `BuscadorCliente`, `listarClientes`, `formatearPesos`, `useAuth`, `ErrorApi`.
- Produce: `BuscarFacturas({ sucursal }: { sucursal: string | null })`.

- [ ] **Paso 1: Pruebas que fallan** — `buscar-facturas.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import * as facturasLib from "@/lib/facturas";
import type { FacturaConVentas } from "@/lib/facturas";
import { BuscarFacturas } from "./buscar-facturas";

vi.mock("@/lib/clientes");
vi.mock("@/lib/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturas")>();
  return { ...real, buscarFacturas: vi.fn(), renombrarFactura: vi.fn(), quitarDeFactura: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const buscarFacturas = vi.mocked(facturasLib.buscarFacturas);
const renombrarFactura = vi.mocked(facturasLib.renombrarFactura);
const quitarDeFactura = vi.mocked(facturasLib.quitarDeFactura);

const FACTURA: FacturaConVentas = {
  id: "f1", numero: "A708", clienteId: "c1", cliente: "Cobach XXI", sucursalCodigo: "TJ",
  creadoPor: "Ana", creadoEn: "2026-10-07 10:00", totalCentavos: 15050,
  ventas: [
    { id: "v1", folio: "TJ240401OF01", fecha: "2024-04-01", numNota: null, montoCentavos: 10000, status: "pendiente" },
    { id: "v2", folio: "TJ240402OF01", fecha: "2024-04-02", numNota: null, montoCentavos: 5050, status: "pendiente" },
  ],
};

async function buscarA708() {
  const usuario = userEvent.setup();
  render(<BuscarFacturas sucursal={null} />);
  await usuario.type(screen.getByLabelText("Número de factura a buscar"), "a708");
  await usuario.click(screen.getByRole("button", { name: "Buscar" }));
  await screen.findByText("Factura A708");
  return usuario;
}

describe("BuscarFacturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([]);
    buscarFacturas.mockResolvedValue([FACTURA]);
  });

  it("busca por número y muestra cliente, ventas y total", async () => {
    await buscarA708();
    expect(buscarFacturas).toHaveBeenCalledWith({ numero: "a708", clienteId: undefined, sucursal: null });
    const tarjeta = screen.getByRole("region", { name: "Factura A708" });
    expect(within(tarjeta).getByText(/Cobach XXI/)).toBeInTheDocument();
    expect(within(tarjeta).getByText("Total: $150.50")).toBeInTheDocument();
  });

  it("cambia el número", async () => {
    renombrarFactura.mockResolvedValue({ ...FACTURA, numero: "A780" });
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    expect(renombrarFactura).toHaveBeenCalledWith("f1", "A780");
    expect(await screen.findByText("Factura A780")).toBeInTheDocument();
  });

  it("quita ventas con confirmación", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    quitarDeFactura.mockResolvedValue({ factura: { ...FACTURA, ventas: [FACTURA.ventas[1]], totalCentavos: 5050 } });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    expect(quitarDeFactura).toHaveBeenCalledWith("f1", ["v1"]);
    expect(await screen.findByText("Total: $50.50")).toBeInTheDocument();
  });

  it("si se quitan todas, la factura desaparece y se avisa", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    quitarDeFactura.mockResolvedValue({ factura: null });
    const usuario = await buscarA708();
    await usuario.click(screen.getByLabelText("Quitar TJ240401OF01"));
    await usuario.click(screen.getByLabelText("Quitar TJ240402OF01"));
    await usuario.click(screen.getByRole("button", { name: "Quitar de la factura" }));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("la factura A708 desaparece"));
    expect(await screen.findByRole("status")).toHaveTextContent("La factura A708 se borró: ya no tenía ventas.");
    expect(screen.queryByText("Factura A708")).not.toBeInTheDocument();
  });

  it("muestra el mensaje del servidor al renombrar", async () => {
    renombrarFactura.mockRejectedValue(new ErrorApi("x", 409, "La factura A780 ya está asignada a Otra."));
    const usuario = await buscarA708();
    const campo = screen.getByLabelText("Nuevo número de A708");
    await usuario.clear(campo);
    await usuario.type(campo, "A780");
    await usuario.click(screen.getByRole("button", { name: "Guardar número" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La factura A780 ya está asignada a Otra.");
  });

  it("sin resultados lo dice", async () => {
    buscarFacturas.mockResolvedValue([]);
    const usuario = userEvent.setup();
    render(<BuscarFacturas sucursal={null} />);
    await usuario.type(screen.getByLabelText("Número de factura a buscar"), "Z1");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("No se encontraron facturas.")).toBeInTheDocument();
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npm test --workspace=apps/portal -- buscar-facturas`
Expected: FAIL.

- [ ] **Paso 3: Implementar `buscar-facturas.tsx`**

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { ErrorApi } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  LARGO_MAX_NUMERO_FACTURA,
  buscarFacturas,
  quitarDeFactura,
  renombrarFactura,
  type FacturaConVentas,
} from "@/lib/facturas";
import { formatearPesos } from "@/lib/ventas";

const mensajeDe = (err: unknown, porDefecto: string) =>
  err instanceof ErrorApi && err.mensajeApi ? err.mensajeApi : porDefecto;

/** Buscar facturas por número o cliente, cambiar su número o quitarle ventas (T-19, §5.2). */
export function BuscarFacturas({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [facturas, setFacturas] = useState<FacturaConVentas[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => vigente && setClientes(lista))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  if (!puede("venta.asignar_factura")) {
    return <p className="text-sm text-muted-foreground">No tienes permiso para asignar facturas.</p>;
  }

  async function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    if (numero.trim() === "" && !cliente) {
      setError("Escribe un número de factura o elige un cliente.");
      return;
    }
    try {
      setFacturas(
        await buscarFacturas({
          numero: numero.trim() || undefined,
          clienteId: cliente?.id,
          sucursal,
        }),
      );
    } catch (err) {
      setError(mensajeDe(err, "No se pudieron buscar las facturas."));
    }
  }

  function reemplazar(id: string, nueva: FacturaConVentas | null) {
    setFacturas((actual) =>
      (actual ?? []).flatMap((f) => (f.id !== id ? [f] : nueva ? [nueva] : [])),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={alBuscar} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="buscar-numero-factura" className="text-sm font-medium">
            Número de factura a buscar
          </label>
          <input
            id="buscar-numero-factura"
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="w-48 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <BuscadorCliente
          clientes={clientes}
          cliente={cliente}
          onElegir={setCliente}
          onQuitar={() => setCliente(null)}
          etiquetaQuitar="Quitar"
        />
        <Button type="submit">Buscar</Button>
      </form>

      {aviso && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {facturas !== null && facturas.length === 0 && (
        <p className="text-sm text-muted-foreground">No se encontraron facturas.</p>
      )}

      {(facturas ?? []).map((f) => (
        <TarjetaFactura
          key={f.id}
          factura={f}
          onCambiada={(nueva) => reemplazar(f.id, nueva)}
          onBorrada={() => {
            reemplazar(f.id, null);
            setAviso(`La factura ${f.numero} se borró: ya no tenía ventas.`);
          }}
          onError={setError}
        />
      ))}
    </div>
  );
}

function TarjetaFactura({
  factura,
  onCambiada,
  onBorrada,
  onError,
}: {
  factura: FacturaConVentas;
  onCambiada: (f: FacturaConVentas) => void;
  onBorrada: () => void;
  onError: (mensaje: string | null) => void;
}) {
  const [nuevoNumero, setNuevoNumero] = useState(factura.numero);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const titulo = `Factura ${factura.numero}`;

  async function guardarNumero() {
    onError(null);
    setEnviando(true);
    try {
      const nueva = await renombrarFactura(factura.id, nuevoNumero.trim());
      onCambiada(nueva);
    } catch (err) {
      onError(mensajeDe(err, "No se pudo cambiar el número."));
    } finally {
      setEnviando(false);
    }
  }

  async function quitar() {
    const todas = marcadas.size === factura.ventas.length;
    const pregunta = todas
      ? `¿Quitar todas las ventas? Regresan a "pendiente" y la factura ${factura.numero} desaparece.`
      : `¿Quitar ${marcadas.size} ${marcadas.size === 1 ? "venta" : "ventas"} de la factura ${factura.numero}? Regresan a "pendiente".`;
    if (!window.confirm(pregunta)) return;
    onError(null);
    setEnviando(true);
    try {
      const { factura: nueva } = await quitarDeFactura(factura.id, [...marcadas]);
      setMarcadas(new Set());
      if (nueva) onCambiada(nueva);
      else onBorrada();
    } catch (err) {
      onError(mensajeDe(err, "No se pudieron quitar las ventas."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-label={titulo} className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{titulo}</h3>
        <p className="text-sm text-muted-foreground">
          {factura.cliente} · {factura.sucursalCodigo} · registró {factura.creadoPor} el {factura.creadoEn}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`renombrar-${factura.id}`} className="text-sm font-medium">
            Nuevo número de {factura.numero}
          </label>
          <input
            id={`renombrar-${factura.id}`}
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={nuevoNumero}
            onChange={(e) => setNuevoNumero(e.target.value)}
            disabled={enviando}
            className="w-48 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <Button
          variant="outline"
          onClick={guardarNumero}
          disabled={enviando || nuevoNumero.trim() === "" || nuevoNumero.trim() === factura.numero}
        >
          Guardar número
        </Button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-1.5" />
            <th className="py-1.5">Fecha</th>
            <th className="py-1.5">Folio</th>
            <th className="py-1.5"># de nota</th>
            <th className="py-1.5 text-right">Monto</th>
          </tr>
        </thead>
        <tbody>
          {factura.ventas.map((v) => (
            <tr key={v.id} className="border-t">
              <td className="py-1.5">
                <input
                  type="checkbox"
                  aria-label={`Quitar ${v.folio}`}
                  checked={marcadas.has(v.id)}
                  onChange={() =>
                    setMarcadas((actual) => {
                      const nueva = new Set(actual);
                      if (nueva.has(v.id)) nueva.delete(v.id);
                      else nueva.add(v.id);
                      return nueva;
                    })
                  }
                  disabled={enviando}
                />
              </td>
              <td className="py-1.5">{v.fecha}</td>
              <td className="py-1.5 font-mono">{v.folio}</td>
              <td className="py-1.5">{v.numNota ?? "—"}</td>
              <td className="py-1.5 text-right">{formatearPesos(v.montoCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Total: {formatearPesos(factura.totalCentavos)}</p>
        <Button variant="destructive" onClick={quitar} disabled={enviando || marcadas.size === 0}>
          Quitar de la factura
        </Button>
      </div>
    </section>
  );
}
```

> Al renombrar con éxito, `key={f.id}` no cambia, así que `nuevoNumero` conserva el texto tecleado (ya
> igual al número nuevo). Correcto.

- [ ] **Paso 4: Usarla en la pantalla**

En `pantalla-facturas.tsx`, importa `BuscarFacturas` y reemplaza el `<p>Próximamente.</p>` por
`<BuscarFacturas sucursal={sucursal} />`.

- [ ] **Paso 5: Correr pruebas, lint y tipos**

Run: `npm test --workspace=apps/portal && npm run lint --workspace=apps/portal && npx tsc --noEmit -p apps/portal`
Expected: todo en verde.

- [ ] **Paso 6: Commit**

```bash
git add apps/portal/src/components/facturas
git commit -m "T-19: portal — buscar facturas, cambiar su número y quitar ventas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: Verificación completa, prueba a mano y documentación

**Archivos:**
- Modificar: `CLAUDE.md` (sección de ventas del portal)
- Vault (`../jawa-obsidian-memory`): `10-Dominio/Entidades/Venta-Nota.md`, `10-Dominio/Reglas/Status de venta.md`,
  `10-Dominio/Modulos/Ventas y Cobranza.md`, `00-Inicio/Estado del proyecto.md`, `40-Equipo/Bitácora/2026-10-07.md`

- [ ] **Paso 1: Suite completa**

Run:
```
npm run lint --workspace=apps/backend && npm run build --workspace=apps/backend
npm test --workspace=apps/backend && npm run test:e2e --workspace=apps/backend
npm run supabase -- test db
npm test --workspace=apps/portal && npm run lint --workspace=apps/portal
npm run typecheck --workspace=apps/tablet && npm test --workspace=apps/tablet
```
Expected: todo en verde. Anota los conteos para el PR.

- [ ] **Paso 2: Prueba a mano contra el Postgres LOCAL**

`.env.development` apunta a la nube: para esta prueba usa `DATABASE_URL` del `.env.test` (local). En la
Mac de Roberto el puerto 3000 está ocupado: `PORT=3010` para el backend y `NEXT_PUBLIC_API_URL` al 3010.
Con un usuario Administrador General: registrar 2 ventas a crédito con factura "pendiente" a un cliente,
ir a *Operación → Facturas*, asignar `A780` a las dos, comprobar el total; en *Ventas* ver "Facturada ·
A780" y que no aparecen Editar/Eliminar; en *Buscar y corregir* cambiar a `A781` y quitar una (vuelve a
"pendiente"), luego la otra (la factura desaparece). Captura de pantalla de la pantalla de asignar.

- [ ] **Paso 3: `CLAUDE.md`**

Después del bloque "Toda corrección de una venta va por el portal (T-17, parte 2)", agrega:

```markdown
- **Facturas (T-19).** La factura se hace en el programa del SAT, **fuera** de JAWA; aquí solo se anota su
  número. Tabla `factura` (número único sin mayúsculas/espacios, de **un** cliente) y
  `venta_nota.factura` en `N/A` / `pendiente` / `facturada`; `facturada` ⇔ `factura_id` (check), y la
  llave compuesta `(factura_id, cliente_id)` impide apuntar a la factura de otro cliente. Endpoints en
  `ventas-cobranza/facturas.*` con el permiso `venta.asignar_factura`. Una venta **facturada no se edita
  ni se elimina** (`bloqueoDeEdicion`): primero se quita de la factura. Quitar la última venta borra la
  factura. La tablet solo manda `N/A`/`pendiente` y no recibe nada de esto.
```

- [ ] **Paso 4: Vault**

- `Venta-Nota.md`: en la fila "Factura" de la tabla de campos, "`N/A` (default) | `pendiente` | `facturada`
  (con su número en la tabla `factura`, T-19)"; agregar un `[!success] Implementado en T-19 (2026-10-07)`
  con el resumen de `CLAUDE.md` y el enlace al spec. Actualizar `actualizado:`.
- `Ventas y Cobranza.md`, sección "Asignar factura a notas de ventas": cómo funciona la pantalla (de un
  jalón, corregir/quitar, número de un solo cliente, la venta facturada no se edita).
- `Status de venta.md`: caso límite "Una venta facturada no se edita ni se elimina (T-19)".
- `Estado del proyecto.md`: fila de T-19 con el PR.
- `40-Equipo/Bitácora/2026-10-07.md` (nueva, con frontmatter como las demás): las decisiones de Roberto
  (de un jalón; corregir o quitar; pendientes y N/A a pedido; rechazar número de otro cliente; tabla
  `factura`; la facturada no se edita) y cómo se le explicó la factura (nota ≠ factura).

- [ ] **Paso 5: Notas en otros issues y en #19** (con `gh issue comment`)

- **#22 (CxC), #32 (Flujo), #45 (comisión):** "Desde T-19 los 5 status existen y se asignan solos; el
  efecto de cada uno en [CxC / flujo / comisión de Promoción $0] queda para este ticket." Una línea cada uno.
- **#19:** qué se entregó, y que "los 5 status" ya los cubrían T-16/T-20/T-17. Marca las casillas
  cumplidas al cerrar.

- [ ] **Paso 6: Commit y PR**

```bash
git add CLAUDE.md
git commit -m "T-19: CLAUDE.md anota como funcionan las facturas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feature/t-19-factura
```

PR a `main` con: resumen, decisiones, aviso de que la migración agrega checks y un `not null` (pre-flight
en la nube: `select count(*) from venta_nota where factura is not null and factura not in ('N/A','pendiente')`
→ 0), conteos de pruebas y `Closes #19`.

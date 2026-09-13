begin;
select plan(4);

-- T-62 relaja uq_vendedor_folio_segmento (T-14) de global a compuesto por
-- sucursal: el cliente confirmo que el folio ya distingue sucursal como
-- primer segmento, asi que TJ260912JP01 y MX260912JP01 nunca chocan aunque
-- compartan las mismas iniciales de vendedor. Ver ADR-0007 (enmienda
-- 2026-09-12) y su ejemplo textual, reproducido aqui como prueba.

create temporary table _ctx on commit drop as
select
  (select id from sucursal where codigo = 'TJ' limit 1) as tj,
  (select id from sucursal where codigo = 'MX' limit 1) as mx;

insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
  select 'zz-pgtap-seg-1', 'Juan Perez Uno', 'x', tj, 'JP' from _ctx;

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-2', 'Juan Perez Dos', 'x', tj, 'JP' from _ctx$$,
  '23505',
  null,
  'dos vendedores vivos de la MISMA sucursal no pueden compartir segmento'
);

-- El ejemplo del cliente: dos "Juan Perez" en sucursales distintas no chocan,
-- porque el folio completo (TJ260912JP01 / MX260912JP01) sigue siendo unico.
select lives_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-3', 'Juan Perez Tres', 'x', mx, 'JP' from _ctx$$,
  'el mismo segmento SI se permite en una sucursal distinta'
);

-- D7: activo = false NO libera el segmento -- solo deleted_at lo hace. Los
-- folios ya emitidos de alguien desactivado siguen en notas fisicas firmadas,
-- y reciclar su segmento las volveria ambiguas.
update vendedor set activo = false where login = 'zz-pgtap-seg-1';

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-4', 'Juan Perez Cuatro', 'x', tj, 'JP' from _ctx$$,
  '23505',
  null,
  'desactivar (activo=false) NO libera el segmento en su sucursal'
);

update vendedor set deleted_at = now() where login = 'zz-pgtap-seg-1';

select lives_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-seg-5', 'Juan Perez Cinco', 'x', tj, 'JP' from _ctx$$,
  'dar de baja (deleted_at) SI libera el segmento en su sucursal'
);

select * from finish();
rollback;

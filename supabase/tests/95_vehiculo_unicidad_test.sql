begin;
select plan(5);

-- Las sucursales TJ y MX vienen de las semillas de T-05. Se leen por codigo en
-- vez de cablear uuids: los ids se generan al aplicar la migracion.
create temporary table ref as
  select
    (select id from sucursal where codigo = 'TJ') as tj,
    (select id from sucursal where codigo = 'MX') as mx;

insert into vehiculo (nombre, sucursal_id, km_inicial)
  select 'Nissan de prueba', tj, 1000 from ref;

select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', tj, 2000 from ref$$,
  '23505',
  null,
  'rechaza el mismo nombre repetido dentro de una sucursal'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo vehiculo para quien lo elige en la tablet.
select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'NISSAN DE PRUEBA', tj, 2000 from ref$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

-- El unique es por (sucursal_id, nombre), no global: cada sucursal puede tener
-- su propio "Nissan 2019".
select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', mx, 3000 from ref$$,
  'acepta el mismo nombre en dos sucursales distintas'
);

-- D4: desactivar NO libera el nombre. La baja del portal es `activo = false`, y
-- el indice no filtra por `activo` a proposito: mientras la fila exista el
-- nombre sigue siendo suyo, y lo que se quiere es reactivarla, no duplicarla.
update vehiculo set activo = false
  where nombre = 'Nissan de prueba'
    and sucursal_id = (select tj from ref);

select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', tj, 4000 from ref$$,
  '23505',
  null,
  'un vehiculo desactivado NO libera su nombre'
);

-- El 'where deleted_at is null' del indice. Hoy ningun camino de la API pone
-- `deleted_at` en vehiculo, pero el indice se escribio filtrado por consistencia
-- con uq_producto_nombre, y esta prueba fija ese comportamiento por si algun dia
-- aparece un borrado real.
update vehiculo set deleted_at = now()
  where nombre = 'Nissan de prueba'
    and sucursal_id = (select tj from ref);

select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Nissan de prueba', tj, 5000 from ref$$,
  'una fila con deleted_at si libera el nombre'
);

select * from finish();
rollback;

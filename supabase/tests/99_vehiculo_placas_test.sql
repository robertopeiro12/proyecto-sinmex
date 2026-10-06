-- supabase/tests/99_vehiculo_placas_test.sql
begin;
select plan(5);

-- Las sucursales TJ y MX vienen de las semillas de T-05.
create temporary table ref as
  select
    (select id from sucursal where codigo = 'TJ') as tj,
    (select id from sucursal where codigo = 'MX') as mx;

insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
  select 'Nissan de placas', tj, 1000, 'ABC-123' from ref;

select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
    select 'Otro nombre', tj, 2000, 'ABC-123' from ref$$,
  '23505',
  null,
  'rechaza la misma placa repetida'
);

-- GLOBAL y no por sucursal: a diferencia de uq_vehiculo_nombre_sucursal, ni
-- siquiera cambiando de sucursal se libera la placa.
select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
    select 'Otro nombre MX', mx, 2000, 'ABC-123' from ref$$,
  '23505',
  null,
  'la placa es unica GLOBAL, no por sucursal'
);

-- lower()/btrim() en el indice: lower es el criterio de uq_vehiculo_nombre_sucursal;
-- btrim es adicional (placas tecleadas a mano con espacios sobrantes).
select throws_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial, placas)
    select 'Mayusculas', tj, 2000, ' abc-123 ' from ref$$,
  '23505',
  null,
  'trata distinta capitalizacion y espacios como la misma placa'
);

-- Los NULL no chocan entre si: dos vehiculos "viejos" sin placa (como los que
-- ya existen de T-11) pueden coexistir sin romper nada.
select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Sin placas 1', tj, 500 from ref$$,
  'un vehiculo sin placas no choca con nada'
);

select lives_ok(
  $$insert into vehiculo (nombre, sucursal_id, km_inicial)
    select 'Sin placas 2', mx, 500 from ref$$,
  'un segundo vehiculo sin placas tampoco choca (NULL no es igual a NULL)'
);

select * from finish();
rollback;

begin;
select plan(6);

-- La baja logica de 'Especial' (confirmado en el vault 2026-08-23): no es una
-- lista de precio, es el override manual por cliente (tabla `cliente_precio`,
-- ya existe desde T-05). T-05 la sembro por error junto con las 4 reales.
select is(
  (select count(*)::int from lista_precio where deleted_at is null),
  4,
  'quedan exactamente 4 listas de precio activas'
);
select is(
  (select count(*)::int from lista_precio where nombre = 'Especial' and deleted_at is null),
  0,
  'Especial no aparece entre las listas activas'
);

-- Mismo patron que T-08a con sucursal.gestionar: el catalogo de permisos que
-- sembro T-05 no incluye ninguno para precios.
select is(
  (select count(*)::int from permiso where clave = 'precio.gestionar'),
  1,
  'existe el permiso precio.gestionar'
);

-- uq_precio_vigencia: producto/presentacion propios de la prueba (T-05 no
-- siembra ninguno), sucursal y lista de las semillas de T-05.
insert into producto (nombre) values ('Producto de prueba T-18');
create temporary table ref as
  select
    (select id from producto where nombre = 'Producto de prueba T-18') as producto,
    (select id from sucursal where codigo = 'TJ') as tj,
    (select id from sucursal where codigo = 'MX') as mx,
    (select id from lista_precio where nombre = 'Lista 1') as lista;

insert into presentacion (producto_id, volumen)
  select producto, '500 ml' from ref;
create temporary table ref2 as
  select
    (select id from presentacion where producto_id = (select producto from ref)) as presentacion;

insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
  select presentacion, lista, tj, 10.50, current_date from ref2, ref;

select throws_ok(
  $$insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
    select presentacion, lista, tj, 11.00, current_date from ref2, ref$$,
  '23505',
  null,
  'rechaza dos precios de la misma combinacion el mismo dia'
);

select lives_ok(
  $$insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
    select presentacion, lista, tj, 11.00, current_date + 1 from ref2, ref$$,
  'permite una vigencia en una fecha distinta para la misma combinacion'
);

select lives_ok(
  $$insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
    select presentacion, lista, mx, 12.00, current_date from ref2, ref$$,
  'permite la misma combinacion en otra sucursal el mismo dia'
);

select * from finish();
rollback;

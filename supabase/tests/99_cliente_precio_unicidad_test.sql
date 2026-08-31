begin;
select plan(3);

-- uq_cliente_precio_vigencia (D5 del spec de T-12): mismo patron que
-- uq_precio_vigencia de T-18, pero sin sucursal_id -- el cliente ya
-- pertenece a una sucursal fija (D6), asi que el override no necesita
-- repetirla.
insert into sucursal (codigo, nombre) values ('ZZ', 'Test T-12');
insert into lista_precio (nombre) values ('Lista Test T-12');
insert into producto (nombre) values ('Producto Test T-12');
insert into presentacion (producto_id, volumen)
  select id, '500 ml' from producto where nombre = 'Producto Test T-12';
insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
  values (
    'Cliente Test T-12', 'Domicilio', '000', false, 'cliente',
    (select id from lista_precio where nombre = 'Lista Test T-12'),
    (select id from sucursal where codigo = 'ZZ')
  );

create temporary table ref as
  select
    (select id from cliente where nombre = 'Cliente Test T-12') as cliente,
    (select id from presentacion where producto_id =
      (select id from producto where nombre = 'Producto Test T-12')) as presentacion;

insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
  select cliente, presentacion, 18.50, current_date from ref;

select throws_ok(
  $$insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
    select cliente, presentacion, 20.00, current_date from ref$$,
  '23505',
  null,
  'rechaza dos overrides del mismo cliente/presentacion el mismo dia'
);

select lives_ok(
  $$insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
    select cliente, presentacion, 20.00, current_date + 1 from ref$$,
  'permite una vigencia en una fecha distinta para la misma combinacion'
);

select lives_ok(
  $$insert into cliente_precio (cliente_id, presentacion_id, precio, vigente_desde)
    select cliente, presentacion, 21.00, current_date - 1 from ref$$,
  'permite una vigencia pasada distinta para la misma combinacion'
);

select * from finish();
rollback;

begin;
select plan(11);

-- T-72 (D3): `cliente.ubicacion_origen` dice de donde salio la coordenada
-- actual: 'gps' (la tablet al dar de alta), 'geocodificada' (Google, desde el
-- servidor) o 'manual' (la oficina en el portal). Nula si y solo si no hay `lat`.
-- Prefijo `ZZ-pgtap-T72`; todo se va con el rollback.

select has_column('cliente', 'ubicacion_origen');
select col_type_is('cliente', 'ubicacion_origen', 'text', 'ubicacion_origen es text');
select col_is_null('cliente', 'ubicacion_origen',
  'nulable: un cliente sin coordenada no tiene origen');

-- Backfill: ninguna fila con coordenada se quedo sin origen.
select is(
  (select count(*)::int from cliente where lat is not null and ubicacion_origen is null),
  0, 'toda fila con lat tiene ubicacion_origen');

insert into sucursal (codigo, nombre) values ('UO', 'Test ubicacion T-72');
create temporary table ref on commit drop as
  select (select id from sucursal where codigo = 'UO') as sucursal;

select lives_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, lat, lng, ubicacion_origen)
    select 'ZZ-pgtap-T72 GPS', null, '6641112233', false, 'prospecto', null, sucursal, 32.5149, -117.0382, 'gps' from ref$$,
  'un prospecto con GPS entra con origen gps');

select lives_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
    select 'ZZ-pgtap-T72 Sin', 'Av. Revolucion 1234', '6641112233', false, 'prospecto', null, sucursal from ref$$,
  'sin coordenada y sin origen entra');

select lives_ok(
  $$update cliente set lat = 32.5251, lng = -117.0213, ubicacion_origen = 'geocodificada'
     where nombre = 'ZZ-pgtap-T72 Sin'$$,
  'el servidor anota la coordenada de Google con su origen');

select lives_ok(
  $$update cliente set lat = null, lng = null, ubicacion_origen = null
     where nombre = 'ZZ-pgtap-T72 GPS'$$,
  'borrar la coordenada borra su origen');

select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, lat, lng, ubicacion_origen)
    select 'ZZ-pgtap-T72 Raro', null, '1', false, 'prospecto', null, sucursal, 32.5, -117, 'satelite' from ref$$,
  '23514', null, 'solo gps, geocodificada o manual');

select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, lat, lng)
    select 'ZZ-pgtap-T72 SinOrigen', null, '1', false, 'prospecto', null, sucursal, 32.5, -117 from ref$$,
  '23514', null, 'con coordenada el origen es obligatorio');

select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, ubicacion_origen)
    select 'ZZ-pgtap-T72 OrigenSolo', null, '1', false, 'prospecto', null, sucursal, 'manual' from ref$$,
  '23514', null, 'sin coordenada no hay origen');

select * from finish();
rollback;

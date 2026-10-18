begin;
select plan(16);

-- T-39: lo que la BASE garantiza del catalogo de motivos y de la visita aunque
-- alguien escriba por debajo del servicio. Prefijo `ZZ-pgtap-T39`.

select has_table('motivo_visita', 'existe el catalogo de motivos de visita');
select has_table('visita', 'existe la tabla de visitas');

select is(
  (select count(*)::int from motivo_visita
    where deleted_at is null
      and nombre in ('Tenía producto', 'Sin dinero', 'No estaba el encargado', 'Competencia', 'Cerrado')),
  5, 'la semilla trae los cinco motivos del cliente');

select is(
  (select exige_foto and exige_atendio from motivo_visita
    where nombre = 'No estaba el encargado' and deleted_at is null),
  true, '"No estaba el encargado" exige foto y nombre de quien atendio');

select is(
  (select exige_foto and not exige_atendio from motivo_visita
    where nombre = 'Cerrado' and deleted_at is null),
  true, '"Cerrado" exige foto y no nombre');

select is(
  (select count(*)::int from motivo_visita
    where deleted_at is null and (exige_foto or exige_atendio)
      and nombre in ('Tenía producto', 'Sin dinero', 'Competencia')),
  0, 'los otros tres motivos no exigen nada');

select throws_ok(
  $$insert into motivo_visita (nombre) values ('  cerrado ')$$,
  '23505', null, 'el nombre es unico entre vivos sin importar mayusculas ni espacios');

select throws_ok(
  $$insert into motivo_visita (nombre) values ('   ')$$,
  '23514', null, 'el nombre no puede quedar vacio');

insert into motivo_visita (nombre) values ('ZZ-pgtap-T39 Motivo');
update motivo_visita set deleted_at = now() where nombre = 'ZZ-pgtap-T39 Motivo';

select lives_ok(
  $$insert into motivo_visita (nombre) values ('ZZ-pgtap-T39 Motivo')$$,
  'dar de baja un motivo libera su nombre');

select is(
  (select count(*)::int from permiso where clave = 'motivo_visita.gestionar' and grupo = 'General'),
  1, 'existe el permiso motivo_visita.gestionar en el grupo General');

-- Fixtures propias de la visita: un vendedor y un prospecto de TJ (un prospecto
-- no exige domicilio ni lista de precios). Todo se va con el rollback.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t39', 'Vendedor pgTAP T39', 'x', (select id from sucursal where codigo = 'TJ'));
insert into cliente (nombre, telefono, tipo, sucursal_id)
  values ('ZZ-pgtap-T39 Cliente', '6640000000', 'prospecto', (select id from sucursal where codigo = 'TJ'));

create temporary table _t39 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t39') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from cliente where nombre = 'ZZ-pgtap-T39 Cliente') as cliente,
  (select id from motivo_visita where nombre = 'Cerrado' and deleted_at is null) as motivo;

select lives_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, lat, lng, precision_m)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 32.5149, -117.0382, 12 from _t39$$,
  'una visita con GPS entra');

select lives_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, direccion_texto)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 'Frente al parque' from _t39$$,
  'una visita sin GPS con direccion escrita entra');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, direccion_texto)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), '   ' from _t39$$,
  '23514', null, 'sin GPS y sin direccion no entra');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, lat, direccion_texto)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 32.5, 'x' from _t39$$,
  '23514', null, 'lat y lng van juntas');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, lat, lng)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 91, 0 from _t39$$,
  '23514', null, 'la latitud esta en rango');

select throws_ok(
  $$insert into visita (id, vendedor_id, sucursal_id, cliente_id, motivo_visita_id, fecha, visitada_en, direccion_texto, foto_archivo)
    select gen_random_uuid(), vendedor, sucursal, cliente, motivo, date '2026-10-18', now(), 'x', 'visita-x.jpg' from _t39$$,
  '23514', null, 'la foto va completa: archivo y fecha juntos');

select * from finish();
rollback;

begin;
select plan(20);

-- T-30/T-31: lo que la BASE garantiza del catalogo de campos de egreso y del
-- gasto aunque alguien escriba por debajo del servicio. Prefijo `ZZ-pgtap-T30`.

select has_table('campo_egreso', 'existe el catalogo de campos de egreso');
select has_table('gasto', 'existe la tabla de gastos');

select is(
  (select count(*)::int from campo_egreso
    where deleted_at is null
      and nombre in ('Envases', 'Celular', 'Gastos diversos', 'Ajustes x no cuadrar',
                     'Gasolina', 'Hielo', 'Reparación del vehículo', 'Adelanto de sueldo')),
  8, 'la semilla trae los ocho campos del cliente');

select is(
  (select count(*)::int from campo_egreso
    where deleted_at is null and se_usa_en_app
      and nombre in ('Gasolina', 'Hielo', 'Reparación del vehículo', 'Adelanto de sueldo')),
  4, 'gasolina, hielo, reparacion y adelanto se usan en la app');

select is(
  (select count(*)::int from campo_egreso
    where deleted_at is null and se_usa_en_app
      and nombre in ('Envases', 'Celular', 'Gastos diversos', 'Ajustes x no cuadrar')),
  0, 'los otros cuatro no se usan en la app');

select is(
  (select tipo from campo_egreso where nombre = 'Envases' and deleted_at is null),
  'produccion', 'Envases es de produccion; los demas de operacion');

select throws_ok(
  $$insert into campo_egreso (nombre, tipo) values ('  gasolina ', 'operacion')$$,
  '23505', null, 'el nombre es unico entre vivos sin importar mayusculas ni espacios');

select throws_ok(
  $$insert into campo_egreso (nombre, tipo) values ('   ', 'operacion')$$,
  '23514', null, 'el nombre no puede quedar vacio');

select throws_ok(
  $$insert into campo_egreso (nombre, tipo) values ('ZZ-pgtap-T30 Raro', 'nomina')$$,
  '23514', null, 'el tipo es uno de los tres fijos');

insert into campo_egreso (nombre, tipo) values ('ZZ-pgtap-T30 Campo', 'operacion');
update campo_egreso set deleted_at = now() where nombre = 'ZZ-pgtap-T30 Campo';

select lives_ok(
  $$insert into campo_egreso (nombre, tipo) values ('ZZ-pgtap-T30 Campo', 'financiero')$$,
  'dar de baja un campo libera su nombre');

select is(
  (select count(*)::int from permiso where clave = 'campo_egreso.gestionar' and grupo = 'General'),
  1, 'existe el permiso campo_egreso.gestionar en el grupo General');

select is(
  (select count(*)::int from permiso where clave = 'gasto.ver' and grupo = 'Finanzas'),
  1, 'existe el permiso gasto.ver en el grupo Finanzas');

-- Fixtures del gasto: un vendedor de TJ. Todo se va con el rollback.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t30', 'Vendedor pgTAP T30', 'x', (select id from sucursal where codigo = 'TJ'));

create temporary table _t30 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t30') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from campo_egreso where nombre = 'Hielo' and deleted_at is null) as campo;

select lives_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app' from _t30$$,
  'un gasto de la app con vendedor entra');

select is(
  (select factura from gasto where vendedor_id = (select vendedor from _t30) limit 1),
  'N/A', 'la factura nace en N/A');

select lives_ok(
  $$insert into gasto (id, sucursal_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'portal' from _t30$$,
  'un gasto del portal sin vendedor entra (compras de oficina, siguiente ticket)');

select throws_ok(
  $$insert into gasto (id, sucursal_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app' from _t30$$,
  '23514', null, 'un gasto de la app exige vendedor');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 0, 'efectivo_cobranza_dia', 'app' from _t30$$,
  '23514', null, 'el monto es mayor que cero');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'transferencia', 'app' from _t30$$,
  '23514', null, 'por ahora el unico metodo es efectivo cobranza del dia');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen, comentario)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app', repeat('x', 201) from _t30$$,
  '23514', null, 'el comentario no pasa de 200 caracteres');

select throws_ok(
  $$insert into gasto (id, sucursal_id, vendedor_id, campo_egreso_id, campo_nombre, tipo, fecha, registrado_en, monto, metodo, origen, foto_archivo)
    select gen_random_uuid(), sucursal, vendedor, campo, 'Hielo', 'operacion', date '2026-10-20', now(), 80, 'efectivo_cobranza_dia', 'app', 'gasto-x.jpg' from _t30$$,
  '23514', null, 'la foto va completa: archivo y fecha juntos');

select * from finish();
rollback;

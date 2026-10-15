begin;
select plan(11);

-- T-28: lo que la BASE garantiza de las cuentas y saldos de Tesoreria aunque
-- alguien escriba por debajo del servicio. Prefijo `ZZ-pgtap-T28`.

select has_table('tesoreria_cuenta', 'existe la tabla de cuentas');
select has_table('tesoreria_saldo', 'existe la tabla de saldos fijados');

insert into tesoreria_cuenta (nombre) values ('ZZ-pgtap-T28 Banco');

select throws_ok(
  $$insert into tesoreria_cuenta (nombre) values ('  zz-PGTAP-t28 banco ')$$,
  '23505', null, 'el nombre es unico entre vivas sin importar mayusculas ni espacios');

update tesoreria_cuenta set deleted_at = now() where nombre = 'ZZ-pgtap-T28 Banco';

select lives_ok(
  $$insert into tesoreria_cuenta (nombre, sucursal_id)
    values ('ZZ-pgtap-T28 Banco', (select id from sucursal where codigo = 'TJ'))$$,
  'dar de baja una cuenta libera su nombre');

select throws_ok(
  $$insert into tesoreria_cuenta (nombre) values ('   ')$$,
  '23514', null, 'el nombre no puede quedar vacio');

select throws_ok(
  $$insert into tesoreria_cuenta (nombre) values (repeat('x', 61))$$,
  '23514', null, 'el nombre no pasa de 60 caracteres');

create temporary table _t28 on commit drop as
select
  (select id from tesoreria_cuenta where nombre = 'ZZ-pgtap-T28 Banco' and deleted_at is null) as cuenta,
  (select id from usuario order by created_at limit 1) as usuario;

select lives_ok(
  $$insert into tesoreria_saldo (cuenta_id, fecha, monto, capturo_usuario_id)
    select cuenta, date '2026-10-01', -1500.50, usuario from _t28$$,
  'un saldo fijado puede ser negativo (sobregiro)');

select throws_ok(
  $$insert into tesoreria_saldo (cuenta_id, fecha, monto, capturo_usuario_id)
    select cuenta, date '2026-10-01', 10, usuario from _t28$$,
  '23505', null, 'un saldo vivo por cuenta y fecha');

update tesoreria_saldo set deleted_at = now()
 where cuenta_id = (select cuenta from _t28) and fecha = date '2026-10-01';

select lives_ok(
  $$insert into tesoreria_saldo (cuenta_id, fecha, monto, capturo_usuario_id)
    select cuenta, date '2026-10-01', 10, usuario from _t28$$,
  'borrar un saldo fijado libera su fecha');

select throws_ok(
  $$insert into tesoreria_saldo (cuenta_id, fecha, monto, comentario, capturo_usuario_id)
    select cuenta, date '2026-10-02', 10, '', usuario from _t28$$,
  '23514', null, 'el comentario es null o tiene texto, nunca vacio');

select is(
  (select count(*)::int from permiso where clave in ('tesoreria.ver', 'tesoreria.gestionar') and grupo = 'Finanzas'),
  2, 'existen los dos permisos de Tesoreria en el grupo Finanzas');

select * from finish();
rollback;

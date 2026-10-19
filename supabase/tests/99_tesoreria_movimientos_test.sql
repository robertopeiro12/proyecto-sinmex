begin;
select plan(13);

-- T-29: lo que la BASE garantiza de los movimientos y destinos de Tesoreria.
-- Prefijo `ZZ-pgtap-T29`.

select has_table('tesoreria_movimiento', 'existe la tabla de movimientos');
select has_table('tesoreria_destino_cobranza', 'existe la tabla de destinos de la cobranza');

insert into tesoreria_cuenta (nombre) values ('ZZ-pgtap-T29 A'), ('ZZ-pgtap-T29 B');

create temporary table _t29 on commit drop as
select
  (select id from tesoreria_cuenta where nombre = 'ZZ-pgtap-T29 A') as a,
  (select id from tesoreria_cuenta where nombre = 'ZZ-pgtap-T29 B') as b,
  (select id from usuario order by created_at limit 1) as usuario,
  (select id from sucursal where codigo = 'TJ') as tj;

select lives_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, capturo_usuario_id)
    select 'deposito', date '2026-10-01', 100, a, usuario from _t29$$,
  'un deposito a una cuenta entra');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, capturo_usuario_id)
    select 'retiro', date '2026-10-01', 0, a, usuario from _t29$$,
  '23514', null, 'el monto es mayor que cero');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, capturo_usuario_id)
    select 'traspaso', date '2026-10-01', 10, a, usuario from _t29$$,
  '23514', null, 'un traspaso exige cuenta destino');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, cuenta_destino_id, capturo_usuario_id)
    select 'traspaso', date '2026-10-01', 10, a, a, usuario from _t29$$,
  '23514', null, 'un traspaso no puede ir a la misma cuenta');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, cuenta_destino_id, capturo_usuario_id)
    select 'deposito', date '2026-10-01', 10, a, b, usuario from _t29$$,
  '23514', null, 'solo el traspaso lleva cuenta destino');

select lives_ok(
  $$insert into tesoreria_destino_cobranza (sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id)
    select tj, 'efectivo', a, date '2001-01-01', usuario from _t29$$,
  'un destino de cobranza entra');

select throws_ok(
  $$insert into tesoreria_destino_cobranza (sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id)
    select tj, 'efectivo', b, date '2001-01-01', usuario from _t29$$,
  '23505', null, 'una vigencia viva por sucursal, metodo y desde');

select throws_ok(
  $$insert into tesoreria_destino_cobranza (sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id)
    select tj, 'saldo_favor', a, date '2001-01-02', usuario from _t29$$,
  '23514', null, 'el metodo es efectivo, transferencia o cheque');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, capturo_usuario_id)
    select 'otro', date '2001-01-01', 10, a, usuario from _t29$$,
  '23514', null, 'el tipo es deposito, retiro o traspaso');

select throws_ok(
  $$insert into tesoreria_movimiento (tipo, fecha, monto, cuenta_id, comentario, capturo_usuario_id)
    select 'deposito', date '2001-01-01', 10, a, '', usuario from _t29$$,
  '23514', null, 'el comentario no puede ser cadena vacia');

update tesoreria_destino_cobranza set deleted_at = now()
  where sucursal_id = (select tj from _t29) and metodo = 'efectivo' and desde = date '2001-01-01';

select lives_ok(
  $$insert into tesoreria_destino_cobranza (sucursal_id, metodo, cuenta_id, desde, capturo_usuario_id)
    select tj, 'efectivo', b, date '2001-01-01', usuario from _t29$$,
  'dado de baja un destino, otro con la misma sucursal, metodo y desde entra');

select * from finish();
rollback;

begin;
select plan(24);

-- T-27 pieza 1: lo que la BASE garantiza de la carga del vendedor aunque alguien
-- escriba por debajo del servicio. Prefijo `zz-pgtap-t27`. Todo se va con el rollback.

select has_table('carga', 'existe la tabla de cargas');
select has_table('carga_detalle', 'existe el detalle de las cargas');

select has_column('sucursal', 'control_inventario',
  'la sucursal dice si la app controla el inventario (D7)');
select col_not_null('sucursal', 'control_inventario', 'la casilla nunca es nula');
select col_default_is('sucursal', 'control_inventario', 'false',
  'apagada por defecto: la version nueva no deja sin vender a nadie');

select has_index('carga', 'uq_carga_vendedor_fecha_numero',
  'un numero vivo por vendedor y dia');
select has_index('carga', 'idx_carga_vendedor_updated',
  'el pull lee por vendedor y updated_at');
select has_trigger('carga', 'trg_carga_updated', 'la carga mueve updated_at al editarse');

select is(
  (select count(*)::int from permiso where clave = 'carga.gestionar' and grupo = 'Produccion/Almacen'),
  1, 'el permiso carga.gestionar ya existia y no se duplica');

-- Fixtures: un vendedor y un usuario de TJ, un producto con dos presentaciones.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t27', 'Vendedor pgTAP T27', 'x', (select id from sucursal where codigo = 'TJ'));
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t27-portal', 'Usuario pgTAP T27', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('zz-pgtap-t27 Horchata');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'zz-pgtap-t27 Horchata';
insert into presentacion (producto_id, volumen)
  select id, '500 ml' from producto where nombre = 'zz-pgtap-t27 Horchata';

create temporary table _t27 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t27') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from usuario where login = 'zz-pgtap-t27-portal') as usuario,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t27 Horchata' and pr.volumen = '1 L') as litro,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t27 Horchata' and pr.volumen = '500 ml') as medio;

select lives_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 1, usuario from _t27$$,
  'una carga entra sin decir estado ni version');

select results_eq(
  $$select estado, version, motivo_rechazo, respondida_en from carga
    where vendedor_id = (select vendedor from _t27) and numero = 1$$,
  $$values ('pendiente'::text, 1, null::text, null::timestamptz)$$,
  'nace pendiente, version 1, sin motivo ni respuesta');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 0, usuario from _t27$$,
  '23514', null, 'el numero empieza en 1');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado, respondida_en)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'rechazada', now() from _t27$$,
  '23514', null, 'una rechazada exige motivo (ck_carga_motivo)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, motivo_rechazo)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'Faltan cajas' from _t27$$,
  '23514', null, 'una pendiente no lleva motivo (ck_carga_motivo)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'aceptada' from _t27$$,
  '23514', null, 'una aceptada lleva respondida_en (ck_carga_respondida)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, respondida_en)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, now() from _t27$$,
  '23514', null, 'una pendiente no tiene respondida_en (ck_carga_respondida)');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado, motivo_rechazo, respondida_en)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'rechazada', repeat('x', 301), now() from _t27$$,
  '23514', null, 'el motivo no pasa de 300 caracteres');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, estado)
    select sucursal, vendedor, date '2026-10-22', 9, usuario, 'perdida' from _t27$$,
  '23514', null, 'el estado es uno de los tres');

select throws_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 1, usuario from _t27$$,
  '23505', null, 'dos cargas vivas no comparten numero el mismo dia');

update carga set deleted_at = now()
  where vendedor_id = (select vendedor from _t27) and numero = 1;

select lives_ok(
  $$insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id)
    select sucursal, vendedor, date '2026-10-22', 1, usuario from _t27$$,
  'una carga eliminada libera su numero');

create temporary table _t27c on commit drop as
select id from carga
  where vendedor_id = (select vendedor from _t27) and numero = 1 and deleted_at is null;

select lives_ok(
  $$insert into carga_detalle (carga_id, presentacion_id, piezas)
    select (select id from _t27c), litro, 24 from _t27$$,
  'una linea con piezas entra');

select throws_ok(
  $$insert into carga_detalle (carga_id, presentacion_id, piezas)
    select (select id from _t27c), medio, 0 from _t27$$,
  '23514', null, 'las piezas son mayores que cero');

select throws_ok(
  $$insert into carga_detalle (carga_id, presentacion_id, piezas)
    select (select id from _t27c), litro, 5 from _t27$$,
  '23505', null, 'una presentacion una sola vez por carga');

-- El trigger: con created_at/updated_at viejos a mano, un update mueve updated_at a now().
insert into carga (sucursal_id, vendedor_id, fecha, numero, capturo_usuario_id, created_at, updated_at)
  select sucursal, vendedor, date '2026-10-22', 2, usuario,
         timestamptz '2020-01-01', timestamptz '2020-01-01' from _t27;
update carga set version = 2
  where vendedor_id = (select vendedor from _t27) and numero = 2;

select ok(
  (select updated_at > timestamptz '2020-01-01' from carga
    where vendedor_id = (select vendedor from _t27) and numero = 2),
  'editar la carga le toca updated_at (lo lee el pull)');

select * from finish();
rollback;

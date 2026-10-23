begin;
select plan(23);

-- T-27 pieza 2: lo que la BASE garantiza de los movimientos de inventario (merma
-- del cliente, merma del trayecto, consumo) aunque alguien escriba por debajo del
-- servicio. Prefijo `zz-pgtap-t27m`. Todo se va con el rollback.

select has_table('movimiento_inventario', 'existe la tabla de movimientos de inventario');
select has_table('movimiento_inventario_linea', 'existen las lineas de los movimientos');

select has_column('sucursal', 'consumo_diario_max',
  'la sucursal dice cuanto consumo propio puede registrar cada vendedor al dia (D4)');
select col_not_null('sucursal', 'consumo_diario_max', 'el limite nunca es nulo');
select col_default_is('sucursal', 'consumo_diario_max', '1', 'una pieza por dia por defecto (D4)');

select has_index('movimiento_inventario', 'idx_movimiento_vendedor_fecha',
  'el corte lee por vendedor y fecha');
select has_trigger('movimiento_inventario', 'trg_movimiento_inventario_updated',
  'el movimiento mueve updated_at al editarse (correccion de la oficina, T-35)');

select throws_ok(
  $$update sucursal set consumo_diario_max = -1 where codigo = 'TJ'$$,
  '23514', null, 'el limite no es negativo');
select throws_ok(
  $$update sucursal set consumo_diario_max = 100 where codigo = 'TJ'$$,
  '23514', null, 'el limite no pasa de 99');
select lives_ok(
  $$update sucursal set consumo_diario_max = 0 where codigo = 'TJ'$$,
  'un limite de 0 apaga el consumo propio');

-- Fixtures: un vendedor y un cliente de TJ, un producto con una presentacion.
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-t27m', 'Vendedor pgTAP T27m', 'x', (select id from sucursal where codigo = 'TJ'));
insert into cliente (nombre, telefono, tipo, sucursal_id)
  values ('ZZ-pgtap-T27m Cliente', '6640000000', 'prospecto', (select id from sucursal where codigo = 'TJ'));
insert into producto (nombre) values ('zz-pgtap-t27m Horchata');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'zz-pgtap-t27m Horchata';

create temporary table _t27m on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t27m') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from cliente where nombre = 'ZZ-pgtap-T27m Cliente') as cliente,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t27m Horchata' and pr.volumen = '1 L') as litro;

select lives_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, cliente_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002701', sucursal, vendedor, cliente, 'merma_cliente',
           date '2026-10-23', now() from _t27m$$,
  'una merma del cliente entra con su cliente');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002702', sucursal, vendedor, 'merma_cliente',
           date '2026-10-23', now() from _t27m$$,
  '23514', null, 'una merma del cliente sin cliente no entra (ck_movimiento_cliente)');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, cliente_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002703', sucursal, vendedor, cliente, 'merma_trayecto',
           date '2026-10-23', now() from _t27m$$,
  '23514', null, 'la merma del trayecto no lleva cliente (ck_movimiento_cliente)');

select lives_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002704', sucursal, vendedor, 'consumo',
           date '2026-10-23', now() from _t27m$$,
  'el consumo entra sin cliente');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en)
    select 'c0ffee00-0000-4000-8000-000000002705', sucursal, vendedor, 'cambio',
           date '2026-10-23', now() from _t27m$$,
  '23514', null, 'el tipo es uno de los tres (los cambios fisicos quedaron fuera)');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en, comentario)
    select 'c0ffee00-0000-4000-8000-000000002706', sucursal, vendedor, 'consumo',
           date '2026-10-23', now(), '' from _t27m$$,
  '23514', null, 'un comentario vacio es null, no cadena vacia');

select throws_ok(
  $$insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en, comentario)
    select 'c0ffee00-0000-4000-8000-000000002707', sucursal, vendedor, 'consumo',
           date '2026-10-23', now(), repeat('x', 301) from _t27m$$,
  '23514', null, 'el comentario no pasa de 300 caracteres');

select lives_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002701', litro, 'recibido', 3 from _t27m$$,
  'una linea recibida (lo danado que devuelve el cliente) entra');

select lives_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002701', litro, 'entregado', 2 from _t27m$$,
  'la misma presentacion puede ir entregada (la reposicion)');

select throws_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002704', litro, 'perdido', 1 from _t27m$$,
  '23514', null, 'el sentido es recibido o entregado');

select throws_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002704', litro, 'entregado', 0 from _t27m$$,
  '23514', null, 'las piezas son mayores que cero');

select throws_ok(
  $$insert into movimiento_inventario_linea (movimiento_id, presentacion_id, sentido, piezas)
    select 'c0ffee00-0000-4000-8000-000000002701', litro, 'recibido', 1 from _t27m$$,
  '23505', null, 'una presentacion una sola vez por sentido (uq_movimiento_linea)');

-- El trigger: con created_at/updated_at viejos a mano, un update mueve updated_at a now().
insert into movimiento_inventario (id, sucursal_id, vendedor_id, tipo, fecha, registrado_en, created_at, updated_at)
  select 'c0ffee00-0000-4000-8000-000000002708', sucursal, vendedor, 'merma_trayecto', date '2026-10-23',
         now(), timestamptz '2020-01-01', timestamptz '2020-01-01' from _t27m;
update movimiento_inventario set comentario = 'Corregido por la oficina'
  where id = 'c0ffee00-0000-4000-8000-000000002708';

select ok(
  (select updated_at > timestamptz '2020-01-01' from movimiento_inventario
    where id = 'c0ffee00-0000-4000-8000-000000002708'),
  'editar el movimiento le toca updated_at');

select * from finish();
rollback;

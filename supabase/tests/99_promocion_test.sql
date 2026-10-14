begin;
select plan(14);

-- T-74: lo que la BASE garantiza de una promocion aunque alguien escriba por
-- debajo del servicio. Prefijo `zz-pgtap-t74`.

insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T74 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

create temporary table _t74 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from cliente where nombre = 'ZZ-pgtap-T74 Cliente') as cliente,
  (select id from producto order by nombre limit 1) as producto,
  (select id from presentacion order by volumen limit 1) as presentacion;

select has_table('promocion', 'existe la tabla de reglas (D1)');
select has_table('venta_nota_promocion', 'existe la trazabilidad por nota (D12)');
select has_column('cliente', 'primera_venta_en', 'el cliente sabe cuando tuvo su primera nota (D14)');
select hasnt_column('cliente', 'promocion', 'el enum viejo se fue (D10)');
select hasnt_table('cliente_promocion_producto', 'la lista vieja de productos se fue (D10)');

select lives_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, 10, 'mismo', 1 from _t74$$,
  'por cada 10 de un producto, 1 del mismo: entra');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'cualquiera', 10, 'mismo', 1 from _t74$$,
  '23514', null, '"del mismo" no cabe con "cualquier producto" (ck_promocion_regalo)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, 0, 'mismo', 1 from _t74$$,
  '23514', null, 'comprar 0 solo vale para prospectos (ck_promocion_compra_cero)');

select lives_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_cantidad, regalo_tipo, regalo_presentacion_id, regalo_cantidad)
    select sucursal, 'prospecto', 'cualquiera', 0, 'presentacion', presentacion, 2 from _t74$$,
  'bienvenida al prospecto sin compra: entra (D7)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_cantidad, regalo_tipo, regalo_presentacion_id, regalo_cantidad)
    select sucursal, 'cliente', 'cualquiera', 1, 'presentacion', presentacion, 1 from _t74$$,
  '23514', null, 'audiencia cliente exige cliente_id (ck_promocion_audiencia)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, cliente_id, compra_tipo, compra_cantidad, regalo_tipo, regalo_presentacion_id, regalo_cantidad)
    select sucursal, 'todos', cliente, 'cualquiera', 1, 'presentacion', presentacion, 1 from _t74$$,
  '23514', null, 'audiencia todos no admite cliente_id (ck_promocion_audiencia)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_presentacion_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, presentacion, 1, 'mismo', 1 from _t74$$,
  '23514', null, 'compra por producto no lleva presentacion (ck_promocion_compra)');

select throws_ok(
  $$insert into promocion (sucursal_id, audiencia, compra_tipo, compra_producto_id, compra_cantidad, regalo_tipo, regalo_cantidad)
    select sucursal, 'todos', 'producto', producto, 1, 'mismo', 0 from _t74$$,
  '23514', null, 'se regala al menos 1 pieza');

select throws_ok(
  $$insert into venta_nota_promocion (venta_nota_id, presentacion_id, cantidad, promocion_texto)
    select gen_random_uuid(), presentacion, 0, 'x' from _t74$$,
  '23514', null, 'una fila de trazabilidad lleva al menos 1 pieza');

select * from finish();
rollback;

begin;
select plan(20);

-- Retorno del vendedor: lo que la BASE garantiza del registro de piezas buenas
-- retornadas por dia, vendedor y presentacion aunque alguien escriba por debajo
-- del servicio. Prefijo `zz-pgtap-retorno`. Todo se va con el rollback.

select has_table('retorno', 'existe la tabla de retorno');
select has_column('retorno', 'fecha', 'el retorno es de un dia');
select has_column('retorno', 'vendedor_id', 'es de un vendedor');
select has_column('retorno', 'sucursal_id', 'guarda la sucursal del vendedor');
select has_column('retorno', 'piezas', 'lleva las piezas buenas retornadas');
select has_column('retorno', 'capturo_usuario_id', 'dice quien lo capturo');
select has_column('retorno', 'actualizado_por_usuario_id', 'dice quien lo corrigio');
select has_column('retorno', 'deleted_at', 'se da de baja con baja logica');

select has_index('retorno', 'uq_retorno_dia_vendedor_presentacion',
  'una fila viva por dia, vendedor y presentacion');
select has_index('retorno', 'idx_retorno_sucursal_fecha',
  'la pantalla lee por sucursal y fecha');
select has_trigger('retorno', 'trg_retorno_updated', 'el retorno mueve updated_at al editarse');

-- Fixtures: un usuario, un vendedor, un producto con dos presentaciones.
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-retorno-portal', 'Usuario pgTAP Retorno', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-retorno', 'Vendedor pgTAP Retorno', 'x', (select id from sucursal where codigo = 'TJ'));
insert into producto (nombre) values ('zz-pgtap-retorno Horchata');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'zz-pgtap-retorno Horchata';
insert into presentacion (producto_id, volumen)
  select id, '500 ml' from producto where nombre = 'zz-pgtap-retorno Horchata';

create temporary table _ret on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from usuario where login = 'zz-pgtap-retorno-portal') as usuario,
  (select id from vendedor where login = 'zz-pgtap-retorno') as vendedor,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-retorno Horchata' and pr.volumen = '1 L') as litro,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-retorno Horchata' and pr.volumen = '500 ml') as medio;

select lives_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', vendedor, sucursal, litro, 12, usuario from _ret$$,
  'un retorno entra');

select throws_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', vendedor, sucursal, medio, 0, usuario from _ret$$,
  '23514', null, 'las piezas son mayores que cero');

select throws_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', vendedor, sucursal, litro, 5, usuario from _ret$$,
  '23505', null, 'dos filas vivas no comparten dia, vendedor y presentacion');

select throws_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', gen_random_uuid(), sucursal, medio, 5, usuario from _ret$$,
  '23503', null, 'el vendedor tiene que existir');

select throws_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', vendedor, gen_random_uuid(), medio, 5, usuario from _ret$$,
  '23503', null, 'la sucursal tiene que existir');

select throws_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', vendedor, sucursal, gen_random_uuid(), 5, usuario from _ret$$,
  '23503', null, 'la presentacion tiene que existir');

select throws_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', vendedor, sucursal, medio, 5, gen_random_uuid() from _ret$$,
  '23503', null, 'quien captura tiene que existir');

update retorno set deleted_at = now()
  where presentacion_id = (select litro from _ret) and fecha = date '2026-10-23';

select lives_ok(
  $$insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', vendedor, sucursal, litro, 8, usuario from _ret$$,
  'volver a capturar una presentacion dada de baja ese dia entra (indice parcial)');

-- El trigger: con updated_at viejo a mano, un update lo mueve a now().
insert into retorno (fecha, vendedor_id, sucursal_id, presentacion_id, piezas, capturo_usuario_id, created_at, updated_at)
  select date '2026-10-24', vendedor, sucursal, medio, 10, usuario,
         timestamptz '2020-01-01', timestamptz '2020-01-01' from _ret;
update retorno set piezas = 11
  where presentacion_id = (select medio from _ret) and fecha = date '2026-10-24';

select ok(
  (select updated_at > timestamptz '2020-01-01' from retorno
    where presentacion_id = (select medio from _ret) and fecha = date '2026-10-24'),
  'editar el retorno le toca updated_at');

select * from finish();
rollback;

begin;
select plan(18);

-- T-25: lo que la BASE garantiza del registro de produccion por dia aunque alguien
-- escriba por debajo del servicio. Prefijo `zz-pgtap-t25`. Todo se va con el rollback.

select has_table('produccion', 'existe la tabla de produccion');
select has_column('produccion', 'fecha', 'la produccion es de un dia');
select has_column('produccion', 'piezas', 'lleva las piezas producidas');
select has_column('produccion', 'capturo_usuario_id', 'dice quien la capturo');
select has_column('produccion', 'actualizado_por_usuario_id', 'dice quien la corrigio');
select has_column('produccion', 'deleted_at', 'se da de baja con baja logica');

select has_index('produccion', 'uq_produccion_dia_sucursal_presentacion',
  'una fila viva por dia, sucursal y presentacion');
select has_index('produccion', 'idx_produccion_sucursal_fecha',
  'la pantalla lee por sucursal y fecha');
select has_trigger('produccion', 'trg_produccion_updated', 'la produccion mueve updated_at al editarse');

-- Fixtures: un usuario, un producto con dos presentaciones.
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t25-portal', 'Usuario pgTAP T25', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('zz-pgtap-t25 Horchata');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'zz-pgtap-t25 Horchata';
insert into presentacion (producto_id, volumen)
  select id, '500 ml' from producto where nombre = 'zz-pgtap-t25 Horchata';

create temporary table _t25 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from usuario where login = 'zz-pgtap-t25-portal') as usuario,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t25 Horchata' and pr.volumen = '1 L') as litro,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-t25 Horchata' and pr.volumen = '500 ml') as medio;

select lives_ok(
  $$insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', sucursal, litro, 120, usuario from _t25$$,
  'una produccion entra');

select throws_ok(
  $$insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', sucursal, medio, 0, usuario from _t25$$,
  '23514', null, 'las piezas son mayores que cero');

select throws_ok(
  $$insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', sucursal, litro, 5, usuario from _t25$$,
  '23505', null, 'dos filas vivas no comparten dia, sucursal y presentacion');

select throws_ok(
  $$insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', gen_random_uuid(), medio, 5, usuario from _t25$$,
  '23503', null, 'la sucursal tiene que existir');

select throws_ok(
  $$insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', sucursal, gen_random_uuid(), 5, usuario from _t25$$,
  '23503', null, 'la presentacion tiene que existir');

select throws_ok(
  $$insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', sucursal, medio, 5, gen_random_uuid() from _t25$$,
  '23503', null, 'quien captura tiene que existir');

update produccion set deleted_at = now()
  where presentacion_id = (select litro from _t25) and fecha = date '2026-10-23';

select lives_ok(
  $$insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
    select date '2026-10-23', sucursal, litro, 80, usuario from _t25$$,
  'volver a capturar una presentacion dada de baja ese dia entra (indice parcial)');

select is(
  (select count(*)::int from produccion
    where presentacion_id = (select litro from _t25) and fecha = date '2026-10-23'),
  2, 'la baja logica conserva la fila vieja junto a la nueva');

-- El trigger: con updated_at viejo a mano, un update lo mueve a now().
insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id, created_at, updated_at)
  select date '2026-10-24', sucursal, medio, 10, usuario,
         timestamptz '2020-01-01', timestamptz '2020-01-01' from _t25;
update produccion set piezas = 11
  where presentacion_id = (select medio from _t25) and fecha = date '2026-10-24';

select ok(
  (select updated_at > timestamptz '2020-01-01' from produccion
    where presentacion_id = (select medio from _t25) and fecha = date '2026-10-24'),
  'editar la produccion le toca updated_at');

select * from finish();
rollback;

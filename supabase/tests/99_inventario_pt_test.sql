begin;
select plan(17);

-- Inventario de PT: lo que la BASE garantiza aunque alguien escriba por debajo del servicio.
-- Prefijo `zz-pgtap-ipt`.

select has_table('inventario_pt_ajuste', 'existe la tabla de ajustes');
select has_trigger('inventario_pt_ajuste', 'trg_inventario_pt_ajuste_updated', 'el ajuste mueve updated_at');
select is(
  (select count(*)::int from permiso
    where grupo = 'Produccion/Almacen' and clave in ('inventario_pt.ver', 'inventario_pt.ajustar')),
  2, 'existen inventario_pt.ver e inventario_pt.ajustar en Produccion/Almacen');

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-ipt-a', 'Usuario A', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('zz-pgtap-ipt Horchata');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'zz-pgtap-ipt Horchata';

create temporary table _r on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from usuario where login = 'zz-pgtap-ipt-a') as ua,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-ipt Horchata') as p1;

select lives_ok($$
  insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
                                    merma_acumulada_inicial, comentario, capturo_usuario_id)
    select tj, p1, '2098-01-01', 10, 0, 'Conteo físico', ua from _r;
  insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
                                    merma_acumulada_inicial, capturo_usuario_id)
    select tj, p1, '2098-01-02', 0, 3, ua from _r;
$$, 'ajustes válidos entran (comentario opcional, ceros permitidos)');

select throws_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, capturo_usuario_id) select tj, p1, '2098-01-01', 1, 0, ua from _r$$,
  '23505', null, 'un solo ajuste vivo por sucursal, presentación y fecha');
select throws_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, capturo_usuario_id) select tj, p1, '2098-01-03', -1, 0, ua from _r$$,
  '23514', null, 'inventario inicial negativo');
select throws_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, capturo_usuario_id) select tj, p1, '2098-01-03', 0, -1, ua from _r$$,
  '23514', null, 'merma acumulada negativa');
select throws_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, capturo_usuario_id) select tj, p1, '2098-01-03', null, 0, ua from _r$$,
  '23502', null, 'inventario inicial obligatorio');
select throws_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, comentario, capturo_usuario_id) select tj, p1, '2098-01-03', 0, 0, '', ua from _r$$,
  '23514', null, 'comentario vacío');
select throws_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, comentario, capturo_usuario_id) select tj, p1, '2098-01-03', 0, 0, ' x', ua from _r$$,
  '23514', null, 'comentario sin recortar');
select throws_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, comentario, capturo_usuario_id) select tj, p1, '2098-01-03', 0, 0, repeat('x', 301), ua from _r$$,
  '23514', null, 'comentario de más de 300');

-- Una baja libera la llave.
update inventario_pt_ajuste set deleted_at = now() where fecha = '2098-01-01'
  and presentacion_id = (select p1 from _r);
select lives_ok($$insert into inventario_pt_ajuste (sucursal_id, presentacion_id, fecha, inventario_inicial,
  merma_acumulada_inicial, capturo_usuario_id) select tj, p1, '2098-01-01', 5, 0, ua from _r$$,
  'tras dar de baja, se puede volver a ajustar ese día');

-- updated_at se mueve al editar.
update inventario_pt_ajuste set updated_at = now() - interval '1 day' where fecha = '2098-01-02'
  and presentacion_id = (select p1 from _r);
update inventario_pt_ajuste set inventario_inicial = 4 where fecha = '2098-01-02'
  and presentacion_id = (select p1 from _r);
select ok((select updated_at > now() - interval '1 minute' from inventario_pt_ajuste
  where fecha = '2098-01-02' and presentacion_id = (select p1 from _r)), 'editar un ajuste mueve updated_at');

select col_is_null('inventario_pt_ajuste', 'deleted_at', 'deleted_at admite null');
select has_index('inventario_pt_ajuste', 'idx_inventario_pt_ajuste_sucursal_fecha', 'índice por sucursal y fecha');
select has_index('inventario_pt_ajuste', 'uq_inventario_pt_ajuste', 'único vivo');
select col_not_null('inventario_pt_ajuste', 'capturo_usuario_id', 'quién capturó es obligatorio');

select * from finish();
rollback;

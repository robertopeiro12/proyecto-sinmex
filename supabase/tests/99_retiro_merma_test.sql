begin;
select plan(21);

-- Retiro de merma con autorizacion: lo que la BASE garantiza. Prefijo `zz-pgtap-retiro`.

select has_column('operacion_almacen', 'estado', 'existe estado');
select has_column('operacion_almacen', 'motivo_rechazo', 'existe motivo_rechazo');
select has_column('operacion_almacen', 'resuelto_por_usuario_id', 'existe resuelto_por_usuario_id');
select has_column('operacion_almacen', 'resuelto_en', 'existe resuelto_en');
select is((select count(*)::int from permiso
  where clave = 'operacion.retiro_merma' and grupo = 'Produccion/Almacen'), 1,
  'existe operacion.retiro_merma en Produccion/Almacen');

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-retiro-a', 'Usuario A', 'x', p.id, null from perfil p order by p.nombre limit 1;

create temporary table _r on commit drop as
select (select id from sucursal where codigo = 'TJ') as tj,
       (select id from usuario where login = 'zz-pgtap-retiro-a') as ua;

-- Validos.
select lives_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-01', 'pendiente', ua from _r$$, 'retiro pendiente entra');
select lives_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, resuelto_en, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-02', 'autorizado', ua, now(), ua from _r$$, 'retiro autorizado entra');
select lives_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, resuelto_en, motivo_rechazo, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-03', 'rechazado', ua, now(), 'No coincide', ua from _r$$, 'retiro rechazado entra');
select lives_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
  select tj, 'consumo', '2098-02-04', ua from _r$$, 'otros tipos entran sin estado');

-- Invalidos.
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', ua from _r$$, '23514', null, 'retiro sin estado');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, capturo_usuario_id)
  select tj, 'consumo', '2098-02-05', 'pendiente', ua from _r$$, '23514', null, 'estado en otro tipo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'otro', ua from _r$$, '23514', null, 'estado desconocido');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, resuelto_en, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'pendiente', ua, now(), ua from _r$$, '23514', null, 'pendiente con resolucion');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'autorizado', ua from _r$$, '23514', null, 'autorizado sin quien resolvio');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'autorizado', ua, ua from _r$$, '23514', null, 'autorizado sin fecha de resolucion');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, resuelto_en, motivo_rechazo, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'autorizado', ua, now(), 'x', ua from _r$$, '23514', null, 'autorizado con motivo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, resuelto_en, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'rechazado', ua, now(), ua from _r$$, '23514', null, 'rechazado sin motivo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, resuelto_en, motivo_rechazo, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'rechazado', ua, now(), '', ua from _r$$, '23514', null, 'rechazado con motivo vacio');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, resuelto_por_usuario_id, resuelto_en, motivo_rechazo, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'rechazado', ua, now(), repeat('x', 301), ua from _r$$, '23514', null, 'motivo de mas de 300');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, estado, motivo_rechazo, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-02-05', 'pendiente', 'x', ua from _r$$, '23514', null, 'pendiente con motivo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, resuelto_por_usuario_id, capturo_usuario_id)
  select tj, 'consumo', '2098-02-05', ua, ua from _r$$, '23514', null, 'resolucion en otro tipo');

select * from finish();
rollback;

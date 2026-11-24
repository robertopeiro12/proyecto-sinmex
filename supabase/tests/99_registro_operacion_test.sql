begin;
select plan(32);

-- Registro de Operacion, parte 1: lo que la BASE garantiza aunque alguien escriba
-- por debajo del servicio. Prefijo `zz-pgtap-regop`.

select has_table('motivo_merma', 'existe el catalogo de motivos de merma');
select has_table('operacion_almacen', 'existe la tabla de operaciones');
select has_table('operacion_almacen_linea', 'existe la tabla de lineas');
select has_trigger('operacion_almacen', 'trg_operacion_almacen_updated', 'la operacion mueve updated_at');
select has_trigger('motivo_merma', 'trg_motivo_merma_actualizado', 'el motivo mueve actualizado_en');

-- Semilla y permisos.
select is(
  (select count(*)::int from motivo_merma
    where deleted_at is null and aplica_almacen and aplica_cliente and aplica_vehiculo
      and nombre in ('Producto dañado / mal estado', 'Caducado por fecha',
                     'Merma general antes de caducidad', 'Lote en mal estado')),
  4, 'la semilla trae los cuatro motivos con las tres casillas prendidas');

select is(
  (select count(*)::int from permiso
    where grupo = 'Produccion/Almacen'
      and clave in ('operacion.entrada', 'operacion.envio', 'operacion.merma',
                    'operacion.consumo', 'operacion.descuento')),
  5, 'existen los cinco permisos operacion.* en Produccion/Almacen');
select is(
  (select count(*)::int from permiso where clave = 'motivo_merma.gestionar' and grupo = 'General'),
  1, 'existe motivo_merma.gestionar en General');

-- Motivos: nombre unico entre vivos.
select throws_ok($$insert into motivo_merma (nombre) values ('  caducado POR fecha ')$$,
  '23505', null, 'el nombre del motivo es unico entre vivos sin importar mayusculas ni espacios');
select throws_ok($$insert into motivo_merma (nombre) values ('   ')$$,
  '23514', null, 'el nombre del motivo no puede quedar vacio');
insert into motivo_merma (nombre) values ('zz-pgtap-regop Motivo');
update motivo_merma set deleted_at = now() where nombre = 'zz-pgtap-regop Motivo';
select lives_ok($$insert into motivo_merma (nombre) values ('zz-pgtap-regop Motivo')$$,
  'dar de baja un motivo libera su nombre');

-- Fixtures.
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-regop-a', 'Usuario A', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-regop-b', 'Usuario B', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('zz-pgtap-regop Horchata');
insert into presentacion (producto_id, volumen)
  select id, v from producto, (values ('1 L'), ('500 ml'), ('250 ml')) t(v) where nombre = 'zz-pgtap-regop Horchata';

create temporary table _r on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from sucursal where codigo = 'MX') as mx,
  (select id from usuario where login = 'zz-pgtap-regop-a') as ua,
  (select id from usuario where login = 'zz-pgtap-regop-b') as ub,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-regop Horchata' and pr.volumen = '1 L') as p1,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-regop Horchata' and pr.volumen = '500 ml') as p2,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-regop Horchata' and pr.volumen = '250 ml') as p3,
  (select id from motivo_merma where nombre = 'Caducado por fecha' and deleted_at is null) as motivo;

-- Una operacion valida de cada tipo entra.
select lives_ok($$
  insert into operacion_almacen (sucursal_id, tipo, fecha, origen, capturo_usuario_id)
    select tj, 'entrada', '2098-01-01', 'compra', ua from _r;
  insert into operacion_almacen (sucursal_id, tipo, fecha, sucursal_destino_id, capturo_usuario_id)
    select tj, 'envio', '2098-01-01', mx, ua from _r;
  insert into operacion_almacen (sucursal_id, tipo, fecha, motivo_merma_id, capturo_usuario_id)
    select tj, 'merma', '2098-01-01', motivo, ua from _r;
  insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
    select tj, 'consumo', '2098-01-01', ua from _r;
  insert into operacion_almacen (sucursal_id, tipo, fecha, trabajador, capturo_usuario_id)
    select tj, 'descuento', '2098-01-01', 'Juan Pérez', ua from _r;
$$, 'los cinco tipos validos entran');

-- Cada combinacion invalida se rechaza (23514 = check).
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
  select tj, 'entrada', '2098-01-02', ua from _r$$, '23514', null, 'entrada sin origen');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, origen, capturo_usuario_id)
  select tj, 'entrada', '2098-01-02', 'robo', ua from _r$$, '23514', null, 'entrada con origen desconocido');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, origen, capturo_usuario_id)
  select tj, 'consumo', '2098-01-02', 'compra', ua from _r$$, '23514', null, 'origen en otro tipo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
  select tj, 'envio', '2098-01-02', ua from _r$$, '23514', null, 'envio sin destino');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, sucursal_destino_id, capturo_usuario_id)
  select tj, 'envio', '2098-01-02', tj, ua from _r$$, '23514', null, 'envio con destino = origen');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, sucursal_destino_id, capturo_usuario_id)
  select tj, 'merma', '2098-01-02', mx, ua from _r$$, '23514', null, 'destino en otro tipo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
  select tj, 'merma', '2098-01-02', ua from _r$$, '23514', null, 'merma sin motivo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, motivo_merma_id, capturo_usuario_id)
  select tj, 'consumo', '2098-01-02', motivo, ua from _r$$, '23514', null, 'motivo en otro tipo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
  select tj, 'descuento', '2098-01-02', ua from _r$$, '23514', null, 'descuento sin trabajador');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, trabajador, capturo_usuario_id)
  select tj, 'descuento', '2098-01-02', '', ua from _r$$, '23514', null, 'descuento con trabajador vacio');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, trabajador, capturo_usuario_id)
  select tj, 'descuento', '2098-01-02', repeat('x', 121), ua from _r$$, '23514', null, 'trabajador de mas de 120');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, trabajador, capturo_usuario_id)
  select tj, 'consumo', '2098-01-02', 'Juan', ua from _r$$, '23514', null, 'trabajador en otro tipo');
select throws_ok($$insert into operacion_almacen (sucursal_id, tipo, fecha, capturo_usuario_id)
  select tj, 'retiro_merma', '2098-01-02', ua from _r$$, '23514', null, 'tipo desconocido');

-- Lineas: topes y unicidad.
create temporary table _op on commit drop as
  select id from operacion_almacen where tipo = 'consumo' and fecha = '2098-01-01';
select lives_ok($$insert into operacion_almacen_linea (operacion_id, presentacion_id, piezas)
  select _op.id, p1, 100000 from _op, _r$$, '100000 piezas entra');
select throws_ok($$insert into operacion_almacen_linea (operacion_id, presentacion_id, piezas)
  select _op.id, p2, 0 from _op, _r$$, '23514', null, '0 piezas se rechaza');
select throws_ok($$insert into operacion_almacen_linea (operacion_id, presentacion_id, piezas)
  select _op.id, p2, 100001 from _op, _r$$, '23514', null, '100001 piezas se rechaza');
select throws_ok($$insert into operacion_almacen_linea (operacion_id, presentacion_id, piezas)
  select _op.id, p1, 5 from _op, _r$$, '23505', null, 'una presentacion repetida en la operacion se rechaza');

-- Copia de produccion (D12). La copia corre una sola vez en la migracion; aqui se
-- ejecuta el MISMO SQL sobre filas sembradas de una fecha propia.
insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id, created_at)
  select '2099-01-01', tj, p1, 10, ua, now() - interval '2 hours' from _r;
insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id, created_at)
  select '2099-01-01', tj, p2, 20, ub, now() - interval '1 hour' from _r;
insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id, deleted_at)
  select '2099-01-01', tj, p3, 30, ub, now() from _r;
insert into produccion (fecha, sucursal_id, presentacion_id, piezas, capturo_usuario_id)
  select '2099-01-01', mx, p1, 40, ub from _r;

with g as (
  select distinct on (fecha, sucursal_id) fecha, sucursal_id, capturo_usuario_id
    from produccion
   where deleted_at is null and fecha = '2099-01-01'
   order by fecha, sucursal_id, created_at, id
), nuevas as (
  insert into operacion_almacen (sucursal_id, tipo, fecha, origen, capturo_usuario_id)
  select sucursal_id, 'entrada', fecha, 'produccion', capturo_usuario_id from g
  returning id, fecha, sucursal_id
)
insert into operacion_almacen_linea (operacion_id, presentacion_id, piezas)
select n.id, p.presentacion_id, p.piezas
  from nuevas n
  join produccion p on p.fecha = n.fecha and p.sucursal_id = n.sucursal_id
 where p.deleted_at is null and p.fecha = '2099-01-01';

select is(
  (select count(*)::int from operacion_almacen where fecha = '2099-01-01' and origen = 'produccion'),
  2, 'la copia crea UNA entrada por (fecha, sucursal)');
select is(
  (select count(*)::int from operacion_almacen_linea l join operacion_almacen o on o.id = l.operacion_id
    where o.fecha = '2099-01-01' and o.sucursal_id = (select tj from _r)),
  2, 'las dos presentaciones vivas de TJ quedan como dos lineas de la misma entrada (la borrada no se copia)');
select is(
  (select ua from _r),
  (select capturo_usuario_id from operacion_almacen
    where fecha = '2099-01-01' and sucursal_id = (select tj from _r)),
  'capturo = quien capturo la fila mas antigua del grupo');

select * from finish();
rollback;

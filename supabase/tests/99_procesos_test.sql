begin;
select plan(35);

-- Operacion -> Procesos (PR A): lo que la BASE garantiza aunque alguien escriba por
-- debajo del servicio. Prefijo `zz-pgtap-proc`. El resto (sentido por tipo, total
-- entregado = recibido, maximo de lineas) lo exige el servicio.

select has_table('proceso_oficina', 'existe la tabla de procesos');
select has_table('proceso_oficina_linea', 'existe la tabla de lineas');
select has_trigger('proceso_oficina', 'trg_proceso_oficina_updated', 'el proceso mueve updated_at');

select is(
  (select count(*)::int from permiso
    where grupo = 'Operacion Comercial'
      and clave in ('proceso.merma', 'proceso.cambio', 'proceso.consumo',
                    'proceso.promocion', 'proceso.descuento')),
  5, 'existen los cinco permisos proceso.* en Operacion Comercial');
select is(
  (select count(*)::int from permiso where clave like 'proceso.%' and descripcion !~ '^Procesos: '),
  0, 'las descripciones de los permisos empiezan con "Procesos: "');

-- Fixtures.
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-proc-a', 'Usuario A', 'x', p.id, null from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('zz-pgtap-proc Horchata');
insert into presentacion (producto_id, volumen)
  select id, v from producto, (values ('1 L'), ('500 ml')) t(v) where nombre = 'zz-pgtap-proc Horchata';
insert into vendedor (login, nombre, password_hash, sucursal_id)
  values ('zz-pgtap-proc', 'Vendedor pgTAP Procesos', 'x', (select id from sucursal where codigo = 'TJ'));
insert into cliente (nombre, telefono, tipo, sucursal_id)
  values ('ZZ-pgtap-proc Cliente', '6640000000', 'prospecto', (select id from sucursal where codigo = 'TJ'));

create temporary table _r on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from usuario where login = 'zz-pgtap-proc-a') as ua,
  (select id from cliente where nombre = 'ZZ-pgtap-proc Cliente') as cli,
  (select id from vendedor where login = 'zz-pgtap-proc') as ven,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-proc Horchata' and pr.volumen = '1 L') as p1,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'zz-pgtap-proc Horchata' and pr.volumen = '500 ml') as p2;

-- Una fila valida de cada variante entra.
select lives_ok($$
  insert into proceso_oficina (tipo, merma_de, sucursal_id, fecha, cliente_id, capturo_usuario_id)
    select 'merma', 'cliente', tj, '2098-01-01', cli, ua from _r;
  insert into proceso_oficina (tipo, merma_de, sucursal_id, fecha, capturo_usuario_id)
    select 'merma', 'almacen', tj, '2098-01-01', ua from _r;
  insert into proceso_oficina (tipo, sucursal_id, fecha, cliente_id, vendedor_id, capturo_usuario_id)
    select 'cambio', tj, '2098-01-01', cli, ven, ua from _r;
  insert into proceso_oficina (tipo, sucursal_id, fecha, capturo_usuario_id)
    select 'consumo', tj, '2098-01-01', ua from _r;
  insert into proceso_oficina (tipo, sucursal_id, fecha, cliente_id, capturo_usuario_id)
    select 'promocion', tj, '2098-01-01', cli, ua from _r;
  insert into proceso_oficina (tipo, sucursal_id, fecha, vendedor_id, comentario, capturo_usuario_id)
    select 'descuento', tj, '2098-01-01', ven, 'Faltante del corte', ua from _r;
$$, 'las seis variantes validas entran (vendedor null = Oficina)');

-- Cada combinacion invalida se rechaza (23514 = check).
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, capturo_usuario_id)
  select 'robo', tj, '2098-01-02', ua from _r$$, '23514', null, 'tipo desconocido');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, cliente_id, capturo_usuario_id)
  select 'merma', tj, '2098-01-02', cli, ua from _r$$, '23514', null, 'merma sin merma_de');
select throws_ok($$insert into proceso_oficina (tipo, merma_de, sucursal_id, fecha, cliente_id, capturo_usuario_id)
  select 'merma', 'otro', tj, '2098-01-02', cli, ua from _r$$, '23514', null, 'merma_de desconocido');
select throws_ok($$insert into proceso_oficina (tipo, merma_de, sucursal_id, fecha, cliente_id, capturo_usuario_id)
  select 'cambio', 'cliente', tj, '2098-01-02', cli, ua from _r$$, '23514', null, 'merma_de en otro tipo');
select throws_ok($$insert into proceso_oficina (tipo, merma_de, sucursal_id, fecha, capturo_usuario_id)
  select 'merma', 'cliente', tj, '2098-01-02', ua from _r$$, '23514', null, 'merma de cliente sin cliente');
select throws_ok($$insert into proceso_oficina (tipo, merma_de, sucursal_id, fecha, cliente_id, capturo_usuario_id)
  select 'merma', 'almacen', tj, '2098-01-02', cli, ua from _r$$, '23514', null, 'merma de almacen con cliente');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, capturo_usuario_id)
  select 'cambio', tj, '2098-01-02', ua from _r$$, '23514', null, 'cambio sin cliente');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, capturo_usuario_id)
  select 'promocion', tj, '2098-01-02', ua from _r$$, '23514', null, 'promocion sin cliente');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, cliente_id, capturo_usuario_id)
  select 'consumo', tj, '2098-01-02', cli, ua from _r$$, '23514', null, 'consumo con cliente');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, cliente_id, vendedor_id, capturo_usuario_id)
  select 'descuento', tj, '2098-01-02', cli, ven, ua from _r$$, '23514', null, 'descuento con cliente');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, capturo_usuario_id)
  select 'descuento', tj, '2098-01-02', ua from _r$$, '23514', null, 'descuento sin vendedor (Oficina no se descuenta)');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, comentario, capturo_usuario_id)
  select 'consumo', tj, '2098-01-02', '', ua from _r$$, '23514', null, 'comentario vacio');
select throws_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, comentario, capturo_usuario_id)
  select 'consumo', tj, '2098-01-02', repeat('x', 301), ua from _r$$, '23514', null, 'comentario de mas de 300');
select lives_ok($$insert into proceso_oficina (tipo, sucursal_id, fecha, comentario, capturo_usuario_id)
  select 'consumo', tj, '2098-01-03', repeat('x', 300), ua from _r$$, 'comentario de 300 entra');

-- Lineas: sentido, topes y unicidad.
create temporary table _op on commit drop as
  select id from proceso_oficina where tipo = 'consumo' and fecha = '2098-01-01';
select lives_ok($$insert into proceso_oficina_linea (proceso_id, presentacion_id, sentido, piezas)
  select _op.id, p1, 'entregado', 100000 from _op, _r$$, '100000 piezas entra');
select lives_ok($$insert into proceso_oficina_linea (proceso_id, presentacion_id, sentido, piezas)
  select _op.id, p1, 'recibido', 1 from _op, _r$$, 'la misma presentacion en el otro sentido entra');
select throws_ok($$insert into proceso_oficina_linea (proceso_id, presentacion_id, sentido, piezas)
  select _op.id, p2, 'entregado', 0 from _op, _r$$, '23514', null, '0 piezas se rechaza');
select throws_ok($$insert into proceso_oficina_linea (proceso_id, presentacion_id, sentido, piezas)
  select _op.id, p2, 'entregado', 100001 from _op, _r$$, '23514', null, '100001 piezas se rechaza');
select throws_ok($$insert into proceso_oficina_linea (proceso_id, presentacion_id, sentido, piezas)
  select _op.id, p2, 'otro', 1 from _op, _r$$, '23514', null, 'sentido desconocido');
select throws_ok($$insert into proceso_oficina_linea (proceso_id, presentacion_id, sentido, piezas)
  select _op.id, p1, 'entregado', 5 from _op, _r$$, '23505', null, 'misma presentacion y sentido repetidos');

-- updated_at se mueve al editar.
update proceso_oficina set updated_at = now() - interval '1 day' where id = (select id from _op);
update proceso_oficina set comentario = 'cambio' where id = (select id from _op);
select ok((select updated_at > now() - interval '1 minute' from proceso_oficina where id = (select id from _op)),
  'editar un proceso mueve updated_at');

select has_index('proceso_oficina', 'idx_proceso_oficina_sucursal_tipo_fecha', 'indice por sucursal, tipo y fecha');
select has_index('proceso_oficina', 'idx_proceso_oficina_vendedor_fecha', 'indice por vendedor y fecha');
select is((select count(*)::int from pg_constraint where conrelid = 'proceso_oficina'::regclass and contype = 'f'),
  5, 'proceso_oficina: llaves a sucursal, cliente, vendedor y dos usuarios');
select is((select count(*)::int from pg_constraint where conrelid = 'proceso_oficina_linea'::regclass and contype = 'f'),
  2, 'proceso_oficina_linea: llaves a proceso y presentacion');
select col_not_null('proceso_oficina', 'capturo_usuario_id', 'capturo_usuario_id es obligatorio');
select col_is_null('proceso_oficina', 'cliente_id', 'cliente_id admite null');
select col_is_null('proceso_oficina', 'vendedor_id', 'vendedor_id admite null (Oficina)');
select col_is_null('proceso_oficina', 'deleted_at', 'deleted_at admite null');

select * from finish();
rollback;

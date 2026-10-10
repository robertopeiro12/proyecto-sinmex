begin;
select plan(12);

-- T-19: facturas del SAT asignadas a notas de venta. Lo que la BASE garantiza
-- aunque alguien escriba por debajo del servicio. Prefijo `zz-pgtap-t19`.

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t19', 'Usuario pgTAP T-19', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values
    ('ZZ-pgtap-T19 Cliente A', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'TJ')),
    ('ZZ-pgtap-T19 Cliente B', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'TJ'));

create temporary table _t19 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from usuario where login = 'zz-pgtap-t19') as usuario,
  (select id from cliente where nombre = 'ZZ-pgtap-T19 Cliente A') as cliente_a,
  (select id from cliente where nombre = 'ZZ-pgtap-T19 Cliente B') as cliente_b;

insert into factura (numero, cliente_id, creado_por_usuario_id)
  select 'ZZ-A780', cliente_a, usuario from _t19;

-- Una venta de oficina del cliente A, base de las pruebas de abajo.
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota, contado_credito,
     semana, mes, status, sucursal_id, origen, capturo_usuario_id)
  select 'ZZPGTAPT1901', '2026-10-07', cliente_a, null, 100.00, null, 'credito',
         41, 10, 'pendiente', tj, 'portal', usuario
    from _t19;

select has_table('factura', 'existe la tabla factura');

select throws_ok(
  $$insert into factura (numero, cliente_id, creado_por_usuario_id)
      select '  zz-a780 ', cliente_b, usuario from _t19$$,
  '23505', null,
  'el numero no se repite, sin importar mayusculas ni espacios'
);

select throws_ok(
  $$insert into factura (numero, cliente_id, creado_por_usuario_id)
      select '   ', cliente_a, usuario from _t19$$,
  '23514', null,
  'un numero en blanco no entra'
);

select throws_ok(
  $$insert into factura (numero, cliente_id, creado_por_usuario_id)
      select repeat('9', 31), cliente_a, usuario from _t19$$,
  '23514', null,
  'un numero de mas de 30 caracteres no entra'
);

select is(
  (select factura from venta_nota where folio = 'ZZPGTAPT1901'),
  'N/A',
  'factura nace en N/A por default'
);

select throws_ok(
  $$update venta_nota set factura = null where folio = 'ZZPGTAPT1901'$$,
  '23502', null,
  'factura ya no admite null'
);

select throws_ok(
  $$update venta_nota set factura = 'A780' where folio = 'ZZPGTAPT1901'$$,
  '23514', null,
  'factura solo es N/A, pendiente o facturada'
);

select throws_ok(
  $$update venta_nota set factura = 'facturada' where folio = 'ZZPGTAPT1901'$$,
  '23514', null,
  'facturada sin factura_id no entra'
);

select throws_ok(
  $$update venta_nota
       set factura = 'pendiente',
           factura_id = (select id from factura where numero = 'ZZ-A780')
     where folio = 'ZZPGTAPT1901'$$,
  '23514', null,
  'factura_id sin facturada no entra'
);

select lives_ok(
  $$update venta_nota
       set factura = 'facturada',
           factura_id = (select id from factura where numero = 'ZZ-A780')
     where folio = 'ZZPGTAPT1901'$$,
  'una venta del cliente A puede apuntar a una factura del cliente A'
);

select throws_ok(
  $$update venta_nota set cliente_id = (select cliente_b from _t19)
     where folio = 'ZZPGTAPT1901'$$,
  '23503', null,
  'la venta y su factura son del mismo cliente (llave compuesta)'
);

select is(
  (select grupo from permiso where clave = 'venta.asignar_factura' and deleted_at is null),
  'Operacion Comercial',
  'existe el permiso venta.asignar_factura'
);

select * from finish();
rollback;

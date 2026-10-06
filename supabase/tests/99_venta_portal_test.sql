begin;
select plan(18);

-- Venta registrada desde el portal (T-17, parte 1) y # de nota unico por
-- sucursal (#95).
--
-- Lo que se prueba es lo que la BASE garantiza aunque un script o una carga
-- futura entren por debajo del servicio: quien puede faltar en una venta, que
-- el # de nota no se repita en la sucursal, que nadie use el segmento de folio
-- de la oficina, y el contador del folio OF.
--
-- Nombres con prefijo `zz-pgtap`/`ZZ-pgtap`; fechas del contador en 2001 para
-- no chocar con ventas de prueba manuales.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t17', 'Vendedor pgTAP T-17', 'x', id
    from sucursal where codigo = 'TJ';
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t17-portal', 'Usuario pgTAP T-17', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values
    ('ZZ-pgtap-T17 Cliente TJ', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'TJ')),
    ('ZZ-pgtap-T17 Cliente MX', 'Domicilio', '000', 'cliente',
     (select id from lista_precio where nombre = 'Lista 1'),
     (select id from sucursal where codigo = 'MX'));

create temporary table _t17 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from sucursal where codigo = 'MX') as mx,
  (select id from vendedor where login = 'zz-pgtap-t17') as vendedor,
  (select id from usuario where login = 'zz-pgtap-t17-portal') as usuario,
  (select id from cliente where nombre = 'ZZ-pgtap-T17 Cliente TJ') as cliente_tj,
  (select id from cliente where nombre = 'ZZ-pgtap-T17 Cliente MX') as cliente_mx;

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_column('venta_nota', 'origen',
  'la venta dice si nacio en la tablet o en el portal');
select has_column('venta_nota', 'capturo_usuario_id',
  'la venta del portal guarda quien la capturo');
select col_is_null('venta_nota', 'vendedor_id',
  'vendedor_id admite null: la venta de Oficina no tiene vendedor');
select col_is_null('cobranza_abono', 'vendedor_id',
  'el cobro de contado de una venta de Oficina no tiene cobrador');
select has_pk('folio_oficina_contador',
  'el contador del folio de oficina tiene llave (sucursal, fecha)');

------------------------------------------------------------------
-- Quien puede faltar en una venta
------------------------------------------------------------------

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen, capturo_usuario_id)
    select 'ZZPGTAPT1701', '2026-10-06', cliente_tj, null, 100.00, 'ab-17',
           'contado', 41, 10, 'pagada', tj, 'portal', usuario
      from _t17$$,
  'acepta una venta de Oficina del portal: sin vendedor y con quien la capturo'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id)
    select 'ZZPGTAPT1702', '2026-10-06', cliente_tj, null, 0, 'ab-18',
           'credito', 41, 10, 'pendiente', tj
      from _t17$$,
  '23514',
  null,
  'una venta de la tablet (origen app, el default) no puede ir sin vendedor'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, capturo_usuario_id)
    select 'ZZPGTAPT1703', '2026-10-06', cliente_tj, vendedor, 0, 'ab-19',
           'credito', 41, 10, 'pendiente', tj, usuario
      from _t17$$,
  '23514',
  null,
  'una venta de la tablet no lleva usuario que la capturo'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen)
    select 'ZZPGTAPT1704', '2026-10-06', cliente_tj, vendedor, 0, 'ab-20',
           'credito', 41, 10, 'pendiente', tj, 'portal'
      from _t17$$,
  '23514',
  null,
  'una venta del portal tiene que decir quien la capturo'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen)
    select 'ZZPGTAPT1705', '2026-10-06', cliente_tj, vendedor, 0, 'ab-21',
           'credito', 41, 10, 'pendiente', tj, 'tablet'
      from _t17$$,
  '23514',
  null,
  'origen solo puede ser app o portal'
);

------------------------------------------------------------------
-- # de nota unico por sucursal (#95)
------------------------------------------------------------------

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id)
    select 'ZZPGTAPT1706', '2026-10-06', cliente_tj, vendedor, 0, '  AB-17 ',
           'credito', 41, 10, 'pendiente', tj
      from _t17$$,
  '23505',
  null,
  'el # de nota no se repite en la sucursal, sin importar mayusculas ni espacios'
);

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, origen, capturo_usuario_id)
    select 'ZZPGTAPT1707', '2026-10-06', cliente_mx, null, 0, 'ab-17',
           'credito', 41, 10, 'pendiente', mx, 'portal', usuario
      from _t17$$,
  'el mismo # de nota si se permite en otra sucursal'
);

-- Parte 2 de T-17 eliminara ventas: una nota borrada libera su numero.
update venta_nota set deleted_at = now() where folio = 'ZZPGTAPT1701';

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id)
    select 'ZZPGTAPT1708', '2026-10-06', cliente_tj, vendedor, 0, 'ab-17',
           'credito', 41, 10, 'pendiente', tj
      from _t17$$,
  'una nota borrada libera su numero en la sucursal'
);

------------------------------------------------------------------
-- El segmento OF es de la oficina
------------------------------------------------------------------

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'zz-pgtap-t17-of', 'Oscar Flores', 'x', tj, 'OF' from _t17$$,
  '23514',
  null,
  'ningun vendedor puede tener el segmento OF: es el de los folios de oficina'
);

------------------------------------------------------------------
-- Contador del folio de oficina
------------------------------------------------------------------

insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
  select tj, '2001-01-01', 1 from _t17
  on conflict (sucursal_id, fecha)
  do update set ultimo = folio_oficina_contador.ultimo + 1;
insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
  select tj, '2001-01-01', 1 from _t17
  on conflict (sucursal_id, fecha)
  do update set ultimo = folio_oficina_contador.ultimo + 1;

select is(
  (select f.ultimo from folio_oficina_contador f join _t17 t on f.sucursal_id = t.tj
    where f.fecha = '2001-01-01'),
  2,
  'dos emisiones del mismo dia y sucursal dejan el contador en 2'
);

insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
  select tj, '2001-01-02', 1 from _t17
  on conflict (sucursal_id, fecha)
  do update set ultimo = folio_oficina_contador.ultimo + 1;

select is(
  (select f.ultimo from folio_oficina_contador f join _t17 t on f.sucursal_id = t.tj
    where f.fecha = '2001-01-02'),
  1,
  'otro dia empieza su propio contador en 1'
);

select throws_ok(
  $$insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
    select tj, '2001-01-01', 1 from _t17$$,
  '23505',
  null,
  'un solo contador por sucursal y dia'
);

select throws_ok(
  $$insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
    select mx, '2001-01-03', 0 from _t17$$,
  '23514',
  null,
  'el contador nunca vale menos de 1'
);

select * from finish();
rollback;

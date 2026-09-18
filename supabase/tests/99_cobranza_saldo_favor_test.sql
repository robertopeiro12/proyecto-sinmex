begin;
select plan(26);

-- Cobranza, abono y saldo a favor (T-20).
--
-- T-05 creo `cobranza_abono` sin folio, sin origen, sin fecha de operacion y
-- sin checks de importe. T-20 es el primero que escribe en ella (desde el push
-- de la tablet y desde la venta de contado), y lo que se prueba aqui es lo que
-- la BASE garantiza aunque el portal (T-21) o un script entren por debajo del
-- servicio.
--
-- Nombres con prefijo `ZZ-pgtap` para no chocar con datos reales; el vendedor
-- va SIN segmento de folio para no depender de cuales estan ocupados.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t20', 'Vendedor pgTAP T-20', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T20 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
     contado_credito, semana, mes, status, sucursal_id)
  select 'ZZPGTAPT2001', '2026-09-10', c.id, v.id, 250.00, '900',
         'credito', 37, 9, 'pendiente', c.sucursal_id
    from cliente c, vendedor v
   where c.nombre = 'ZZ-pgtap-T20 Cliente' and v.login = 'zz-pgtap-t20';

create temporary table _t20 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t20') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T20 Cliente') as cliente,
  (select id from venta_nota where folio = 'ZZPGTAPT2001') as nota;

------------------------------------------------------------------
-- cobranza_abono: estructura
------------------------------------------------------------------

select has_column('cobranza_abono', 'folio',
  'el cobro lleva el folio que emitio la tablet (D11)');
select has_column('cobranza_abono', 'origen',
  'el cobro dice si salio de una venta de contado o de un cobro capturado (D2)');
select has_column('cobranza_abono', 'fecha_operacion',
  'el cobro cuenta en el corte del dia en que se capturo (D3)');
select col_not_null('cobranza_abono', 'fecha_operacion',
  'fecha_operacion es obligatoria');
select col_is_null('cobranza_abono', 'folio',
  'folio admite null: un cobro del portal (T-21) puede no llevarlo');
select has_index('cobranza_abono', 'idx_cobranza_abono_nota',
  'los abonos de una nota se buscan por nota: saldo derivado, D7');
select has_index('cobranza_abono', 'idx_cobranza_abono_folio',
  'los abonos de un cobro se buscan por folio');

------------------------------------------------------------------
-- cobranza_abono: reglas
------------------------------------------------------------------

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, folio)
    select nota, '2026-09-12', '2026-09-14', vendedor, 50.00, 'abono',
           200.00, 'efectivo', 'TJ260914ZZ01'
      from _t20$$,
  'acepta un abono con folio y fecha de operacion'
);

select is(
  (select origen from cobranza_abono where folio = 'TJ260914ZZ01'),
  'cobro',
  'un cobro sin origen explicito es un cobro capturado'
);

-- Un mismo cobro reparte a varias notas con el MISMO folio (D11): la unicidad
-- del folio vive en sync_operacion, no aqui.
select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, folio)
    select nota, '2026-09-12', '2026-09-14', vendedor, 200.00, 'cobranza',
           0.00, 'efectivo', 'TJ260914ZZ01'
      from _t20$$,
  'acepta dos filas con el mismo folio'
);

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, folio, origen)
    select nota, '2026-09-14', '2026-09-14', vendedor, 250.00, 'cobranza',
           0.00, 'efectivo', 'TJ260914ZZ02', 'venta_contado'
      from _t20$$,
  'acepta el cobro automatico de una venta de contado'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', '2026-09-14', vendedor, 0.00, 'abono',
           250.00, 'efectivo'
      from _t20$$,
  '23514',
  null,
  'rechaza un cobro de $0'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', '2026-09-14', vendedor, 10.00, 'abono',
           -0.01, 'efectivo'
      from _t20$$,
  '23514',
  null,
  'rechaza un saldo pendiente negativo: el excedente va a saldo a favor'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-09-14', '2026-09-14', vendedor, 10.00, 'abono',
           240.00, 'efectivo', 'portal'
      from _t20$$,
  '23514',
  null,
  'rechaza un origen fuera del catalogo'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago)
    select nota, '2026-09-14', vendedor, 10.00, 'abono',
           240.00, 'efectivo'
      from _t20$$,
  '23502',
  null,
  'rechaza un cobro sin fecha de operacion'
);

------------------------------------------------------------------
-- saldo_favor_movimiento
------------------------------------------------------------------

select has_table('saldo_favor_movimiento',
  'el saldo a favor es un libro de movimientos (D5)');
select fk_ok('saldo_favor_movimiento', 'cliente_id', 'cliente', 'id',
  'cada movimiento es de un cliente');
select fk_ok('saldo_favor_movimiento', 'vendedor_id', 'vendedor', 'id',
  'y lo origina un vendedor');
select has_index('saldo_favor_movimiento', 'idx_saldo_favor_cliente',
  'el saldo de un cliente se suma por cliente');
select has_trigger('saldo_favor_movimiento', 'trg_saldo_favor_movimiento_updated',
  'updated_at se mantiene solo, como en el resto del esquema');

select lives_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, folio, fecha_operacion)
    select cliente, vendedor, 30.50, 'excedente_cobro', 'TJ260914ZZ01', '2026-09-14'
      from _t20$$,
  'acepta el excedente de un cobro'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, folio, fecha_operacion)
    select cliente, vendedor, 0.00, 'excedente_cobro', 'TJ260914ZZ01', '2026-09-14'
      from _t20$$,
  '23514',
  null,
  'rechaza un movimiento de $0'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, folio, fecha_operacion)
    select cliente, vendedor, 10.00, 'ajuste_portal', null, '2026-09-14'
      from _t20$$,
  '23514',
  null,
  'T-20 solo escribe excedentes de cobro: otro origen es de otro ticket'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen)
    select cliente, vendedor, 10.00, 'excedente_cobro'
      from _t20$$,
  '23502',
  null,
  'rechaza un movimiento sin fecha de operacion'
);

------------------------------------------------------------------
-- Backfill de fecha_operacion, simulado
------------------------------------------------------------------

-- Despues de migrar ya no hay filas sin fecha, asi que se recrea el estado de
-- antes dentro de esta transaccion y se corre el MISMO update de la migracion.
alter table cobranza_abono alter column fecha_operacion drop not null;

insert into cobranza_abono
    (venta_nota_id, fecha_pago, vendedor_id, monto, tipo, saldo_pendiente, metodo_pago, folio)
  select nota, '2026-09-11', vendedor, 10.00, 'abono', 190.00, 'efectivo', 'ZZBACKFILL'
    from _t20;

update cobranza_abono set fecha_operacion = fecha_pago where fecha_operacion is null;

select is(
  (select fecha_operacion from cobranza_abono where folio = 'ZZBACKFILL'),
  '2026-09-11'::date,
  'una fila previa toma su fecha de pago como fecha de operacion'
);

select lives_ok(
  $$alter table cobranza_abono alter column fecha_operacion set not null$$,
  'tras el backfill ya no queda ninguna fila sin fecha de operacion'
);

select * from finish();
rollback;

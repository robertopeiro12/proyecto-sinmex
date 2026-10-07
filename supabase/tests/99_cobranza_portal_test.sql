begin;
select plan(12);

-- T-21: cobranza desde el portal. Lo que la BASE garantiza aunque alguien
-- escriba por debajo del servicio. Prefijo `zz-pgtap-t21`.

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t21', 'Usuario pgTAP T-21', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T21 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota, contado_credito,
     semana, mes, status, sucursal_id, origen, capturo_usuario_id)
  select 'ZZPGTAPT2101', '2026-10-07', c.id, null, 300.00, null, 'credito',
         41, 10, 'pendiente', c.sucursal_id, 'portal', u.id
    from cliente c, usuario u
   where c.nombre = 'ZZ-pgtap-T21 Cliente' and u.login = 'zz-pgtap-t21';

create temporary table _t21 on commit drop as
select
  (select id from usuario where login = 'zz-pgtap-t21') as usuario,
  (select id from cliente where nombre = 'ZZ-pgtap-T21 Cliente') as cliente,
  (select id from venta_nota where folio = 'ZZPGTAPT2101') as nota;

select hasnt_column('cobranza_abono', 'folio',
  'la cobranza no lleva folio (cliente, 2026-10-07)');
select hasnt_column('saldo_favor_movimiento', 'folio',
  'el saldo a favor tampoco');
select hasnt_index('cobranza_abono', 'idx_cobranza_abono_folio',
  'el indice del folio se fue con la columna');
select fk_ok('cobranza_abono', 'capturo_usuario_id', 'usuario', 'id',
  'el cobro del portal guarda quien lo capturo');
select fk_ok('saldo_favor_movimiento', 'capturo_usuario_id', 'usuario', 'id',
  'el movimiento de saldo a favor tambien');
select col_is_null('cobranza_abono', 'capturo_usuario_id',
  'la tablet no lo llena: admite null');

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen, capturo_usuario_id)
    select nota, '2026-10-07', '2026-10-07', null, 100.00, 'abono',
           200.00, 'saldo_favor', 'saldo_favor', usuario
      from _t21$$,
  'aplicar saldo a favor: metodo y origen saldo_favor, sin cobrador'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-07', '2026-10-07', null, 10.00, 'abono',
           190.00, 'saldo_favor', 'cobro'
      from _t21$$,
  '23514', null,
  'el metodo saldo_favor solo va con el origen saldo_favor'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-07', '2026-10-07', null, 10.00, 'abono',
           190.00, 'efectivo', 'saldo_favor'
      from _t21$$,
  '23514', null,
  'y el origen saldo_favor solo con el metodo saldo_favor'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-07', '2026-10-07', null, 10.00, 'abono',
           190.00, 'tarjeta', 'cobro'
      from _t21$$,
  '23514', null,
  'un metodo fuera del catalogo no entra'
);

select lives_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion, capturo_usuario_id)
    select cliente, null, -100.00, 'aplicacion', '2026-10-07', usuario from _t21$$,
  'aplicar saldo a favor deja un movimiento negativo de origen aplicacion'
);

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion)
    select cliente, null, 10.00, 'ajuste', '2026-10-07' from _t21$$,
  '23514', null,
  'otro origen de saldo a favor no entra'
);

select * from finish();
rollback;

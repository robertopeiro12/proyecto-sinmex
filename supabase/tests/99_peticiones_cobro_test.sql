begin;
select plan(31);

-- T-34: el pago como entidad (`cobro`) y las peticiones de borrado. Lo que la
-- BASE garantiza aunque alguien escriba por debajo del servicio. Prefijo
-- `zz-pgtap-t34`.

insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t34', 'Usuario pgTAP T-34', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T34 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota, contado_credito,
     semana, mes, status, sucursal_id, origen, capturo_usuario_id)
  select f.folio, '2026-10-13', c.id, null, 300.00, null, 'credito',
         42, 10, 'pendiente', c.sucursal_id, 'portal', u.id
    from cliente c, usuario u,
         (values ('ZZPGTAPT3401'), ('ZZPGTAPT3402')) as f(folio)
   where c.nombre = 'ZZ-pgtap-T34 Cliente' and u.login = 'zz-pgtap-t34';
insert into cobro
    (cliente_id, vendedor_id, capturo_usuario_id, origen, metodo_pago, monto,
     fecha_pago, fecha_operacion)
  select c.id, null, u.id, 'cobro', 'efectivo', 100.00, '2026-10-13', '2026-10-13'
    from cliente c, usuario u
   where c.nombre = 'ZZ-pgtap-T34 Cliente' and u.login = 'zz-pgtap-t34';

create temporary table _t34 on commit drop as
select
  (select id from usuario where login = 'zz-pgtap-t34') as usuario,
  c.id as cliente,
  c.sucursal_id as sucursal,
  (select id from venta_nota where folio = 'ZZPGTAPT3401') as nota,
  (select id from venta_nota where folio = 'ZZPGTAPT3402') as nota2,
  (select id from cobro where cliente_id = c.id) as cobro
  from cliente c
 where c.nombre = 'ZZ-pgtap-T34 Cliente';

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_table('cobro', 'un renglon por pago recibido o saldo a favor aplicado');
select has_table('peticion', 'la bandeja de peticiones');
select fk_ok('cobranza_abono', 'cobro_id', 'cobro', 'id',
  'cada abono de un cobro apunta a su pago');
select fk_ok('saldo_favor_movimiento', 'cobro_id', 'cobro', 'id',
  'y el movimiento de saldo a favor tambien');
select col_not_null('saldo_favor_movimiento', 'cobro_id',
  'todo movimiento de saldo a favor sale de un pago');
select has_index('peticion', 'uq_peticion_cobro_pendiente',
  'una sola peticion pendiente por pago');

------------------------------------------------------------------
-- cobranza_abono.cobro_id
------------------------------------------------------------------

select lives_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen, cobro_id)
    select nota, '2026-10-13', '2026-10-13', null, 100.00, 'abono',
           200.00, 'efectivo', 'cobro', cobro
      from _t34$$,
  'un abono de cobro con su pago entra'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen)
    select nota, '2026-10-13', '2026-10-13', null, 10.00, 'abono',
           190.00, 'efectivo', 'cobro'
      from _t34$$,
  '23514', null,
  'un abono de cobro sin pago no entra (ck_cobranza_abono_cobro)'
);

select throws_ok(
  $$insert into cobranza_abono
      (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
       saldo_pendiente, metodo_pago, origen, cobro_id)
    select nota, '2026-10-13', '2026-10-13', null, 10.00, 'cobranza',
           0.00, 'efectivo', 'venta_contado', cobro
      from _t34$$,
  '23514', null,
  'el cobro automatico de contado NO es un pago: no lleva cobro_id'
);

------------------------------------------------------------------
-- cobro
------------------------------------------------------------------

select throws_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago, fecha_operacion)
    select cliente, 'cobro', 'efectivo', 0.00, '2026-10-13', '2026-10-13' from _t34$$,
  '23514', null,
  'un pago de $0 no entra'
);

select throws_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago, fecha_operacion)
    select cliente, 'saldo_favor', 'efectivo', 10.00, '2026-10-13', '2026-10-13' from _t34$$,
  '23514', null,
  'una aplicacion de saldo a favor va con el metodo saldo_favor'
);

select throws_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago,
                       fecha_operacion, eliminado_por_usuario_id)
    select cliente, 'cobro', 'efectivo', 10.00, '2026-10-13', '2026-10-13', usuario
      from _t34$$,
  '23514', null,
  'quien lo borro solo tiene sentido en un pago borrado'
);

select lives_ok(
  $$insert into cobro (cliente_id, origen, metodo_pago, monto, fecha_pago,
                       fecha_operacion, deleted_at)
    select cliente, 'cobro', 'efectivo', 10.00, '2026-10-13', '2026-10-13', now()
      from _t34$$,
  'un pago borrado sin quien lo borro entra: el relleno de filas viejas lo necesita'
);

------------------------------------------------------------------
-- saldo_favor_movimiento.cobro_id
------------------------------------------------------------------

select throws_ok(
  $$insert into saldo_favor_movimiento
      (cliente_id, vendedor_id, monto, origen, fecha_operacion)
    select cliente, null, 15.00, 'excedente_cobro', '2026-10-13' from _t34$$,
  '23502', null,
  'un excedente sin pago no entra'
);

------------------------------------------------------------------
-- peticion
------------------------------------------------------------------

select lives_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id)
    select 'eliminar_cobro', cobro, sucursal, 'Era de credito', usuario from _t34$$,
  'una peticion pendiente de borrar un cobro entra'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id)
    select 'eliminar_cobro', cobro, sucursal, 'Otra vez', usuario from _t34$$,
  '23505', null,
  'una segunda pendiente sobre el mismo pago no entra'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en)
    select 'eliminar_cobro', cobro, sucursal, '   ', usuario, 'denegada', usuario, now()
      from _t34$$,
  '23514', null,
  'el motivo no puede ir en blanco'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en)
    select 'eliminar_venta', cobro, sucursal, 'x', usuario, 'denegada', usuario, now()
      from _t34$$,
  '23514', null,
  'por ahora el unico tipo es eliminar_cobro'
);

select throws_ok(
  $$insert into peticion (tipo, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en)
    select 'eliminar_cobro', sucursal, 'x', usuario, 'denegada', usuario, now()
      from _t34$$,
  '23514', null,
  'borrar un cobro exige decir cual'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status)
    select 'eliminar_cobro', cobro, sucursal, 'x', usuario, 'autorizada' from _t34$$,
  '23514', null,
  'una peticion resuelta dice quien y cuando'
);

select throws_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id, status,
                          resuelta_por_usuario_id, resuelta_en, comentario_resolucion)
    select 'eliminar_cobro', cobro, sucursal, 'x', usuario, 'autorizada', usuario, now(), 'ok'
      from _t34$$,
  '23514', null,
  'el comentario de resolucion es solo de una denegada'
);

select lives_ok(
  $$update peticion
       set status = 'denegada', resuelta_por_usuario_id = (select usuario from _t34),
           resuelta_en = now(), comentario_resolucion = 'No procede'
     where cobro_id = (select cobro from _t34)$$,
  'denegar con comentario'
);

select lives_ok(
  $$insert into peticion (tipo, cobro_id, sucursal_id, motivo, solicito_usuario_id)
    select 'eliminar_cobro', cobro, sucursal, 'Ahora si', usuario from _t34$$,
  'resuelta la anterior, se puede volver a pedir'
);

------------------------------------------------------------------
-- Relleno de los cobros viejos, simulado
------------------------------------------------------------------

-- Despues de migrar ya no hay filas sin pago, asi que se recrea el estado de
-- antes dentro de esta transaccion (sin los checks) y se corre la MISMA
-- funcion de la migracion. created_at explicito: dentro de una transaccion
-- now() es el mismo para todo, y el relleno agrupa justamente por ese instante.
alter table cobranza_abono drop constraint ck_cobranza_abono_cobro;
alter table saldo_favor_movimiento alter column cobro_id drop not null;

-- t1: un pago a dos notas con excedente. t2: otro pago a una nota. t3: un
-- excedente sin filas en notas (todo el pago quedo a favor).
insert into cobranza_abono
    (venta_nota_id, fecha_pago, fecha_operacion, vendedor_id, monto, tipo,
     saldo_pendiente, metodo_pago, origen, capturo_usuario_id, created_at)
  select x.nota, '2026-10-13', '2026-10-13', null, x.monto, 'abono', 0.00,
         'efectivo', 'cobro', t.usuario, x.creado::timestamptz
    from _t34 t,
         lateral (values (t.nota, 50.00, '2026-10-13 10:00:00+00'),
                         (t.nota2, 60.00, '2026-10-13 10:00:00+00'),
                         (t.nota, 20.00, '2026-10-13 11:00:00+00')) as x(nota, monto, creado);
insert into saldo_favor_movimiento
    (cliente_id, vendedor_id, monto, origen, fecha_operacion, capturo_usuario_id, created_at)
  select t.cliente, null, x.monto, 'excedente_cobro', '2026-10-13', t.usuario, x.creado::timestamptz
    from _t34 t,
         lateral (values (15.00, '2026-10-13 10:00:00+00'),
                         (30.00, '2026-10-13 12:00:00+00')) as x(monto, creado);

select is(rellenar_cobros_t34(), 3,
  'tres pagos: el de dos notas con excedente, el de una nota y el excedente solo');

select is(
  (select c.monto from cobro c
    where c.id = (select cobro_id from cobranza_abono
                   where created_at = '2026-10-13 10:00:00+00' limit 1)),
  125.00::numeric,
  'el pago de las dos notas vale sus filas mas su excedente'
);

select is(
  (select count(distinct cobro_id) from (
     select cobro_id from cobranza_abono where created_at = '2026-10-13 10:00:00+00'
     union all
     select cobro_id from saldo_favor_movimiento where created_at = '2026-10-13 10:00:00+00') x),
  1::bigint,
  'las dos filas y el excedente del mismo instante son UN pago'
);

select is(
  (select count(distinct cobro_id) from cobranza_abono
    where created_at in ('2026-10-13 10:00:00+00', '2026-10-13 11:00:00+00')),
  2::bigint,
  'dos transacciones distintas son dos pagos'
);

select is(
  (select c.metodo_pago from cobro c
    where c.id = (select cobro_id from saldo_favor_movimiento
                   where created_at = '2026-10-13 12:00:00+00')),
  'efectivo',
  'un excedente solo gana su propio pago (el movimiento no guarda metodo: efectivo)'
);

select is(rellenar_cobros_t34(), 0, 'volver a correrlo no hace nada');

select lives_ok(
  $$alter table saldo_favor_movimiento alter column cobro_id set not null$$,
  'tras el relleno ningun movimiento queda sin pago'
);

select lives_ok(
  $$alter table cobranza_abono add constraint ck_cobranza_abono_cobro
      check ((origen = 'venta_contado') = (cobro_id is null))$$,
  'y ningun abono de cobro queda sin pago'
);

select * from finish();
rollback;

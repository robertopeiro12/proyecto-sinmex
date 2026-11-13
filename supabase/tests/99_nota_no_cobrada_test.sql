begin;
select plan(10);

-- Condicion de venta de la nota asignada y comentario "no cobre" del vendedor.
-- Spec: docs/superpowers/specs/2026-11-13-notas-asignadas-tablet-condicion-venta-design.md (3).
-- Todo lo sembrado se va con el rollback.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-nnc', 'Vendedor pgTAP nnc', 'x', id
    from sucursal where codigo = 'TJ';
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-nnc-u', 'Usuario pgTAP nnc', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-nnc Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
  (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
   semana, mes, status, sucursal_id)
  select 'ZZPGTAPNNC01', '2026-11-12', c.id, v.id, 100.00, 'credito',
         46, 11, 'pendiente', v.sucursal_id
    from vendedor v, cliente c
   where v.login = 'zz-pgtap-nnc' and c.nombre = 'ZZ-pgtap-nnc Cliente';

create temporary table _nnc on commit drop as
select
  (select id from venta_nota where folio = 'ZZPGTAPNNC01') as nota,
  (select id from vendedor where login = 'zz-pgtap-nnc') as vendedor,
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from usuario where login = 'zz-pgtap-nnc-u') as usuario;

select has_column('nota_asignada', 'condicion_venta', 'nota_asignada tiene condicion_venta');
select col_default_is('nota_asignada', 'condicion_venta', 'ninguna'::text,
  'la condicion de venta nace en ninguna');

select throws_ok(
  $$insert into nota_asignada (venta_nota_id, vendedor_id, fecha, asignada_por_usuario_id, condicion_venta)
    select nota, vendedor, date '2026-11-13', usuario, 'otra' from _nnc$$,
  '23514', null, 'una condicion fuera de ninguna/liquidar/abonar no entra');

select has_table('nota_no_cobrada', 'existe la tabla nota_no_cobrada');

select throws_ok(
  $$insert into nota_no_cobrada (id, venta_nota_id, vendedor_id, sucursal_id, fecha, comentario, registrado_en)
    select gen_random_uuid(), nota, vendedor, sucursal, date '2026-11-13', '', now() from _nnc$$,
  '23514', null, 'el comentario no puede ir vacio');

select throws_ok(
  $$insert into nota_no_cobrada (id, venta_nota_id, vendedor_id, sucursal_id, fecha, comentario, registrado_en)
    select gen_random_uuid(), nota, vendedor, sucursal, date '2026-11-13', repeat('x', 301), now() from _nnc$$,
  '23514', null, 'el comentario no pasa de 300 caracteres');

select lives_ok(
  $$insert into nota_no_cobrada (id, venta_nota_id, vendedor_id, sucursal_id, fecha, comentario, registrado_en)
    select gen_random_uuid(), nota, vendedor, sucursal, date '2026-11-13', repeat('x', 300), now() from _nnc$$,
  'un comentario de 300 caracteres entra');

select has_trigger('nota_no_cobrada', 'trg_nota_no_cobrada_updated',
  'el updated_at de nota_no_cobrada lo mueve el trigger generico');

select lives_ok(
  $$insert into nota_asignada (venta_nota_id, vendedor_id, fecha, asignada_por_usuario_id, condicion_venta)
    select nota, vendedor, date '2026-11-13', usuario, 'abonar' from _nnc$$,
  'una condicion valida entra');

select is(
  (select count(*)::int from nota_asignada where condicion_venta = 'abonar'
     and venta_nota_id = (select nota from _nnc)),
  1, 'la condicion se guarda tal cual');

select * from finish();
rollback;

begin;
select plan(14);

-- T-37: la ruta diaria. Lo que la BASE garantiza aunque alguien escriba por
-- debajo del servicio. Prefijo `zz-pgtap-t37`.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t37', 'Vendedor pgTAP T-37', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T37 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

create temporary table _t37 on commit drop as
select
  (select id from vendedor where login = 'zz-pgtap-t37') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T37 Cliente') as cliente;

select has_column('ruta', 'origen',
  'cada fila de la ruta dice quien la agrego (D11)');
select col_not_null('ruta', 'origen',
  'el origen es obligatorio');
select col_default_is('ruta', 'origen', 'oficina',
  'lo que ya existia y lo que escribe el portal es de la oficina');
select has_index('ruta', 'uq_ruta_diaria_vendedor_fecha_cliente',
  'un cliente una sola vez en la ruta diaria viva de un vendedor y un dia');
select has_index('ruta', 'idx_ruta_vendedor_fecha',
  'el pull y el portal leen por vendedor y fecha');

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo)
    select cliente, vendedor, '2026-10-12', 1, 'diaria' from _t37$$,
  'una fila de la ruta diaria entra sin decir origen'
);

select is(
  (select origen from ruta
    where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
      and tipo = 'diaria' and deleted_at is null),
  'oficina',
  'sin origen explicito la fila es de la oficina'
);

select throws_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-13', 1, 'diaria', 'portal' from _t37$$,
  '23514', null,
  'un origen que no es oficina ni vendedor no entra'
);

select throws_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-12', 2, 'diaria', 'vendedor' from _t37$$,
  '23505', null,
  'el mismo cliente vivo dos veces en la ruta diaria del mismo dia no entra'
);

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-14', 1, 'diaria', 'vendedor' from _t37$$,
  'el mismo cliente en otro dia si entra'
);

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo)
    select cliente, vendedor, '2026-10-12', 1, 'semanal' from _t37$$,
  'la ruta semanal (T-36) no esta bajo la unicidad de la diaria'
);

-- La oficina quita al cliente (baja logica) y lo vuelve a poner: el indice es
-- parcial, asi que la fila nueva entra.
update ruta set deleted_at = now()
 where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
   and tipo = 'diaria' and deleted_at is null;

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo, origen)
    select cliente, vendedor, '2026-10-12', 1, 'diaria', 'vendedor' from _t37$$,
  'dar de baja una fila libera al cliente en ese dia'
);

update ruta set deleted_at = now()
 where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
   and tipo = 'diaria' and deleted_at is null;

select is(
  (select count(*)::int from ruta
    where vendedor_id = (select vendedor from _t37) and fecha = '2026-10-12'
      and tipo = 'diaria' and deleted_at is not null),
  2,
  'dos filas dadas de baja del mismo vendedor, dia y cliente conviven'
);

select lives_ok(
  $$insert into ruta (cliente_id, vendedor_id, fecha, orden, tipo)
    select cliente, vendedor, '2026-10-12', 1, 'diaria' from _t37$$,
  'con dos bajas del mismo cliente, una fila viva nueva sigue entrando'
);

select * from finish();
rollback;

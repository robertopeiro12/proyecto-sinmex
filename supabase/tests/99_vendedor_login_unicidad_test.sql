begin;
select plan(3);

-- Mismo bug que T-13 corrigio en usuario.login (20260903130000): el unique
-- plano de vendedor.login sigue contando vendedores dados de baja, y los
-- vendedores son rotativos (Vendedor.md) -- sin esto, dar de baja a alguien
-- reservaria su login para siempre.

create temporary table _ctx on commit drop as
  select (select id from sucursal where codigo = 'TJ' limit 1) as tj;

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-jperez', 'Prueba', 'x', tj from _ctx;

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id)
    select 'zz-pgtap-jperez', 'Prueba 2', 'x', tj from _ctx$$,
  '23505',
  null,
  'rechaza el mismo login repetido entre vendedores activos'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo login.
select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id)
    select 'ZZ-PGTAP-JPEREZ', 'Prueba 3', 'x', tj from _ctx$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

-- La baja es logica (activo = false desde el portal, pero deleted_at es lo
-- que de verdad libera el indice -- ver D7 del spec).
update vendedor set deleted_at = now() where login = 'zz-pgtap-jperez';

select lives_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id)
    select 'zz-pgtap-jperez', 'Prueba 4', 'x', tj from _ctx$$,
  'dar de baja un vendedor libera su login para uno nuevo'
);

select * from finish();
rollback;

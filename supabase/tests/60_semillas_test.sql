begin;
select plan(3);

select is(
  (select count(*) from sucursal where codigo in ('TJ','MX')),
  2::bigint,
  'se sembraron Tijuana y Mexicali'
);

select is(
  (select count(*) from lista_precio),
  5::bigint,
  -- Cuenta TODAS las filas sin filtrar por deleted_at: prueba que la
  -- migracion de T-18 no borro fisicamente 'Especial', solo la marco con
  -- soft-delete (sigue contando aqui). No contradice a
  -- 96_precios_t18_test.sql, que cuenta "4 listas activas" filtrando
  -- deleted_at is null -- son dos conteos distintos a proposito.
  'se sembraron 5 listas en total, incluyendo Especial con soft-delete (Lista 1-4 + Especial)'
);

select is(
  (select count(*) from perfil),
  6::bigint,
  'se sembraron los 6 perfiles semilla'
);

select * from finish();
rollback;

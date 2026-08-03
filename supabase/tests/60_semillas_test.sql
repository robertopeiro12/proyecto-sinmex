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
  'se sembraron 5 listas (Lista 1-4 + Especial)'
);

select is(
  (select count(*) from perfil),
  6::bigint,
  'se sembraron los 6 perfiles semilla'
);

select * from finish();
rollback;

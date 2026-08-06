begin;
select plan(5);

-- El codigo abre el folio de cada operacion (ADR-0001) y los folios ya
-- emitidos no se pueden corregir hacia atras. Por eso el formato se defiende
-- en la base y no solo en el DTO del backend: las semillas, el script
-- crear-usuario y cualquier carga futura entran por debajo de la API.
select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('tj', 'Minusculas')$$,
  '23514',
  null,
  'rechaza un codigo en minusculas'
);

select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('T', 'Una letra')$$,
  '23514',
  null,
  'rechaza un codigo de una letra'
);

select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('TIJ', 'Tres letras')$$,
  '23514',
  null,
  'rechaza un codigo de tres letras'
);

select throws_ok(
  $$insert into sucursal (codigo, nombre) values ('T1', 'Con digito')$$,
  '23514',
  null,
  'rechaza un codigo con digito'
);

select lives_ok(
  $$insert into sucursal (codigo, nombre) values ('GD', 'Guadalajara')$$,
  'acepta un codigo nuevo de 2 letras mayusculas'
);

select * from finish();
rollback;

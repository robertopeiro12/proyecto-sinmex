begin;
select plan(8);

-- T-40: `domicilio` y `lista_precio_id` dejan de ser obligatorios, pero **solo
-- para un prospecto**. Estas 8 pruebas fallan enteras sin la migracion
-- `20260914120000_prospecto_campos_opcionales.sql`: las cuatro primeras porque
-- los constraints no existen, y las cuatro ultimas porque las columnas siguen
-- siendo `not null` y el insert revienta con 23502 en vez de vivir o de dar
-- 23514.

select has_column('cliente', 'domicilio');
select has_column('cliente', 'lista_precio_id');
select hasnt_column('cliente', 'foto', 'no hay columna `foto`: los bytes nunca entraron a Postgres. El ticket aparte se cerro con `foto_archivo`/`foto_subida_en` (ver 99_cliente_foto_test.sql), que guardan el NOMBRE del archivo que vive en el disco del backend');
select has_check('cliente');

-- Prerrequisitos autocontenidos (se revierten con el rollback).
insert into sucursal (codigo, nombre) values ('PP', 'Test T-40');
insert into lista_precio (nombre) values ('Lista Test T-40');

create temporary table ref as
  select
    (select id from sucursal where codigo = 'PP') as sucursal,
    (select id from lista_precio where nombre = 'Lista Test T-40') as lista;

-- 5. Un PROSPECTO sin domicilio ni lista entra. Es el caso de la tablet.
select lives_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
    select 'Tacos Aaron', null, '6641112233', false, 'prospecto', null, sucursal from ref$$,
  'un prospecto entra sin domicilio y sin lista de precios'
);

-- 6. Un CLIENTE sin domicilio, no. El portal sigue obligado a capturarlo.
select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
    select 'Abarrotes Sin Domicilio', null, '6641112233', false, 'cliente', lista, sucursal from ref$$,
  '23514',
  null,
  'un cliente sin domicilio se rechaza (ck_cliente_domicilio_obligatorio)'
);

-- 7. Un CLIENTE sin lista de precios, tampoco.
select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
    select 'Abarrotes Sin Lista', 'Calle 5 #12', '6641112233', false, 'cliente', null, sucursal from ref$$,
  '23514',
  null,
  'un cliente sin lista de precios se rechaza (ck_cliente_lista_precio_obligatoria)'
);

-- 8. **La conversion es donde el check muerde**, y es a proposito: el
-- administrador tiene que completar lo que falta antes de convertir
-- (confirmado por el cliente el 2026-09-02). `ClientesService` lo traduce a un
-- 409 con el motivo, no a un 500.
select throws_ok(
  $$update cliente set tipo = 'cliente' where nombre = 'Tacos Aaron'$$,
  '23514',
  null,
  'convertir un prospecto incompleto a cliente se rechaza'
);

select * from finish();
rollback;

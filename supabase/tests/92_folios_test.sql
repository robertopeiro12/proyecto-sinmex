begin;
select plan(15);

-- Folios de operacion (T-14). Ver [[Folios]] y [[ADR-0001 Formato de folios]].
--
-- Lo que se prueba aqui es lo que **la base** garantiza, no lo que el servicio
-- cree garantizar. Es la misma doctrina de T-09 y de la clave de idempotencia
-- de T-07: las semillas, los scripts y cualquier carga futura entran por debajo
-- de la API, asi que la regla tiene que estar en el esquema.

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_column('sync_operacion', 'folio',
  'la operacion sincronizada carga el folio que emitio la tablet');
select col_is_null('sync_operacion', 'folio',
  'el folio es opcional: la jornada no es un hecho de negocio foliado');
select has_column('vendedor', 'folio_segmento',
  'el vendedor lleva pinado su segmento del folio (5o segmento)');

------------------------------------------------------------------
-- EL criterio de aceptacion: deteccion de colision entre dos tablets
------------------------------------------------------------------

select has_index('sync_operacion', 'uq_sync_operacion_folio',
  'la deteccion de colision de folios es un indice unico de la base');

-- Dos vendedores distintos (dos tablets distintas) que emiten el MISMO folio.
-- Es el caso que ADR-0001 anticipa: la generacion es offline y nada impide que
-- dos dispositivos lleguen al mismo numero (p. ej. dos vendedores que
-- comparten iniciales, la duda que sigue abierta con el cliente).
--
-- El unique es **global** y no por vendedor, al reves que la clave de
-- idempotencia de T-07: la clave identifica el transporte y cada tablet tiene
-- su propio espacio de nombres, pero el folio identifica el hecho de negocio y
-- tiene que ser unico en toda la empresa.
create temporary table _ctx on commit drop as
select
  (select id from sucursal where codigo = 'TJ' limit 1) as sucursal_id,
  (select id from sucursal where codigo = 'MX' limit 1) as sucursal_mx;

insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
select 'pgtap-folio-1', 'Abraham Perez', 'x', sucursal_id, 'AP' from _ctx;
insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
select 'pgtap-folio-2', 'Ana Ponce', 'x', sucursal_id, 'AO' from _ctx;

select lives_ok(
  $$insert into sync_operacion
      (vendedor_id, sucursal_id, clave_idempotencia, tipo, contrato,
       fecha_operacion, ocurrido_en, datos, folio)
    select v.id, v.sucursal_id, 'clave-tablet-1', 'venta', 1,
           '2026-08-07', '2026-08-07T14:00:00-07:00', '{}'::jsonb, 'TJ260807AP01'
      from vendedor v where v.login = 'pgtap-folio-1'$$,
  'la primera tablet emite TJ260807AP01 y entra'
);

select throws_ok(
  $$insert into sync_operacion
      (vendedor_id, sucursal_id, clave_idempotencia, tipo, contrato,
       fecha_operacion, ocurrido_en, datos, folio)
    select v.id, v.sucursal_id, 'clave-tablet-2', 'venta', 1,
           '2026-08-07', '2026-08-07T14:00:00-07:00', '{}'::jsonb, 'TJ260807AP01'
      from vendedor v where v.login = 'pgtap-folio-2'$$,
  '23505',
  null,
  'la SEGUNDA tablet manda el mismo folio y la base lo rechaza'
);

-- La colision se detecta aunque las dos operaciones sean del MISMO vendedor
-- con claves de idempotencia distintas: no es un reintento, son dos hechos de
-- negocio que dicen ser el mismo.
select throws_ok(
  $$insert into sync_operacion
      (vendedor_id, sucursal_id, clave_idempotencia, tipo, contrato,
       fecha_operacion, ocurrido_en, datos, folio)
    select v.id, v.sucursal_id, 'clave-tablet-3', 'venta', 1,
           '2026-08-07', '2026-08-07T14:00:00-07:00', '{}'::jsonb, 'TJ260807AP01'
      from vendedor v where v.login = 'pgtap-folio-1'$$,
  '23505',
  null,
  'el mismo vendedor tampoco puede repetir un folio con otra clave'
);

-- Varias operaciones SIN folio conviven: el indice es parcial. Sin el `where
-- folio is not null`, la segunda jornada del dia chocaria contra la primera.
select lives_ok(
  $$insert into sync_operacion
      (vendedor_id, sucursal_id, clave_idempotencia, tipo, contrato,
       fecha_operacion, ocurrido_en, datos)
    select v.id, v.sucursal_id, 'clave-jornada-' || g, 'jornada', 1,
           '2026-08-07', '2026-08-07T14:00:00-07:00', '{}'::jsonb
      from vendedor v, generate_series(1, 3) g where v.login = 'pgtap-folio-1'$$,
  'varias operaciones sin folio conviven (el indice unico es parcial)'
);

------------------------------------------------------------------
-- El formato del folio, en la base
------------------------------------------------------------------

-- 12 caracteres en 6 segmentos. Un folio con otra forma no se puede leer ni
-- cotejar contra la nota fisica, y un folio emitido no se corrige.
select throws_ok(
  $$insert into sync_operacion
      (vendedor_id, sucursal_id, clave_idempotencia, tipo, contrato,
       fecha_operacion, ocurrido_en, datos, folio)
    select v.id, v.sucursal_id, 'clave-corta', 'venta', 1,
           '2026-08-07', '2026-08-07T14:00:00-07:00', '{}'::jsonb, 'TJ260807AP1'
      from vendedor v where v.login = 'pgtap-folio-1'$$,
  '23514',
  null,
  'rechaza un folio de 11 caracteres'
);

select throws_ok(
  $$insert into sync_operacion
      (vendedor_id, sucursal_id, clave_idempotencia, tipo, contrato,
       fecha_operacion, ocurrido_en, datos, folio)
    select v.id, v.sucursal_id, 'clave-minus', 'venta', 1,
           '2026-08-07', '2026-08-07T14:00:00-07:00', '{}'::jsonb, 'tj260807ap01'
      from vendedor v where v.login = 'pgtap-folio-1'$$,
  '23514',
  null,
  'rechaza un folio en minusculas'
);

-- Una sucursal nueva (T-09 dejo el catalogo dinamico) tiene que poder foliar:
-- el check NO codifica TJ|MX.
select lives_ok(
  $$insert into sync_operacion
      (vendedor_id, sucursal_id, clave_idempotencia, tipo, contrato,
       fecha_operacion, ocurrido_en, datos, folio)
    select v.id, v.sucursal_id, 'clave-sucursal-nueva', 'venta', 1,
           '2026-08-07', '2026-08-07T14:00:00-07:00', '{}'::jsonb, 'GD260807AP01'
      from vendedor v where v.login = 'pgtap-folio-1'$$,
  'acepta el codigo de una sucursal que todavia no existe (catalogo dinamico)'
);

------------------------------------------------------------------
-- El segmento de vendedor
------------------------------------------------------------------

select has_index('vendedor', 'uq_vendedor_folio_segmento',
  'el segmento de vendedor es unico en la base, no solo en el servicio');

-- Dos vendedores vivos no pueden compartir segmento. Es la estrategia
-- PROVISIONAL de desambiguacion (ADR-0007): mientras el cliente no diga como
-- se resuelve, el sistema garantiza al menos que no se repita.
select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'pgtap-folio-3', 'Alonso Prieto', 'x', sucursal_id, 'AP' from _ctx$$,
  '23505',
  null,
  'dos vendedores vivos no pueden compartir el segmento del folio'
);

select throws_ok(
  $$insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'pgtap-folio-4', 'Beto Ruiz', 'x', sucursal_id, 'B1' from _ctx$$,
  '23514',
  null,
  'el segmento del vendedor son 2 letras mayusculas, no digitos'
);

-- El segmento **no se recicla** al dar de baja: el indice unico filtra por
-- `deleted_at is null`, pero un vendedor dado de baja conserva el suyo, asi que
-- sus folios historicos siguen siendo legibles contra las notas fisicas. Lo que
-- se libera es solo el hueco, y solo tras la baja logica.
select lives_ok(
  $$with baja as (
      update vendedor set deleted_at = now() where login = 'pgtap-folio-2'
      returning 1
    )
    insert into vendedor (login, nombre, password_hash, sucursal_id, folio_segmento)
    select 'pgtap-folio-5', 'Aida Ochoa', 'x', sucursal_id, 'AO' from _ctx, baja$$,
  'el segmento de un vendedor dado de baja queda libre para uno nuevo'
);

select * from finish();
rollback;

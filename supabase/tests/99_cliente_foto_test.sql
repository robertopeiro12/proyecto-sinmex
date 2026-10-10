begin;
select plan(12);

-- T-40 (foto del prospecto): las dos columnas de `20260918120000_cliente_foto.sql`.
--
-- Estas 10 pruebas fallan enteras sin esa migracion: las seis primeras porque
-- las columnas no existen, y las cuatro ultimas porque el insert/update las
-- nombra y Postgres responde 42703.
--
-- Lo que se prueba y por que importa cada cosa:
--
--   * el TIPO de `foto_archivo` es `text` y no `bytea`: el archivo vive en el
--     disco del backend (decision de Mario del 2026-09-18, `Despliegue y
--     topologia`), y aqui solo se guarda su nombre;
--   * las dos son NULABLES, que es lo que hace que **un prospecto sin foto sea
--     un prospecto completo**. Si alguien las pusiera `not null` algun dia, el
--     alta de la tablet dejaria de entrar y el sintoma seria un lote rechazado,
--     no un mensaje sobre la foto.

select has_column('cliente', 'foto_archivo');
select has_column('cliente', 'foto_subida_en');

select col_type_is('cliente', 'foto_archivo', 'text',
  'foto_archivo guarda el NOMBRE del archivo, no los bytes: el archivo vive en el disco del backend');
select col_type_is('cliente', 'foto_subida_en', 'timestamp with time zone',
  'foto_subida_en es cuando el SERVIDOR la recibio, con zona');

select col_is_null('cliente', 'foto_archivo',
  'un prospecto sin foto es un prospecto completo: la columna es nulable');
select col_is_null('cliente', 'foto_subida_en',
  'la foto puede llegar tarde o no llegar nunca');

-- Prerrequisitos autocontenidos (se revierten con el rollback).
insert into sucursal (codigo, nombre) values ('PF', 'Test foto T-40');
insert into lista_precio (nombre) values ('Lista Test foto T-40');

create temporary table ref as
  select
    (select id from sucursal where codigo = 'PF') as sucursal,
    (select id from lista_precio where nombre = 'Lista Test foto T-40') as lista;

-- 7. El alta de la tablet: un prospecto entra con las dos columnas nulas.
select lives_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id)
    select 'Foto Tacos Aaron', null, '6641112233', false, 'prospecto', null, sucursal from ref$$,
  'un prospecto entra sin foto'
);

-- 8. Y despues la foto se le anota encima, que es lo que hace
-- `POST /sync/foto/:clave` cuando el prospecto ya fue aceptado.
select lives_ok(
  $$update cliente
       set foto_archivo = '11111111-2222-4333-8444-555555555555.jpg',
           foto_subida_en = now()
     where nombre = 'Foto Tacos Aaron'$$,
  'la foto se anota despues, en la fila que ya existe'
);

select is(
  (select foto_archivo from cliente where nombre = 'Foto Tacos Aaron'),
  '11111111-2222-4333-8444-555555555555.jpg',
  'el nombre del archivo es <clave>.jpg: la idempotencia es como se nombra, no una tabla de control'
);

-- 10. Las columnas no discriminan por tipo, y es a proposito: un prospecto con
-- foto que el administrador convierte en cliente **conserva** su foto. Si
-- dependieran de `tipo`, convertir borraria la unica foto del lugar.
select lives_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, foto_archivo, foto_subida_en)
    select 'Foto Cliente Convertido', 'Calle 5 #12', '6641112233', false, 'cliente', lista, sucursal,
           '99999999-8888-4777-8666-555555555555.jpg', now()
      from ref$$,
  'un cliente tambien puede tener foto: convertir un prospecto no la borra'
);

-- 11 y 12. El check `ck_cliente_foto_completa`: las dos columnas van juntas o
-- ninguna. Los dos lados del estado a medias son danos reales, no simetria
-- teorica: nombre sin fecha deja al portal sirviendo un archivo sin saber si
-- llego completo, y fecha sin nombre deja la ficha diciendo "tiene foto" sin
-- archivo que mostrar.
select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, foto_archivo)
    select 'Foto A Medias Nombre', 'Calle 6 #13', '6641112244', false, 'cliente', lista, sucursal,
           '77777777-6666-4555-8444-333333333333.jpg'
      from ref$$,
  '23514',
  null,
  'nombre de archivo sin fecha de subida: lo rechaza el check'
);

select throws_ok(
  $$insert into cliente (nombre, domicilio, telefono, factura, tipo, lista_precio_id, sucursal_id, foto_subida_en)
    select 'Foto A Medias Fecha', 'Calle 7 #14', '6641112255', false, 'cliente', lista, sucursal, now()
      from ref$$,
  '23514',
  null,
  'fecha de subida sin nombre de archivo: lo rechaza el check'
);

select * from finish();
rollback;

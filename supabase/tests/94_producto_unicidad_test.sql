begin;
select plan(5);

-- Producto de referencia para las pruebas de presentacion.
insert into producto (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Jamaica de prueba');

select throws_ok(
  $$insert into producto (nombre) values ('Jamaica de prueba')$$,
  '23505',
  null,
  'rechaza un producto con el mismo nombre'
);

-- 'lower()' en el indice: dos filas que solo difieren en mayusculas son el
-- mismo sabor para cualquier persona que mire el catalogo.
select throws_ok(
  $$insert into producto (nombre) values ('JAMAICA DE PRUEBA')$$,
  '23505',
  null,
  'trata distinta capitalizacion como duplicado'
);

insert into presentacion (producto_id, volumen)
  values ('11111111-1111-1111-1111-111111111111', '500 ml');

select throws_ok(
  $$insert into presentacion (producto_id, volumen)
    values ('11111111-1111-1111-1111-111111111111', '500 ml')$$,
  '23505',
  null,
  'rechaza el mismo volumen repetido dentro de un producto'
);

-- El unique es por (producto_id, volumen), no global: casi todos los sabores
-- se venden en 500 ml.
insert into producto (id, nombre) values
  ('22222222-2222-2222-2222-222222222222', 'Horchata de prueba');

select lives_ok(
  $$insert into presentacion (producto_id, volumen)
    values ('22222222-2222-2222-2222-222222222222', '500 ml')$$,
  'acepta el mismo volumen en dos productos distintos'
);

-- El 'where deleted_at is null' del indice: sin el, dar de baja un volumen lo
-- bloquearia para siempre y el catalogo no se podria reactivar.
update presentacion set deleted_at = now()
  where producto_id = '11111111-1111-1111-1111-111111111111'
    and volumen = '500 ml';

select lives_ok(
  $$insert into presentacion (producto_id, volumen)
    values ('11111111-1111-1111-1111-111111111111', '500 ml')$$,
  'acepta recrear un volumen que se dio de baja'
);

select * from finish();
rollback;

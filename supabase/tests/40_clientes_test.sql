begin;
select plan(4);

select has_table('cliente');
select has_table('cliente_precio');
select has_table('cliente_promocion_producto');

-- Prerrequisitos autocontenidos (se revierten con el rollback), para no depender de semillas.
insert into sucursal (codigo, nombre) values ('TT', 'Test');
insert into lista_precio (nombre) values ('Lista Test');

-- promocion solo acepta los valores permitidos
select throws_ok(
  $$ insert into cliente
       (nombre, domicilio, telefono, factura, tipo, lista_precio_id, promocion, sucursal_id)
     values
       ('X','Y','000', false, 'cliente',
        (select id from lista_precio where nombre = 'Lista Test'),
        'invalida',
        (select id from sucursal where codigo = 'TT')) $$,
  '23514',
  null,
  'promocion rechaza valores fuera del check'
);

select * from finish();
rollback;

begin;
select plan(5);

select has_table('producto');
select has_table('presentacion');
select has_table('vehiculo');
select has_table('tipo_negocio');

-- presentacion referencia producto
select fk_ok('presentacion', 'producto_id', 'producto', 'id');

select * from finish();
rollback;

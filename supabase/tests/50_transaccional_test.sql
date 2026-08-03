begin;
select plan(6);

select has_table('venta_nota');
select has_table('venta_nota_detalle');
select has_table('cobranza_abono');
select has_table('ruta');

-- folio es único
select col_is_unique('venta_nota', 'folio');

-- el detalle referencia presentacion (no producto)
select fk_ok('venta_nota_detalle', 'presentacion_id', 'presentacion', 'id');

select * from finish();
rollback;

begin;
select plan(2);

select has_table('cliente');
select has_table('cliente_precio');

-- T-74: el enum `promocion` y su check se fueron; las reglas viven en
-- 99_promocion_test.sql.

select * from finish();
rollback;

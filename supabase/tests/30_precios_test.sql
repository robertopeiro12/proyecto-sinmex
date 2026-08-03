begin;
select plan(3);

select has_table('lista_precio');
select has_table('precio');

-- Comportamiento: el precio vigente a una fecha es el de mayor vigente_desde <= fecha.
with s as (
  insert into sucursal (codigo, nombre) values ('TT', 'Test') returning id
), pr as (
  insert into producto (nombre) values ('Jamaica Test') returning id
), pre as (
  insert into presentacion (producto_id, volumen) select id, '500 ml' from pr returning id
), lp as (
  insert into lista_precio (nombre) values ('Lista Test') returning id
)
insert into precio (presentacion_id, lista_precio_id, sucursal_id, precio, vigente_desde)
select pre.id, lp.id, s.id, v.precio, v.vigente_desde
from pre, lp, s,
     (values (13.00, date '2026-01-01'), (14.00, date '2026-07-01')) as v(precio, vigente_desde);

select is(
  (select precio
     from precio
    where vigente_desde <= date '2026-05-15'
    order by vigente_desde desc
    limit 1),
  13.00::numeric,
  'a mayo aplica el precio de enero ($13)'
);

select * from finish();
rollback;

begin;
select plan(9);

-- Buscar, editar y eliminar ventas desde el portal (T-17, parte 2, §5).
--
-- Lo que la BASE garantiza aunque un script entre por debajo del servicio:
-- la auditoria de quien edito/elimino, y que una presentacion tenga una sola
-- linea VIVA por venta (una edicion puede quitarla y volver a agregarla).
--
-- Nombres con prefijo `zz-pgtap`/`ZZ-pgtap`. NO inserta precios:
-- `30_precios_test.sql` cuenta los de "Lista 1".

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t17b', 'Vendedor pgTAP T-17b', 'x', id
    from sucursal where codigo = 'TJ';
insert into usuario (login, nombre, password_hash, perfil_id, sucursal_id)
  select 'zz-pgtap-t17b-portal', 'Usuario pgTAP T-17b', 'x', p.id, null
    from perfil p order by p.nombre limit 1;
insert into producto (nombre) values ('ZZ-pgtap-T17b Jamaica');
insert into presentacion (producto_id, volumen)
  select id, '1 L' from producto where nombre = 'ZZ-pgtap-T17b Jamaica';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T17b Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

insert into venta_nota
    (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
     contado_credito, semana, mes, status, sucursal_id)
  select 'ZZPGTAPT1711', '2026-10-06', c.id, v.id, 240.00, 'zz-t17b-1',
         'credito', 41, 10, 'pendiente', c.sucursal_id
    from cliente c, vendedor v
   where c.nombre = 'ZZ-pgtap-T17b Cliente' and v.login = 'zz-pgtap-t17b';

create temporary table _t17b on commit drop as
select
  (select id from venta_nota where folio = 'ZZPGTAPT1711') as venta,
  (select id from usuario where login = 'zz-pgtap-t17b-portal') as usuario,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'ZZ-pgtap-T17b Jamaica') as pre;

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_column('venta_nota', 'actualizado_por_usuario_id',
  'la venta guarda el ultimo usuario del portal que la edito');
select has_column('venta_nota', 'eliminado_por_usuario_id',
  'la venta guarda quien la elimino');
select fk_ok('venta_nota', 'actualizado_por_usuario_id', 'usuario', 'id');
select fk_ok('venta_nota', 'eliminado_por_usuario_id', 'usuario', 'id');
select has_index('venta_nota_detalle', 'uq_venta_detalle_presentacion',
  'la unicidad de la linea por presentacion es un indice');
select is(
  (select count(*)::int from pg_constraint
    where conname = 'uq_venta_detalle_presentacion'),
  0,
  'la unicidad por presentacion ya no es una constraint total'
);

------------------------------------------------------------------
-- Una linea VIVA por presentacion
------------------------------------------------------------------

insert into venta_nota_detalle
    (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
  select venta, pre, 24, 10.00, 0 from _t17b;

select throws_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select venta, pre, 5, 10.00, 0 from _t17b$$,
  '23505',
  null,
  'sigue impidiendo dos lineas vivas de la misma presentacion'
);

update venta_nota_detalle set deleted_at = now()
 where venta_nota_id = (select venta from _t17b);

select lives_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select venta, pre, 5, 10.00, 0 from _t17b$$,
  'una edicion puede volver a agregar una presentacion cuya linea quito'
);

select lives_ok(
  $$update venta_nota
       set actualizado_por_usuario_id = (select usuario from _t17b),
           eliminado_por_usuario_id = (select usuario from _t17b),
           deleted_at = now()
     where id = (select venta from _t17b)$$,
  'la auditoria acepta al usuario del portal'
);

select * from finish();
rollback;

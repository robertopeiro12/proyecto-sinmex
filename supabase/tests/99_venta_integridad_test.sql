begin;
select plan(12);

-- Integridad de venta_nota y venta_nota_detalle (T-16).
--
-- T-05 creo las dos tablas sin ninguna restriccion sobre cantidades, precio o
-- numero de nota. T-16 es el primero que escribe en ellas, y lo que se prueba
-- aqui es lo que la BASE garantiza aunque una carga futura (el portal de T-17,
-- un script) entre por debajo de la validacion del servicio.
--
-- Nombres con prefijo `ZZ-pgtap` para no chocar con datos reales; el vendedor
-- va SIN segmento de folio para no depender de cuales estan ocupados (D21).

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t16', 'Vendedor pgTAP T-16', 'x', id
    from sucursal where codigo = 'TJ';
insert into producto (nombre) values ('ZZ-pgtap-T16 Jamaica');
insert into presentacion (producto_id, volumen)
  select p.id, v
    from producto p, unnest(array['1 L', '500 ml', '2 L']) as v
   where p.nombre = 'ZZ-pgtap-T16 Jamaica';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T16 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

create temporary table _t16 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as sucursal,
  (select id from vendedor where login = 'zz-pgtap-t16') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T16 Cliente') as cliente,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'ZZ-pgtap-T16 Jamaica' and pr.volumen = '1 L') as pre_a,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'ZZ-pgtap-T16 Jamaica' and pr.volumen = '500 ml') as pre_b,
  (select pr.id from presentacion pr join producto p on p.id = pr.producto_id
    where p.nombre = 'ZZ-pgtap-T16 Jamaica' and pr.volumen = '2 L') as pre_c;

------------------------------------------------------------------
-- venta_nota
------------------------------------------------------------------

select has_column('venta_nota', 'comentarios',
  'la venta lleva comentarios opcionales (D9)');
select has_column('venta_nota', 'pct_comision',
  'la venta congela el % de comision del cliente al vender (D8)');

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, comentarios, pct_comision)
    select 'ZZPGTAPT1601', '2026-09-14', cliente, vendedor, 324.00, '2346',
           'credito', 38, 9, 'pendiente', sucursal, repeat('x', 500), 3.50
      from _t16$$,
  'acepta una venta con comentarios de 500 caracteres y el % de comision congelado'
);

-- `num_nota` es el numero de la nota fisica: obligatorio (D7). Uno en blanco
-- no se puede cotejar contra ningun papel.
select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id)
    select 'ZZPGTAPT1602', '2026-09-14', cliente, vendedor, 0, '   ',
           'credito', 38, 9, 'pendiente', sucursal
      from _t16$$,
  '23514',
  null,
  'rechaza un numero de nota en blanco'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, num_nota,
       contado_credito, semana, mes, status, sucursal_id, comentarios)
    select 'ZZPGTAPT1603', '2026-09-14', cliente, vendedor, 0, '2347',
           'credito', 38, 9, 'pendiente', sucursal, repeat('x', 501)
      from _t16$$,
  '23514',
  null,
  'rechaza comentarios de mas de 500 caracteres'
);

------------------------------------------------------------------
-- venta_nota_detalle
------------------------------------------------------------------

select lives_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select vn.id, t.pre_a, 24, 13.50, 2
      from _t16 t join venta_nota vn on vn.folio = 'ZZPGTAPT1601'$$,
  'acepta una linea con cantidad, precio y piezas de promocion'
);

-- Regalar piezas (solo promocion, precio 0) es valido: es lo que se hace al
-- prospectar (D13).
select lives_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select vn.id, t.pre_b, 0, 0.00, 3
      from _t16 t join venta_nota vn on vn.folio = 'ZZPGTAPT1601'$$,
  'acepta una linea de pura promocion a precio 0'
);

select throws_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select vn.id, t.pre_c, -1, 13.50, 0
      from _t16 t join venta_nota vn on vn.folio = 'ZZPGTAPT1601'$$,
  '23514',
  null,
  'rechaza una cantidad negativa'
);

select throws_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select vn.id, t.pre_c, 1, 13.50, -1
      from _t16 t join venta_nota vn on vn.folio = 'ZZPGTAPT1601'$$,
  '23514',
  null,
  'rechaza piezas de promocion negativas'
);

-- Una linea sin nada no es una linea: ni se vendio ni se regalo.
select throws_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select vn.id, t.pre_c, 0, 13.50, 0
      from _t16 t join venta_nota vn on vn.folio = 'ZZPGTAPT1601'$$,
  '23514',
  null,
  'rechaza una linea con cantidad y promocion en 0'
);

select throws_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select vn.id, t.pre_c, 1, -0.01, 0
      from _t16 t join venta_nota vn on vn.folio = 'ZZPGTAPT1601'$$,
  '23514',
  null,
  'rechaza un precio negativo'
);

-- Una presentacion aparece una sola vez por venta: dos lineas de lo mismo
-- partirian la cantidad y el reporte por presentacion sumaria mal.
select throws_ok(
  $$insert into venta_nota_detalle
      (venta_nota_id, presentacion_id, cantidad, precio, cantidad_promocion)
    select vn.id, t.pre_a, 5, 13.50, 0
      from _t16 t join venta_nota vn on vn.folio = 'ZZPGTAPT1601'$$,
  '23505',
  null,
  'rechaza la misma presentacion dos veces en una venta'
);

select * from finish();
rollback;

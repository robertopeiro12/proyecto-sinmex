begin;
select plan(12);

-- T-73: lo que la BASE garantiza de la firma del cliente en la nota aunque
-- alguien escriba por debajo del servicio. Prefijo `zz-pgtap-t73`/`ZZ-pgtap-T73`;
-- folios `ZZPGTAPT73nn` (12 caracteres, como los reales). Todo se va con el
-- rollback.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-t73', 'Vendedor pgTAP T-73', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-T73 Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));

create temporary table _t73 on commit drop as
select
  (select id from sucursal where codigo = 'TJ') as tj,
  (select id from vendedor where login = 'zz-pgtap-t73') as vendedor,
  (select id from cliente where nombre = 'ZZ-pgtap-T73 Cliente') as cliente;

------------------------------------------------------------------
-- Estructura
------------------------------------------------------------------

select has_column('venta_nota', 'firma_esperada', 'la nota dice si espera la firma del cliente');
select has_column('venta_nota', 'firma_nombre', 'la nota guarda el nombre de quien firmo');
select has_column('venta_nota', 'firma_archivo', 'la nota guarda el archivo de la firma');
select has_column('venta_nota', 'firma_subida_en', 'la nota guarda cuando llego la firma');
select col_not_null('venta_nota', 'firma_esperada', 'firma_esperada no admite null');
select col_default_is('venta_nota', 'firma_esperada', 'false',
  'una venta nace sin esperar firma: portal y apps anteriores a T-73');

------------------------------------------------------------------
-- Los checks
------------------------------------------------------------------

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7301', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, 'Doña Lupe'
      from _t73$$,
  'una venta de la tablet con firma y nombre entra'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7302', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, ''
      from _t73$$,
  '23514', null,
  'el nombre de quien firma no puede ser vacio: sin nombre es null'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7303', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, repeat('x', 81)
      from _t73$$,
  '23514', null,
  'el nombre de quien firma no pasa de 80 caracteres'
);

select lives_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_esperada, firma_nombre)
    select 'ZZPGTAPT7304', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, true, repeat('x', 80)
      from _t73$$,
  'un nombre de 80 caracteres si cabe'
);

select throws_ok(
  $$insert into venta_nota
      (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
       semana, mes, status, sucursal_id, firma_archivo)
    select 'ZZPGTAPT7305', '2026-10-06', cliente, vendedor, 100.00, 'contado',
           41, 10, 'pagada', tj, 'venta-x-firma.jpg'
      from _t73$$,
  '23514', null,
  'una venta que no espera firma no puede tener archivo de firma'
);

select lives_ok(
  $$update venta_nota
       set firma_archivo = 'venta-x-firma.jpg', firma_subida_en = now()
     where folio = 'ZZPGTAPT7301'$$,
  'a la venta que la espera se le anota el archivo'
);

select * from finish();
rollback;

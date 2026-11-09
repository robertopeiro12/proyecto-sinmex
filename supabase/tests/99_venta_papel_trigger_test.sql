begin;
select plan(6);

-- Casilla "Entregada" (nota de papel): el trigger de venta_nota NO mueve
-- updated_at cuando solo cambian las columnas papel_*, y lo mueve en todo lo
-- demas, incluido un update que no cambia nada (`status = status`, el mecanismo
-- de T-34 para que la tablet vuelva a bajar la nota). now() es fijo dentro de la
-- transaccion: antes de cada caso se regresa updated_at a 2000-01-01 con el
-- trigger apagado y se compara contra eso. Todo se va con el rollback.

insert into vendedor (login, nombre, password_hash, sucursal_id)
  select 'zz-pgtap-papel', 'Vendedor pgTAP papel', 'x', id
    from sucursal where codigo = 'TJ';
insert into cliente (nombre, domicilio, telefono, tipo, lista_precio_id, sucursal_id)
  values ('ZZ-pgtap-papel Cliente', 'Domicilio', '000', 'cliente',
          (select id from lista_precio where nombre = 'Lista 1'),
          (select id from sucursal where codigo = 'TJ'));
insert into venta_nota
  (folio, fecha, cliente_id, vendedor_id, monto_total, contado_credito,
   semana, mes, status, sucursal_id)
  select 'ZZPGTAPPAP01', '2026-11-09', c.id, v.id, 100.00, 'credito',
         45, 11, 'pendiente', v.sucursal_id
    from vendedor v, cliente c
   where v.login = 'zz-pgtap-papel' and c.nombre = 'ZZ-pgtap-papel Cliente';

create function pg_temp.atrasar() returns void language sql as $$
  alter table venta_nota disable trigger trg_venta_nota_updated;
  update venta_nota set updated_at = '2000-01-01T00:00:00Z'
   where folio = 'ZZPGTAPPAP01';
  alter table venta_nota enable trigger trg_venta_nota_updated;
$$;

create function pg_temp.atrasada() returns boolean language sql as $$
  select updated_at = '2000-01-01T00:00:00Z'::timestamptz
    from venta_nota where folio = 'ZZPGTAPPAP01';
$$;

-- (a) Solo papel_*: conserva updated_at.
select pg_temp.atrasar();
update venta_nota
   set papel_entregado = true, papel_revisado_en = now()
 where folio = 'ZZPGTAPPAP01';
select ok(pg_temp.atrasada(), 'marcar solo la nota de papel no mueve updated_at');

-- (a') Volver a cambiar solo papel_* (true -> false) tampoco.
select pg_temp.atrasar();
update venta_nota set papel_entregado = false where folio = 'ZZPGTAPPAP01';
select ok(pg_temp.atrasada(), 'cambiar la marca de papel no mueve updated_at');

-- (b) Reescritura sin cambio real (T-34): SI mueve updated_at.
select pg_temp.atrasar();
update venta_nota set status = status where folio = 'ZZPGTAPPAP01';
select ok(not pg_temp.atrasada(), 'status = status (sin cambio real) mueve updated_at');

-- (c) papel_* junto con otra columna: mueve updated_at.
select pg_temp.atrasar();
update venta_nota
   set papel_entregado = true, comentarios = 'ojo'
 where folio = 'ZZPGTAPPAP01';
select ok(not pg_temp.atrasada(), 'papel junto con otra columna mueve updated_at');

-- (d) Un update normal, sin papel_*: mueve updated_at.
select pg_temp.atrasar();
update venta_nota set comentarios = 'otro' where folio = 'ZZPGTAPPAP01';
select ok(not pg_temp.atrasada(), 'un update normal mueve updated_at');

-- El check: la marca y su fecha van juntas.
select throws_ok(
  $$update venta_nota set papel_entregado = null where folio = 'ZZPGTAPPAP01'$$,
  '23514', null,
  'papel_entregado sin papel_revisado_en (o al reves) lo rechaza el check'
);

select * from finish();
rollback;

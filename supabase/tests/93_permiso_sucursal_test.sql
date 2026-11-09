begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'sucursal.gestionar' and deleted_at is null),
  'General',
  'sucursal.gestionar existe y vive en el grupo General'
);

-- T-05 sembro 22 permisos desde el documento del cliente; despues se agregaron:
-- 23 sucursal.gestionar (T-08a), 24 precio.gestionar (T-18), 25 perfil.gestionar
-- (T-08b), 26 usuario.gestionar (T-13), 27 venta.asignar_factura (T-19),
-- 28 cuentas_cobrar.ver (T-22), 29 tesoreria.ver y 30 tesoreria.gestionar (T-28),
-- 31 motivo_visita.gestionar (T-39), 32 flujo_efectivo.ver (T-32),
-- 33 campo_egreso.gestionar y 34 gasto.ver (T-30/T-31), 35 dashboard.ver
-- (Dashboard) y 36 nota_papel.revisar (casilla Entregada de las notas).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  36,
  'el catalogo de permisos tiene 36 claves'
);

select * from finish();
rollback;

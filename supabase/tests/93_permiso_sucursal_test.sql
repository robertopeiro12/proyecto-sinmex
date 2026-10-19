begin;
select plan(2);

select is(
  (select grupo from permiso where clave = 'sucursal.gestionar' and deleted_at is null),
  'General',
  'sucursal.gestionar existe y vive en el grupo General'
);

-- T-05 sembro 22 permisos desde el documento del cliente; T-08a agrego 23o
-- (sucursal.gestionar); T-18 agrego 24o (precio.gestionar); T-08b agrega 25o
-- (perfil.gestionar); T-13 agrega 26o (usuario.gestionar); T-19 agrega 27o
-- (venta.asignar_factura); T-22 agrega 28o (cuentas_cobrar.ver); T-28 agrega
-- 29o y 30o (tesoreria.ver y tesoreria.gestionar); T-39 agrega 31o
-- (motivo_visita.gestionar); T-30/T-31 agrega 32o y 33o
-- (campo_egreso.gestionar y gasto.ver).
select is(
  (select count(*)::int from permiso where deleted_at is null),
  33,
  'el catalogo de permisos tiene 33 claves'
);

select * from finish();
rollback;

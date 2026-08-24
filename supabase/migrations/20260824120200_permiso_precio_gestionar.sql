-- Mismo patron que T-08a con sucursal.gestionar: el catalogo de permisos que
-- sembro T-05 viene del documento del cliente y no incluye ninguno para
-- administrar precios. Sin esta fila, cualquier usuario con sesion podria
-- editar precios.
insert into permiso (clave, grupo, descripcion) values
  ('precio.gestionar', 'General', 'Editar precios por lista y sucursal')
on conflict (clave) do nothing;

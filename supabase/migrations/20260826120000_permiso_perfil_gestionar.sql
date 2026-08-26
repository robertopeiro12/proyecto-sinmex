-- Mismo patron que T-08a (sucursal.gestionar) y T-18 (precio.gestionar): el
-- catalogo de permisos que sembro T-05 viene del documento del cliente y no
-- incluye ninguno para administrar la propia matriz de perfiles. Sin esta
-- fila, cualquier usuario con sesion podria ver y editar que puede hacer cada
-- perfil -- a diferencia de sucursales/productos/vehiculos/precios, aqui NI
-- SIQUIERA la lectura es publica (D3 del spec): es informacion de seguridad,
-- no un catalogo operativo.
insert into permiso (clave, grupo, descripcion) values
  ('perfil.gestionar', 'General', 'Crear perfiles y configurar su matriz de permisos')
on conflict (clave) do nothing;

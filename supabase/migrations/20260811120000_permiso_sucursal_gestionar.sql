-- T-09 dejo /sucursales solo detras de autenticacion: el catalogo de permisos
-- que sembro T-05 viene del documento del cliente y NO incluye ninguno para
-- administrar sucursales. Sin esta fila, cualquier usuario con sesion puede
-- crear o editar sucursales.
--
-- El grupo va sin acento igual que los demas ('Operacion Comercial',
-- 'Produccion/Almacen', 'Informacion'): son valores de datos, no etiquetas de
-- interfaz, y mezclar dos ortografias rompe cualquier agrupacion por texto.
insert into permiso (clave, grupo, descripcion) values
  ('sucursal.gestionar', 'General', 'Registrar/editar sucursales')
on conflict (clave) do nothing;

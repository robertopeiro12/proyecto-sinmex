-- Permiso nuevo para T-13 (Gestion de Usuarios), mismo patron que
-- sucursal.gestionar (T-08a) y perfil.gestionar (T-08b): gatea los seis
-- endpoints de UsuariosController, LECTURA INCLUIDA (D6 del spec) -- el
-- login y las excepciones de permisos de otros usuarios son informacion
-- sensible, y ningun otro catalogo del portal consume esta lista.
insert into permiso (clave, grupo, descripcion) values
  ('usuario.gestionar', 'General', 'Crear/editar/dar de baja usuarios del portal')
on conflict (clave) do nothing;

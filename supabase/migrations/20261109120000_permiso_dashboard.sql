-- Dashboard (T-Dashboard, tarea 1): permiso para ver el Dashboard del portal.
-- Spec: docs/superpowers/specs/ (Dashboard y Flujo diario)
--
-- Solo se inserta la clave; no hay tablas nuevas ni pre-flight contra la nube.
-- El permiso no se asigna a ningun perfil: lo configura el cliente.
insert into permiso (clave, grupo, descripcion) values
  ('dashboard.ver', 'General', 'Ver el Dashboard')
on conflict (clave) do nothing;

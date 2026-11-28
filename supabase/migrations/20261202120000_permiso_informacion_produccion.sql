-- Información de Producción: permiso para ver la pantalla.
-- Spec: docs/superpowers/specs/2026-11-28-informacion-de-produccion-design.md
--
-- * Un solo permiso nuevo, `informacion_produccion.ver`, en el grupo Produccion/Almacen.
-- * Los perfiles siguen vacios: los configura el cliente.
--
-- Pre-flight contra la nube: nada que contar (solo un permiso nuevo).

insert into permiso (clave, grupo, descripcion) values
  ('informacion_produccion.ver', 'Produccion/Almacen', 'Información de producción (entradas y compras): ver')
on conflict (clave) do nothing;

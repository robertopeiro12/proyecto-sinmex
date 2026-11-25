-- Inventario de PT con Recargas: permiso para ver la pantalla.
-- Spec: docs/superpowers/specs/2026-11-25-inventario-pt-recargas-design.md
--
-- * Un solo permiso nuevo, `inventario_pt_recargas.ver`, en el grupo Produccion/Almacen.
-- * Ajustar el inventario sigue siendo `inventario_pt.ajustar`.
-- * Los perfiles siguen vacios: los configura el cliente.
--
-- Pre-flight contra la nube: nada que contar (solo un permiso nuevo).

insert into permiso (clave, grupo, descripcion) values
  ('inventario_pt_recargas.ver', 'Produccion/Almacen', 'Inventario de producto terminado con recargas: ver')
on conflict (clave) do nothing;

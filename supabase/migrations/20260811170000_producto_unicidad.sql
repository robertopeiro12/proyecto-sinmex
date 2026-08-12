-- T-05 creo `producto` y `presentacion` sin ninguna restriccion de unicidad, y
-- la base aceptaba dos "Jamaica" o dos "500 ml" del mismo producto. Va en la
-- base y no solo en el DTO por la misma razon que el check del codigo de
-- sucursal (T-09) y el unique del folio (T-14): las semillas y los scripts de
-- alta entran por debajo de la API. Un producto duplicado no se queda quieto,
-- se propaga a la tablet por el pull de T-07 y al inventario.

-- `lower()`: "Jamaica" y "jamaica" son el mismo sabor.
-- `where deleted_at is null`: la baja es logica (ver ADR/spec D1). Sin este
-- filtro, dar de baja un producto reservaria su nombre para siempre.
create unique index uq_producto_nombre
  on producto (lower(nombre))
  where deleted_at is null;

-- Por producto, no global: casi todos los sabores existen en 500 ml.
create unique index uq_presentacion_volumen
  on presentacion (producto_id, lower(volumen))
  where deleted_at is null;

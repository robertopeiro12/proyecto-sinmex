-- T-05 creo `vehiculo` sin ninguna restriccion de unicidad, y la base aceptaba
-- dos "Nissan 2019" en la misma sucursal. Va en la base y no solo en el DTO por
-- la misma razon que el check del codigo de sucursal (T-09), uq_producto_nombre
-- (T-10) y el unique del folio (T-14): las semillas y los scripts de alta entran
-- por debajo de la API.
--
-- Un vehiculo duplicado no se queda quieto: baja a la tablet por el pull de T-07
-- y el vendedor no sabe cual de los dos esta eligiendo al abrir su jornada.

-- Por sucursal, no global: cada sucursal puede tener su propio "Nissan 2019".
-- `lower()`: "Nissan 2019" y "nissan 2019" son el mismo vehiculo.
-- `where deleted_at is null`: por consistencia con uq_producto_nombre y con el
-- resto del esquema, donde `deleted_at` significa "esta fila ya no cuenta". Ojo:
-- el indice NO filtra por `activo`, asi que desactivar un vehiculo NO libera su
-- nombre — es deliberado (D4), lo que se quiere en ese caso es reactivarlo.
create unique index uq_vehiculo_nombre_sucursal
  on vehiculo (sucursal_id, lower(nombre))
  where deleted_at is null;

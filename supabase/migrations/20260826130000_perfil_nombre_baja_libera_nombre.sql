-- T-08b (20260803163003_identidad_y_permisos.sql) creo `perfil` con
-- `nombre text not null unique` -- un unique PLANO, que sigue contando filas
-- dadas de baja logica. T-08b es el primer ticket que da de baja un `perfil`
-- (DELETE /perfiles/:id, baja logica via `deleted_at`), y con el unique
-- plano eso rompe: un administrador borra "Repartidor" y ya no puede volver
-- a crear un perfil llamado "Repartidor" -- el 409 es permanente, porque no
-- hay ningun camino en la UI para deshacer la baja.
--
-- Mismo criterio que uq_producto_nombre (T-10, producto_unicidad.sql) y
-- uq_vehiculo_nombre_sucursal (T-11, vehiculo_unicidad.sql): la baja es
-- logica. Sin este filtro, dar de baja un perfil reservaria su nombre para
-- siempre.
--
-- `lower()`: "Repartidor" y "repartidor" son el mismo perfil.
-- `where deleted_at is null`: solo cuentan las filas activas.
alter table perfil drop constraint perfil_nombre_key;

create unique index uq_perfil_nombre
  on perfil (lower(nombre))
  where deleted_at is null;

-- T-37: la ruta diaria que arma la oficina y complementa el vendedor (D11).
--
-- La tabla `ruta` existe desde la migracion transaccional, pero nadie la
-- escribia ni la leia. Desde T-37 la escriben el portal (`PUT /rutas/diaria`)
-- y la proyeccion de `ruta-alta` (`RutasDiariasService.agregarAlDia`), y la
-- lee el pull de la tablet. Ver
-- docs/superpowers/specs/2026-10-12-t-37-ruta-del-dia-y-pantalla-principal-design.md.
--
-- Aditiva: no cambia ninguna columna existente. La ruta SEMANAL (`tipo =
-- 'semanal'`, T-36) no se toca: la unicidad de abajo es solo de la diaria.
--
-- Sin grants ni RLS: ninguna tabla de este esquema los tiene (mismo criterio
-- que `jornada`, T-38).

-- Quien puso al cliente en la ruta. El portal no puede quitar lo que agrego el
-- vendedor (D2, D14), y la efectividad (T-46) distingue lo asignado de lo que
-- el vendedor sumo. Las filas que ya existieran (no deberia haber) quedan como
-- de la oficina, que es lo unico que las pudo haber escrito.
alter table ruta
  add column origen text not null default 'oficina'
    constraint ck_ruta_origen check (origen in ('oficina', 'vendedor'));

-- Un cliente una sola vez en la ruta diaria VIVA de un vendedor y un dia.
-- Parcial, como el resto del esquema: la oficina puede quitar a un cliente y
-- volver a ponerlo (fila nueva). La usan, con `on conflict ... do nothing`,
-- la proyeccion de `ruta-alta` (para responder `ruta-duplicada` sin abortar la
-- transaccion) y el reemplazo del portal.
create unique index uq_ruta_diaria_vendedor_fecha_cliente
  on ruta (vendedor_id, fecha, cliente_id)
  where deleted_at is null and tipo = 'diaria';

-- El pull (ventana de fechas del vendedor) y el portal (un vendedor y un dia).
create index idx_ruta_vendedor_fecha
  on ruta (vendedor_id, fecha) where deleted_at is null;

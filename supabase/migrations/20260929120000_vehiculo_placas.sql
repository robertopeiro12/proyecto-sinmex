-- supabase/migrations/20260929120000_vehiculo_placas.sql

-- T-68: el alta de Vehiculo (T-11) nunca pidio placas -- el documento de julio
-- 2026 no las mencionaba, y el cliente senalo la omision en junta el
-- 2026-09-29. Sin formato de placa confirmado por el cliente: texto libre, sin
-- inventar una validacion de patron.
--
-- Nullable en la base, igual que `km_inicial` (T-11): ya hay vehiculos dados
-- de alta sin este dato y no se les va a inventar uno. La obligatoriedad la
-- exige el DTO del alta del Portal (CrearVehiculoDto), no esta columna --
-- mismo comentario que ya lleva `km_inicial` en crear-vehiculo.dto.ts.
alter table vehiculo add column placas text;

-- El unique SI vive en la base (misma doctrina que uq_vehiculo_nombre_sucursal
-- de T-11): una placa fisica no puede pertenecer a dos vehiculos, y eso tiene
-- que sostenerse aunque alguien entre por debajo de la API (semillas, scripts).
--
-- GLOBAL y no por sucursal, a diferencia del nombre ("Nissan 2019" SI puede
-- repetirse entre TJ y MX): la placa identifica la unidad fisica sin importar
-- en que sucursal este dada de alta.
--
-- `lower(btrim(...))`: mismo criterio que uq_vehiculo_nombre_sucursal y
-- uq_producto_nombre. Los NULL no chocan entre si (semantica estandar de
-- Postgres), asi que dos vehiculos viejos sin placas conviven sin problema y
-- no hace falta un `where placas is not null` explicito.
create unique index uq_vehiculo_placas
  on vehiculo (lower(btrim(placas)))
  where deleted_at is null;

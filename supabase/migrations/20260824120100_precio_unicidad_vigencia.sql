-- T-05 creo `precio` sin ninguna restriccion de unicidad. Sin este unique, dos
-- ediciones del mismo dia para la misma combinacion (presentacion, lista,
-- sucursal) abren dos filas de historial en vez de corregir una, y la lectura
-- del precio VIGENTE (la fila mas reciente por combinacion) queda ambigua
-- entre las dos. Va en la base y no solo en el service por la misma razon que
-- el resto del esquema (T-09, T-10, T-11, T-14): las semillas y cualquier
-- carga futura entran por debajo de la API.
--
-- Este mismo constraint es lo que hace posible el upsert de T-18 sin un
-- SELECT previo: el service inserta con `ON CONFLICT ON CONSTRAINT
-- uq_precio_vigencia DO UPDATE`.
alter table precio
  add constraint uq_precio_vigencia
  unique (presentacion_id, lista_precio_id, sucursal_id, vigente_desde);

-- T-05 creo `cliente_precio` sin ninguna restriccion de unicidad. Sin este
-- unique, dos ediciones del mismo dia para el mismo cliente/presentacion
-- abren dos filas de historial en vez de corregir una (mismo problema que
-- `precio` tenia antes de T-18). Va en la base y no solo en el service por la
-- misma razon que el resto del esquema: las semillas y cualquier carga
-- futura entran por debajo de la API.
--
-- Sin sucursal_id a diferencia de uq_precio_vigencia (T-18): el cliente ya
-- pertenece a una sola sucursal fija (D6 del spec de T-12), asi que
-- repetirla aqui seria redundante.
--
-- Este mismo constraint es lo que hace posible el upsert de
-- ClientesRepository.actualizar() sin un SELECT previo: usa
-- `ON CONFLICT ON CONSTRAINT uq_cliente_precio_vigencia DO UPDATE`.
alter table cliente_precio
  add constraint uq_cliente_precio_vigencia
  unique (cliente_id, presentacion_id, vigente_desde);

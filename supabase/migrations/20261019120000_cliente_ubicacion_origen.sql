-- T-72: de donde salio la coordenada actual del cliente (D3).
-- Spec: docs/superpowers/specs/2026-10-19-t-72-geocodificacion-design.md
--
-- * 'gps': la tomo la tablet al dar de alta el prospecto.
-- * 'geocodificada': la calculo el servidor con Google a partir del domicilio.
-- * 'manual': la capturo la oficina en el portal.
-- * null: no hay coordenada.
--
-- Backfill: toda fila con coordenada queda 'manual'. Antes de T-72 las
-- coordenadas solo se capturaban a mano en el portal o por GPS en un
-- prospecto; distinguirlas no vale la pena y 'manual' es la etiqueta
-- conservadora.
--
-- El update del backfill dispara `trg_cliente_updated` y mueve `updated_at` de
-- esas filas. Es a proposito: asi el pull incremental les baja
-- `ubicacion_origen` a las tablets sin un vuelco completo.
--
-- > [!info] Pre-flight para quien empuje esto a `sinmex dev`
-- > Los dos checks no pueden fallar: el backfill cubre toda fila con `lat`
-- > antes de crearlos. La consulta queda escrita para el comentario del PR
-- > (cuantas filas va a marcar el backfill):
-- >
-- >   select count(*) from cliente where lat is not null;

alter table cliente add column ubicacion_origen text;

update cliente set ubicacion_origen = 'manual' where lat is not null;

alter table cliente add constraint ck_cliente_ubicacion_origen_valor
  check (ubicacion_origen in ('gps', 'geocodificada', 'manual'));

-- Nula si y solo si no hay coordenada. Se ata a `lat`, como dice D3. `cliente`
-- no tiene un check de "lat y lng juntas" y este ticket no lo agrega: el portal
-- y la tablet ya mandan las dos o ninguna.
alter table cliente add constraint ck_cliente_ubicacion_origen_con_lat
  check ((ubicacion_origen is null) = (lat is null));

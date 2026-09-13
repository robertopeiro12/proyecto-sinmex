-- ADR-0007 (enmienda 2026-09-12): el cliente confirmo que la colision de
-- segmento de folio se evalua POR SUCURSAL, no globalmente -- el folio ya
-- lleva la sucursal como primer segmento, asi que "TJ260912JP01" y
-- "MX260912JP01" nunca chocan aunque compartan segmento de vendedor. Su cita
-- textual: "contra la misma sucursal, ya que los folios van a ser distintos
-- por sucursal y ahi esta la diferencia".
--
-- Este cambio RELAJA el unique de T-14 (20260807223000_folios.sql), no lo
-- restringe: el indice global anterior era estrictamente mas estricto que
-- este, asi que ningun dato existente puede violar la version compuesta.
drop index uq_vendedor_folio_segmento;

create unique index uq_vendedor_folio_segmento
  on vendedor (folio_segmento, sucursal_id)
  where folio_segmento is not null and deleted_at is null;

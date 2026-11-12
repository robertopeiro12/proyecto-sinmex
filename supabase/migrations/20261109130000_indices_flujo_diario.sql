-- Dashboard y Flujo diario: indices para las sumas por vendedor y dia.
-- Spec: docs/superpowers/specs/2026-11-09-dashboard-flujo-diario-design.md
--
-- Solo indices: no hay filas que violen nada, asi que el pre-flight contra la
-- nube no tiene nada que contar.
--
-- `FlujoDiarioRepository.filas` calcula cada renglon (vendedor, dia) con
-- subconsultas correlacionadas sobre `venta_nota (vendedor_id, fecha)` y
-- `cobro (vendedor_id, fecha_pago)`; sin estos indices cada una recorre la
-- tabla. Parciales `where deleted_at is null`: lo borrado nunca se suma.

create index idx_venta_nota_vendedor_fecha on venta_nota (vendedor_id, fecha)
  where deleted_at is null;

create index idx_cobro_vendedor_fecha_pago on cobro (vendedor_id, fecha_pago)
  where deleted_at is null;

-- Ajustes de la Ruta Semanal y Diaria (pendientes chicos de la revision).
--
-- Pre-flight para quien empuje la migracion a la nube (ademas del protocolo):
--   select count(*) from nota_asignada
--    where quitada_por_usuario_id is not null and deleted_at is null;
-- debe dar 0: el check nuevo exige que quien quito una nota la haya dado de baja.

-- Para "¿en que rutas semanales vivas esta este cliente?".
create index idx_ruta_semanal_cliente_cliente
  on ruta_semanal_cliente (cliente_id)
  where deleted_at is null;

alter table nota_asignada add constraint ck_nota_asignada_quitada
  check (quitada_por_usuario_id is null or deleted_at is not null);

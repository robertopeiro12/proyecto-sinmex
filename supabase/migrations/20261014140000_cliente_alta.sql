-- T-51: Reporte de Clientes nuevos. Empieza a guardar CUANDO quedo como
-- cliente y QUE usuario del portal lo dio de alta (alta directa o conversion
-- de prospecto). No rellena datos: el reporte usa
-- coalesce(alta_cliente_en, created_at) y, sin usuario, muestra "—".
-- `on delete set null`: el portal da de baja usuarios con deleted_at, pero si
-- uno se borra de verdad (p. ej. las suites e2e) el cliente solo pierde el dato.
alter table cliente
  add column alta_cliente_en timestamptz,
  add column alta_cliente_usuario_id uuid references usuario(id) on delete set null,
  add constraint ck_cliente_alta_usuario_con_fecha
    check (alta_cliente_usuario_id is null or alta_cliente_en is not null);

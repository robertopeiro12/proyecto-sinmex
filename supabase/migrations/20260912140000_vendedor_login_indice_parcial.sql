-- Mismo bug que T-13 corrigio en usuario.login (20260903130000_usuario_login_indice_parcial.sql):
-- el unique PLANO de vendedor.login (20260803163003_identidad_y_permisos.sql:79)
-- sigue contando filas dadas de baja, y no distingue mayusculas. Los
-- vendedores son rotativos (Vendedor.md) -- sin este cambio, dar de baja a
-- alguien reservaria su login para siempre, y "JGarcia"/"jgarcia" contarian
-- como logins distintos.
alter table vendedor drop constraint vendedor_login_key;

create unique index uq_vendedor_login
  on vendedor (lower(login))
  where deleted_at is null;

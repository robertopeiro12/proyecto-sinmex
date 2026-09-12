-- T-13 es el primer ticket que le da baja logica a un `usuario`
-- (DELETE /usuarios/:id). Mismo bug que 20260826130000 encontro y
-- corrigio en `perfil.nombre` (T-08b): un `unique` PLANO sigue contando
-- filas dadas de baja, asi que sin este cambio dar de baja a alguien con
-- login "jgarcia" reservaria ese login para siempre -- no hay ningun
-- camino en la UI para deshacerlo.
alter table usuario drop constraint usuario_login_key;

create unique index uq_usuario_login
  on usuario (lower(login))
  where deleted_at is null;

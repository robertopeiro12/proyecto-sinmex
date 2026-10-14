-- T-22: Cuentas por Cobrar (Portal). Solo agrega el permiso de la pantalla;
-- ninguna tabla cambia. El perfil `Administrador General` lo recibe solo
-- (PERFIL_MAESTRO, apps/backend/src/modules/auth/permisos.ts).
insert into permiso (clave, grupo, descripcion) values
  ('cuentas_cobrar.ver', 'Operacion Comercial', 'Ver Cuentas por Cobrar')
on conflict (clave) do nothing;

-- T-32: Flujo de Efectivo (Portal, solo lectura). Solo agrega el permiso de la
-- pantalla; ninguna tabla cambia. `Administrador General` lo recibe solo
-- (PERFIL_MAESTRO). Sin pre-flight.
insert into permiso (clave, grupo, descripcion) values
  ('flujo_efectivo.ver', 'Finanzas', 'Ver Flujo de Efectivo')
on conflict (clave) do nothing;

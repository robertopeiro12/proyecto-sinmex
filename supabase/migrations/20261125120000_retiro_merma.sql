-- Retiro de merma con autorizacion (Registro de Operacion, parte 2).
-- Spec: docs/superpowers/specs/2026-11-25-retiro-de-merma-design.md (D1, D2)
--
-- * `ck_operacion_almacen_tipo` admite `retiro_merma`.
-- * Columnas de estado, solo para `retiro_merma` (nulas en los demas tipos).
-- * Permiso `operacion.retiro_merma` (pedir, corregir, eliminar). Autorizar y
--   rechazar usan `peticiones.gestionar`, que ya existe.
--
-- Pre-flight contra la nube: nada que contar (no hay filas `retiro_merma`; las
-- columnas nacen nulas y los checks las aceptan en los demas tipos).

alter table operacion_almacen
  add column estado text,
  add column resuelto_por_usuario_id uuid references usuario(id),
  add column resuelto_en timestamptz,
  add column motivo_rechazo text;

alter table operacion_almacen drop constraint ck_operacion_almacen_tipo;
alter table operacion_almacen add constraint ck_operacion_almacen_tipo
  check (tipo in ('entrada', 'envio', 'merma', 'consumo', 'descuento', 'retiro_merma'));

alter table operacion_almacen add constraint ck_operacion_almacen_estado check (
  (tipo = 'retiro_merma' and estado is not null and estado in ('pendiente', 'autorizado', 'rechazado'))
  or (tipo <> 'retiro_merma' and estado is null));

-- Checks totales (coalesce): con `estado` nulo la logica trivalente daria NULL y
-- dejaria pasar datos sueltos en los demas tipos.
alter table operacion_almacen add constraint ck_operacion_almacen_resolucion check (
  case estado
    when 'pendiente' then resuelto_por_usuario_id is null and resuelto_en is null
    when 'autorizado' then resuelto_por_usuario_id is not null and resuelto_en is not null
    when 'rechazado' then resuelto_por_usuario_id is not null and resuelto_en is not null
    else resuelto_por_usuario_id is null and resuelto_en is null
  end);

alter table operacion_almacen add constraint ck_operacion_almacen_motivo_rechazo check (
  case estado
    when 'rechazado' then motivo_rechazo is not null
      and char_length(btrim(motivo_rechazo)) >= 1 and char_length(motivo_rechazo) <= 300
    else motivo_rechazo is null
  end);

insert into permiso (clave, grupo, descripcion) values
  ('operacion.retiro_merma', 'Produccion/Almacen', 'Registro de Operación: retiro de merma (pedir, corregir y eliminar)')
on conflict (clave) do nothing;

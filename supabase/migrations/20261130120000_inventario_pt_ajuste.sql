-- Inventario de producto terminado con ventas: ajustes ("borron y cuenta nueva").
-- Spec: docs/superpowers/specs/2026-11-25-inventario-pt-ventas-design.md (D3, D5)
--
-- * Un ajuste fija el Inventario inicial y la Merma acumulada de arranque de una
--   presentacion en una sucursal y un dia; de ahi en adelante se calcula.
-- * Uno vivo por (sucursal, presentacion, fecha): una baja libera la llave.
-- * Los checks son totales: con comentario nulo `is null or (...)` no deja NULL.
--
-- Pre-flight contra la nube: nada que contar (tabla nueva y permisos nuevos).

create table inventario_pt_ajuste (
  id                         uuid primary key default gen_random_uuid(),
  sucursal_id                uuid not null references sucursal(id),
  presentacion_id            uuid not null references presentacion(id),
  fecha                      date not null,
  inventario_inicial         integer not null,
  merma_acumulada_inicial    integer not null,
  comentario                 text,
  capturo_usuario_id         uuid not null references usuario(id),
  actualizado_por_usuario_id uuid references usuario(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  constraint ck_inventario_pt_ajuste_inicial check (inventario_inicial >= 0),
  constraint ck_inventario_pt_ajuste_merma check (merma_acumulada_inicial >= 0),
  constraint ck_inventario_pt_ajuste_comentario check (
    comentario is null or (comentario = btrim(comentario) and char_length(comentario) between 1 and 300))
);

create unique index uq_inventario_pt_ajuste
  on inventario_pt_ajuste (sucursal_id, presentacion_id, fecha) where deleted_at is null;
create index idx_inventario_pt_ajuste_sucursal_fecha
  on inventario_pt_ajuste (sucursal_id, fecha) where deleted_at is null;

create trigger trg_inventario_pt_ajuste_updated before update on inventario_pt_ajuste
  for each row execute function set_updated_at();

insert into permiso (clave, grupo, descripcion) values
  ('inventario_pt.ver',     'Produccion/Almacen', 'Inventario de producto terminado: ver'),
  ('inventario_pt.ajustar', 'Produccion/Almacen', 'Inventario de producto terminado: ajustar el inventario inicial y la merma acumulada')
on conflict (clave) do nothing;

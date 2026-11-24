-- Registro de Operacion, parte 1.
-- Spec: docs/superpowers/specs/2026-11-24-registro-de-operacion-parte-1-design.md (D2, D7, D11, D12, D18)
--
-- * `motivo_merma`: catalogo global (como `motivo_visita`), con semilla de 4.
-- * `operacion_almacen` + `operacion_almacen_linea`: una captura con varias lineas.
--   El check de `tipo` se escribe en una sola constraint para que la parte 2
--   agregue `retiro_merma` sin tocar nada mas.
-- * Permisos `operacion.*` y `motivo_merma.gestionar`; los grants de
--   `almacen_general.gestionar` pasan a `operacion.entrada` (D11).
-- * Copia unica de `produccion` (D12): una entrada por (fecha, sucursal).
--
-- Pre-flight contra la nube (cada consulta debe dar 0):
--   select count(*) from produccion where deleted_at is null and piezas > 100000;
--   select count(*) from (select 1 from produccion where deleted_at is null
--     group by fecha, sucursal_id having count(*) > 200) t;
-- Informativa (va al comentario del PR): cuantas entradas va a crear la copia:
--   select count(*) from (select distinct fecha, sucursal_id from produccion
--     where deleted_at is null) t;

create table motivo_merma (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null
    constraint ck_motivo_merma_nombre check (btrim(nombre) <> ''),
  aplica_almacen   boolean not null default false,
  aplica_cliente   boolean not null default false,
  aplica_vehiculo  boolean not null default false,
  deleted_at       timestamptz,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

create unique index uq_motivo_merma_nombre
  on motivo_merma (lower(btrim(nombre))) where deleted_at is null;

create trigger trg_motivo_merma_actualizado before update on motivo_merma
  for each row execute function set_actualizado_en();

insert into motivo_merma (nombre, aplica_almacen, aplica_cliente, aplica_vehiculo) values
  ('Producto dañado / mal estado',        true, true, true),
  ('Caducado por fecha',                  true, true, true),
  ('Merma general antes de caducidad',    true, true, true),
  ('Lote en mal estado',                  true, true, true)
on conflict do nothing;

create table operacion_almacen (
  id                         uuid primary key default gen_random_uuid(),
  sucursal_id                uuid not null references sucursal(id),
  tipo                       text not null,
  fecha                      date not null,
  origen                     text,
  sucursal_destino_id        uuid references sucursal(id),
  motivo_merma_id            uuid references motivo_merma(id),
  trabajador                 text,
  comentario                 text
    constraint ck_operacion_almacen_comentario check (comentario is null or char_length(comentario) <= 300),
  capturo_usuario_id         uuid not null references usuario(id),
  actualizado_por_usuario_id uuid references usuario(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  constraint ck_operacion_almacen_tipo
    check (tipo in ('entrada', 'envio', 'merma', 'consumo', 'descuento')),
  constraint ck_operacion_almacen_origen check (
    (tipo = 'entrada' and origen is not null and origen in ('produccion', 'compra'))
    or (tipo <> 'entrada' and origen is null)),
  constraint ck_operacion_almacen_destino check (
    (tipo = 'envio' and sucursal_destino_id is not null and sucursal_destino_id <> sucursal_id)
    or (tipo <> 'envio' and sucursal_destino_id is null)),
  constraint ck_operacion_almacen_motivo check (
    (tipo = 'merma' and motivo_merma_id is not null)
    or (tipo <> 'merma' and motivo_merma_id is null)),
  constraint ck_operacion_almacen_trabajador check (
    (tipo = 'descuento' and trabajador is not null
      and trabajador = btrim(trabajador) and char_length(trabajador) between 1 and 120)
    or (tipo <> 'descuento' and trabajador is null))
);

create index idx_operacion_almacen_sucursal_fecha on operacion_almacen (sucursal_id, fecha) where deleted_at is null;
-- Los envios se leen tambien desde la sucursal destino.
create index idx_operacion_almacen_destino_fecha on operacion_almacen (sucursal_destino_id, fecha)
  where deleted_at is null and sucursal_destino_id is not null;

create trigger trg_operacion_almacen_updated before update on operacion_almacen
  for each row execute function set_updated_at();

create table operacion_almacen_linea (
  id              uuid primary key default gen_random_uuid(),
  operacion_id    uuid not null references operacion_almacen(id),
  presentacion_id uuid not null references presentacion(id),
  piezas          integer not null
    constraint ck_operacion_almacen_linea_piezas check (piezas between 1 and 100000),
  constraint uq_operacion_almacen_linea unique (operacion_id, presentacion_id)
);

insert into permiso (clave, grupo, descripcion) values
  ('operacion.entrada',   'Produccion/Almacen', 'Registro de Operación: entradas al almacén'),
  ('operacion.envio',     'Produccion/Almacen', 'Registro de Operación: envíos entre sucursales'),
  ('operacion.merma',     'Produccion/Almacen', 'Registro de Operación: merma de almacén'),
  ('operacion.consumo',   'Produccion/Almacen', 'Registro de Operación: consumo'),
  ('operacion.descuento', 'Produccion/Almacen', 'Registro de Operación: descuentos a trabajadores'),
  ('motivo_merma.gestionar', 'General',         'Motivos de merma: alta, edición y baja')
on conflict (clave) do nothing;

-- D11: quien tenia `almacen_general.gestionar` recibe `operacion.entrada`.
insert into perfil_permiso (perfil_id, permiso_id)
select pp.perfil_id, nuevo.id
  from perfil_permiso pp
  join permiso viejo on viejo.id = pp.permiso_id and viejo.clave = 'almacen_general.gestionar'
  join permiso nuevo on nuevo.clave = 'operacion.entrada'
 where pp.deleted_at is null
on conflict (perfil_id, permiso_id) do nothing;

insert into usuario_permiso (usuario_id, permiso_id, habilitado)
select up.usuario_id, nuevo.id, up.habilitado
  from usuario_permiso up
  join permiso viejo on viejo.id = up.permiso_id and viejo.clave = 'almacen_general.gestionar'
  join permiso nuevo on nuevo.clave = 'operacion.entrada'
 where up.deleted_at is null
on conflict (usuario_id, permiso_id) do nothing;

-- D12: copia unica de `produccion` (solo filas vivas): una entrada por
-- (fecha, sucursal), capturada por quien capturo la fila mas antigua del grupo.
create temporary table _copia_produccion on commit drop as
select gen_random_uuid() as id, g.fecha, g.sucursal_id, g.capturo_usuario_id
  from (
    select distinct on (fecha, sucursal_id)
           fecha, sucursal_id, capturo_usuario_id
      from produccion
     where deleted_at is null
     order by fecha, sucursal_id, created_at, id
  ) g;

insert into operacion_almacen (id, sucursal_id, tipo, fecha, origen, capturo_usuario_id)
select id, sucursal_id, 'entrada', fecha, 'produccion', capturo_usuario_id
  from _copia_produccion;

insert into operacion_almacen_linea (operacion_id, presentacion_id, piezas)
select c.id, p.presentacion_id, p.piezas
  from produccion p
  join _copia_produccion c on c.fecha = p.fecha and c.sucursal_id = p.sucursal_id
 where p.deleted_at is null;

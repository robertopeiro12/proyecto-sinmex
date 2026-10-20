-- T-27 pieza 1: carga y recarga del vendedor.
-- Spec: docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md
--
-- Una columna con default y dos tablas nuevas y vacias: no hay filas que violen
-- nada, asi que el pre-flight contra la nube no tiene nada que contar.
--
-- * `sucursal.control_inventario` (D7): apagado por defecto. Prendido, la app
--   exige aceptar la carga para vender (D3) y no vende mas de lo que trae (D4).
--   Cambiarlo toca `vendedor.updated_at` de esa sucursal (lo hace el backend)
--   para que el pull incremental lo baje.
-- * `carga`: lo que produccion entrega al vendedor (la de la manana y cada
--   recarga), numerada por vendedor y dia. Una baja logica libera su numero
--   (indice unico parcial). La respuesta del vendedor (D2, D6) vive en `estado`,
--   `motivo_rechazo` y `respondida_en`, atadas por dos checks.
-- * `carga_detalle`: piezas por presentacion. Sin `updated_at`: editar las
--   lineas sube `carga.version`, y eso mueve `carga.updated_at` (el pull).
--
-- El permiso `carga.gestionar` ya existe (semillas, grupo Produccion/Almacen):
-- aqui no se inserta ningun permiso.

alter table sucursal add column control_inventario boolean not null default false;

create table carga (
  id                 uuid primary key default gen_random_uuid(),
  sucursal_id        uuid not null references sucursal(id),
  vendedor_id        uuid not null references vendedor(id),
  fecha              date not null,
  numero             smallint not null check (numero >= 1),
  estado             text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'rechazada')),
  motivo_rechazo     text
    check (motivo_rechazo is null or char_length(motivo_rechazo) between 1 and 300),
  version            integer not null default 1 check (version >= 1),
  capturo_usuario_id uuid not null references usuario(id),
  respondida_en      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint ck_carga_motivo check ((estado = 'rechazada') = (motivo_rechazo is not null)),
  constraint ck_carga_respondida check ((estado = 'pendiente') = (respondida_en is null))
);

-- La red del numero siguiente: el backend lo calcula con la fila del vendedor
-- bloqueada, y si aun asi dos capturas chocaran, esto lo impide.
create unique index uq_carga_vendedor_fecha_numero
  on carga (vendedor_id, fecha, numero) where deleted_at is null;
-- El pull incremental: las del vendedor del token por `updated_at`.
create index idx_carga_vendedor_updated on carga (vendedor_id, updated_at);

create trigger trg_carga_updated before update on carga
  for each row execute function set_updated_at();

create table carga_detalle (
  id              uuid primary key default gen_random_uuid(),
  carga_id        uuid not null references carga(id),
  presentacion_id uuid not null references presentacion(id),
  piezas          integer not null check (piezas > 0),
  constraint uq_carga_detalle_presentacion unique (carga_id, presentacion_id)
);

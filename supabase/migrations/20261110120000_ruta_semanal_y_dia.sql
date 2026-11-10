-- Ruta Semanal y Ruta Diaria (parte 1): las rutas con nombre que arma la
-- oficina por dia de la semana, la ruta asignada a cada vendedor por fecha
-- (con su vehiculo) y las notas por cobrar que se le asignan a un vendedor.
-- Ver docs/superpowers/specs/2026-11-10-ruta-semanal-y-diaria-design.md.
--
-- Aditiva: tablas nuevas y dos columnas nulas en `ruta`; el unico cambio a algo
-- existente es que `ruta.origen` admite tambien 'semanal'.
-- Pre-flight para quien la empuje a la nube: tablas nuevas y columnas nulas;
-- nada que contar.
--
-- Sin grants ni RLS: ninguna tabla de este esquema los tiene.

-- Ruta semanal: un nombre por dia de la semana y sucursal (1 = lunes ... 6 =
-- sabado; no hay domingo).
create table ruta_semanal (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursal(id),
  dia_semana  smallint not null check (dia_semana between 1 and 6),
  nombre      text not null check (btrim(nombre) <> ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger trg_ruta_semanal_updated before update on ruta_semanal
  for each row execute function set_updated_at();

create unique index uq_ruta_semanal_nombre
  on ruta_semanal (sucursal_id, dia_semana, lower(btrim(nombre)))
  where deleted_at is null;

-- Clientes de una ruta semanal, en orden.
create table ruta_semanal_cliente (
  id             uuid primary key default gen_random_uuid(),
  ruta_semanal_id uuid not null references ruta_semanal(id),
  cliente_id     uuid not null references cliente(id),
  orden          integer not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create trigger trg_ruta_semanal_cliente_updated before update on ruta_semanal_cliente
  for each row execute function set_updated_at();

create unique index uq_ruta_semanal_cliente
  on ruta_semanal_cliente (ruta_semanal_id, cliente_id)
  where deleted_at is null;

-- Ruta asignada a un vendedor en una fecha: una semanal (con el nombre
-- congelado) o ninguna, y el vehiculo del dia.
create table ruta_dia (
  id                         uuid primary key default gen_random_uuid(),
  vendedor_id                uuid not null references vendedor(id),
  fecha                      date not null,
  ruta_semanal_id            uuid references ruta_semanal(id),
  nombre_ruta                text,
  vehiculo_id                uuid references vehiculo(id),
  actualizado_por_usuario_id uuid references usuario(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  constraint ck_ruta_dia_nombre check ((ruta_semanal_id is null) = (nombre_ruta is null))
);

create trigger trg_ruta_dia_updated before update on ruta_dia
  for each row execute function set_updated_at();

create unique index uq_ruta_dia_vendedor_fecha
  on ruta_dia (vendedor_id, fecha)
  where deleted_at is null;

-- Una ruta semanal la lleva un solo vendedor por fecha.
create unique index uq_ruta_dia_semanal_fecha
  on ruta_dia (ruta_semanal_id, fecha)
  where deleted_at is null and ruta_semanal_id is not null;

-- Notas por cobrar asignadas a un vendedor para una fecha.
create table nota_asignada (
  id                      uuid primary key default gen_random_uuid(),
  venta_nota_id           uuid not null references venta_nota(id),
  vendedor_id             uuid not null references vendedor(id),
  fecha                   date not null,
  asignada_por_usuario_id uuid not null references usuario(id),
  quitada_por_usuario_id  uuid references usuario(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create trigger trg_nota_asignada_updated before update on nota_asignada
  for each row execute function set_updated_at();

create unique index uq_nota_asignada_nota_fecha
  on nota_asignada (venta_nota_id, fecha)
  where deleted_at is null;

create index idx_nota_asignada_vendedor_fecha
  on nota_asignada (vendedor_id, fecha)
  where deleted_at is null;

-- `ruta`: origen 'semanal' (clientes que vienen de una ruta semanal), recado
-- de la oficina para el vendedor y por que se quito la fila.
alter table ruta drop constraint ck_ruta_origen;
alter table ruta add constraint ck_ruta_origen
  check (origen in ('oficina', 'vendedor', 'semanal'));
alter table ruta add column recado text
  check (recado is null or char_length(recado) <= 200);
alter table ruta add column quitado_por text
  check (quitado_por in ('oficina', 'cambio_ruta'));
